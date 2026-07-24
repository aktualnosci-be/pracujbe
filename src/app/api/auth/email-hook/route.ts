import { createHmac, timingSafeEqual } from 'node:crypto';

import { Resend } from 'resend';

import { renderEmail } from '@/emails/templates';
import type { EmailType } from '@/emails/copy';
import { routing, type Locale } from '@/i18n/routing';
import { env } from '@/lib/env';
import { captureError } from '@/lib/sentry';

/**
 * Supabase Auth „Send Email Hook" — wysyłka transakcyjnych e-maili Auth (potwierdzenie konta,
 * reset hasła, magic link) W JĘZYKU ODBIORCY (INVARIANT #1), zamiast domyślnych, jednojęzycznych
 * szablonów GoTrue.
 *
 * Konfiguracja (operacyjna, Supabase Dashboard → Authentication → Hooks → Send Email):
 *   URL:   https://<domena>/api/auth/email-hook
 *   Secret: SEND_EMAIL_HOOK_SECRET (format Standard Webhooks: 'whsec_<base64>')
 * Bez tej konfiguracji hook nie jest wołany, a GoTrue używa swoich szablonów (bezpieczny fallback).
 *
 * Bezpieczeństwo: weryfikacja podpisu Standard Webhooks (HMAC-SHA256, porównanie stałoczasowe).
 * Bez sekretu / bez klucza Resend → 500 (misconfiguracja) lub 200 no-op (patrz niżej), NIGDY nie
 * ujawniamy technikaliów w treści.
 */

export const runtime = 'nodejs';

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
  const id = headers.get('webhook-id');
  const timestamp = headers.get('webhook-signature-timestamp') ?? headers.get('webhook-timestamp');
  const sigHeader = headers.get('webhook-signature');
  if (!id || !timestamp || !sigHeader) return false;

  const base64Secret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(base64Secret, 'base64');
  } catch {
    return false;
  }
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64');
  const expectedBuf = Buffer.from(expected);

  // Nagłówek może zawierać wiele podpisów oddzielonych spacją, każdy w formie 'v1,<sig>'.
  for (const part of sigHeader.split(' ')) {
    const value = part.includes(',') ? part.split(',')[1] : part;
    if (!value) continue;
    const candidate = Buffer.from(value);
    if (candidate.length === expectedBuf.length && timingSafeEqual(candidate, expectedBuf)) {
      return true;
    }
  }
  return false;
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

  // Hook nieskonfigurowany — nie powinien być wołany; zwróć 200 no-op (bez ujawniania).
  if (!secret || !apiKey || !supabaseUrl) {
    return Response.json({ ok: true, skipped: true });
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
