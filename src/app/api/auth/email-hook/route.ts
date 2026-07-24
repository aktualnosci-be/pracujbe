import { Resend } from 'resend';

import { renderEmail } from '@/emails/templates';
import type { EmailType } from '@/emails/copy';
import { routing, type Locale } from '@/i18n/routing';
import { env } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import { verifyStandardWebhook } from '@/lib/webhooks';

/**
 * Supabase Auth „Send Email Hook" — wysyłka transakcyjnych e-maili Auth (potwierdzenie konta,
 * reset hasła, magic link) W JĘZYKU ODBIORCY (INVARIANT #1), zamiast domyślnych, jednojęzycznych
 * szablonów GoTrue.
 *
 * Konfiguracja (operacyjna, Supabase Dashboard → Authentication → Hooks → Send Email):
 *   URL:   https://<domena>/api/auth/email-hook
 *   Secret: SEND_EMAIL_HOOK_SECRET — wartość Standard Webhooks. Można wkleić DOKŁADNIE tak,
 *           jak podaje Supabase ('v1,whsec_<base64>') albo samo 'whsec_<base64>' — oba prefiksy
 *           są obcinane przed dekodowaniem base64.
 * Dopóki hook nie jest WŁĄCZONY w Supabase, nie jest wołany, a GoTrue używa swoich szablonów.
 *
 * Bezpieczeństwo: weryfikacja podpisu Standard Webhooks (HMAC-SHA256, porównanie stałoczasowe)
 * + kontrola świeżości znacznika czasu (okno ±300 s przeciw replayowi). Jeśli hook zostanie
 * wołany, a deployment nie ma sekretu/klucza (dryf env) → 500 (błąd widoczny w GoTrue/Sentry,
 * nie „cichy" 200), NIGDY nie ujawniamy technikaliów w treści.
 */

export const runtime = 'nodejs';

// Maksymalna dopuszczalna różnica wieku żądania (Standard Webhooks, ochrona przed replayem).
const TIMESTAMP_TOLERANCE_SECONDS = 300;

interface HookPayload {
  user?: { id?: string; email?: string; user_metadata?: Record<string, unknown> };
  email_data?: {
    token_hash?: string;
    email_action_type?: string;
    redirect_to?: string;
  };
}

/** Zawęża dowolny string do obsługiwanego Locale (fallback: język domyślny). */
function toLocale(value: unknown): Locale {
  const v = typeof value === 'string' ? value : '';
  return (routing.locales as readonly string[]).includes(v) ? (v as Locale) : routing.defaultLocale;
}

/** Weryfikacja podpisu Standard Webhooks (jak Supabase Send Email Hook). */
function verifySignature(secret: string, headers: Headers, rawBody: string): boolean {
  return verifyStandardWebhook(
    secret,
    {
      id: headers.get('webhook-id'),
      timestamp: headers.get('webhook-signature-timestamp') ?? headers.get('webhook-timestamp'),
      signature: headers.get('webhook-signature'),
    },
    rawBody,
    { toleranceSeconds: TIMESTAMP_TOLERANCE_SECONDS },
  );
}

/** Mapuje typ akcji GoTrue na nasz typ e-maila + dane szablonu (link w locale odbiorcy). */
function buildEmail(
  actionType: string,
  url: string,
  firstName: string | undefined,
): { type: EmailType; data: Record<string, unknown> } {
  if (actionType === 'recovery') {
    return { type: 'passwordReset', data: { firstName, resetUrl: url } };
  }
  // signup / email / email_change / magiclink → potwierdzenie/akcja konta.
  return { type: 'accountConfirmation', data: { firstName, confirmationUrl: url } };
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'Pracuj.be <no-reply@pracuj.be>';
  const supabaseUrl = env.supabaseUrl;

  // Hook został wołany, ale ten deployment nie ma pełnej konfiguracji (dryf env: brak sekretu/
  // klucza/URL). NIE zwracamy „cichego" 200 — GoTrue uznałby e-mail za dostarczony i porzucił
  // go bez śladu. 500 czyni błąd widocznym (GoTrue retry / Sentry), bez ujawniania technikaliów.
  if (!secret || !apiKey || !supabaseUrl) {
    captureError(new Error('email-hook called without full configuration'), { area: 'auth.email-hook' });
    return Response.json({ error: 'not configured' }, { status: 500 });
  }

  const rawBody = await request.text();
  if (!verifySignature(secret, request.headers, rawBody)) {
    return Response.json({ error: 'invalid signature' }, { status: 401 });
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(rawBody) as HookPayload;
  } catch {
    return Response.json({ error: 'invalid payload' }, { status: 400 });
  }

  const email = payload.user?.email;
  const meta = payload.user?.user_metadata ?? {};
  const actionType = payload.email_data?.email_action_type ?? 'signup';
  const tokenHash = payload.email_data?.token_hash;
  const redirectTo = payload.email_data?.redirect_to ?? env.siteUrl;
  if (!email || !tokenHash) {
    return Response.json({ error: 'missing fields' }, { status: 400 });
  }

  const locale = toLocale(meta['locale']);
  const firstName = typeof meta['first_name'] === 'string' ? (meta['first_name'] as string) : undefined;

  // Link weryfikacyjny GoTrue (potwierdzenie konta / reset hasła / magic link).
  const verifyUrl =
    `${supabaseUrl}/auth/v1/verify?token=${encodeURIComponent(tokenHash)}` +
    `&type=${encodeURIComponent(actionType)}&redirect_to=${encodeURIComponent(redirectTo)}`;

  const { type, data } = buildEmail(actionType, verifyUrl, firstName);

  try {
    const render = renderEmail as (
      t: EmailType,
      l: Locale,
      d: Record<string, unknown>,
    ) => Promise<{ subject: string; html: string }>;
    const { subject, html } = await render(type, locale, data);
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({ from, to: email, subject, html });
    if (result.error) throw new Error(result.error.message);
    return Response.json({ ok: true });
  } catch (err) {
    captureError(err, { area: 'auth.email-hook', actionType });
    // GoTrue może ponowić; nie ujawniamy szczegółów.
    return Response.json({ error: 'send failed' }, { status: 500 });
  }
}
