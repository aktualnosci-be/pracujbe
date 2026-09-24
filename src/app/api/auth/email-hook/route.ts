import { Resend } from 'resend';

import type { createAdminClient } from '@/lib/supabase/admin';
import { renderEmail } from '@/emails/templates';
import type { EmailType } from '@/emails/copy';
import type { Locale } from '@/i18n/routing';
import { authEmailLocale, buildAuthEmail, type AuthRecipientProfile } from '@/lib/email/auth-email';
import { takeAuthSendBudget } from '@/lib/email/auth-send-budget';
import { emailFromEnv } from '@/lib/email/sender';
import { env } from '@/lib/env';
import { readTextWithLimit } from '@/lib/http/read-limited';
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

/** Limit rozmiaru body (SEC-14): payloady Auth są małe; oversize odrzucamy przed alokacją. */
const MAX_BODY_BYTES = 200_000;

interface HookPayload {
  user?: { id?: string; email?: string; user_metadata?: Record<string, unknown> };
  email_data?: {
    token_hash?: string;
    email_action_type?: string;
    redirect_to?: string;
  };
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

/**
 * #291: kolumny języka z profilu odbiorcy (service role, po `user.id`). Best-effort — brak
 * profilu / błąd odczytu → `null` (język z metadanych rejestracji, końcowo 'en').
 */
async function readRecipientProfile(
  admin: ReturnType<typeof createAdminClient> | null,
  userId: string | undefined,
): Promise<AuthRecipientProfile | null> {
  if (!userId) return null;
  try {
    const client = admin ?? (await import('@/lib/supabase/admin')).createAdminClient();
    const { data, error } = await client
      .from('profiles')
      .select('preferred_locale, account_locale, signup_locale')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      captureError(error, { area: 'auth.email-hook.profile' });
      return null;
    }
    return (data as AuthRecipientProfile | null) ?? null;
  } catch (err) {
    captureError(err, { area: 'auth.email-hook.profile' });
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET;
  const apiKey = process.env.RESEND_API_KEY;
  const from = emailFromEnv();
  const supabaseUrl = env.supabaseUrl;

  // Hook został wołany, ale ten deployment nie ma pełnej konfiguracji (dryf env: brak sekretu/
  // klucza/URL). NIE zwracamy „cichego" 200 — GoTrue uznałby e-mail za dostarczony i porzucił
  // go bez śladu. 500 czyni błąd widocznym (GoTrue retry / Sentry), bez ujawniania technikaliów.
  if (!secret || !apiKey || !supabaseUrl) {
    captureError(new Error('email-hook called without full configuration'), { area: 'auth.email-hook' });
    return Response.json({ error: 'not configured' }, { status: 500 });
  }

  // SEC-14 + P2-05: twardy limit body przy STREAMINGU (nie tylko po nagłówku Content-Length,
  // który bywa nieobecny/chunked/sfałszowany) — oversize odrzucany przed pełną alokacją i podpisem.
  const bodyRead = await readTextWithLimit(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return Response.json({ error: 'payload too large' }, { status: 413 });
  const rawBody = bodyRead.text;
  if (!verifySignature(secret, request.headers, rawBody)) {
    return Response.json({ error: 'invalid signature' }, { status: 401 });
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(rawBody) as HookPayload;
  } catch {
    return Response.json({ error: 'invalid payload' }, { status: 400 });
  }

  // #45: atomowy budżet puli `auth` (0087). Rezerwy chronią tę pulę przed newsletterem
  // i powiadomieniami; odmowa = dostawca już wyczerpał limit okna → 503 + Retry-After, a
  // GoTrue ponowi (bez wysyłki, która i tak odbiłaby się od limitu dostawcy). PRZED claimem
  // inboxu: odmowa nie zostawia dzierżawy, która kazałaby pominąć ponowienie.
  const budget = await takeAuthSendBudget(
    null,
    buildAuthEmail(payload.email_data?.email_action_type ?? 'signup', '', undefined).type,
  );
  if (budget.status === 'denied') {
    return Response.json(
      { error: 'rate limited' },
      { status: 503, headers: { 'Retry-After': String(budget.retryAfterSeconds) } },
    );
  }

  // P0-02 + SEC-14: inbox ze stanem (anty-replay). Duplikatem do pominięcia jest WYŁĄCZNIE wpis
  // `completed`. Claim wstawia `processing`; oznaczamy `completed` dopiero po udanej WYSYŁCE —
  // awaria przed wysyłką NIE blokuje ponowienia (koniec „duplicate", które gubiło potwierdzenie/
  // reset konta na zawsze). Ponowna wysyłka to mniejsze zło niż trwała utrata; okno retry GoTrue
  // jest krótkie. Bez `webhook-id` claim pomijamy (podpis + świeżość ograniczają replay).
  const webhookId = request.headers.get('webhook-id');
  const inboxId = webhookId ? `auth:${webhookId}` : null;
  let admin: ReturnType<typeof createAdminClient> | null = null;
  if (inboxId) {
    try {
      const [{ createAdminClient: makeAdmin }, { claimWebhook }] = await Promise.all([
        import('@/lib/supabase/admin'),
        import('@/lib/webhook-inbox'),
      ]);
      admin = makeAdmin();
      const claim = await claimWebhook(admin, inboxId, 'auth-email-hook');
      if (claim === 'duplicate') return Response.json({ ok: true, duplicate: true });
      // P2-06: inny worker trzyma świeżą dzierżawę → pomiń, by nie wysłać e-maila dwa razy.
      if (claim === 'locked') return Response.json({ ok: true, locked: true });
      // 'claimed' | 'error' → wysyłamy dalej (dla 'error' inbox nieosiągalny; podpis+świeżość chronią).
    } catch {
      admin = null; // best-effort — awaria infry inboxu nie blokuje e-maila.
    }
  }


  const email = payload.user?.email;
  const meta = payload.user?.user_metadata ?? {};
  const actionType = payload.email_data?.email_action_type ?? 'signup';
  const tokenHash = payload.email_data?.token_hash;
  const redirectTo = payload.email_data?.redirect_to ?? env.siteUrl;
  if (!email || !tokenHash) {
    return Response.json({ error: 'missing fields' }, { status: 400 });
  }

  // INVARIANT #1: preferred_locale → account_locale → signup_locale → 'en' (#291).
  const profile = await readRecipientProfile(admin, payload.user?.id);
  const locale: Locale = authEmailLocale(profile, meta);
  const firstName = typeof meta['first_name'] === 'string' ? (meta['first_name'] as string) : undefined;

  // Link weryfikacyjny GoTrue (potwierdzenie konta / reset hasła / magic link).
  const verifyUrl =
    `${supabaseUrl}/auth/v1/verify?token=${encodeURIComponent(tokenHash)}` +
    `&type=${encodeURIComponent(actionType)}&redirect_to=${encodeURIComponent(redirectTo)}`;

  const { type, data } = buildAuthEmail(actionType, verifyUrl, firstName);

  try {
    const render = renderEmail as (
      t: EmailType,
      l: Locale,
      d: Record<string, unknown>,
    ) => Promise<{ subject: string; html: string; text: string }>;
    const { subject, html, text } = await render(type, locale, data);
    const resend = new Resend(apiKey);
    // Idempotency key = stabilny webhook-id (P0-02): ponowna wysyłka tego samego zdarzenia jest
    // deduplikowana po stronie Resend, gdyby GoTrue ponowił po tym, jak wysyłka się powiodła,
    // a oznaczenie `completed` nie.
    const idempotencyKey = webhookId ?? undefined;
    const result = await resend.emails.send(
      { from, to: email, subject, html, text },
      idempotencyKey ? { idempotencyKey } : undefined,
    );
    if (result.error) throw new Error(result.error.message);
    // Wysłano → oznacz inbox `completed` (dopiero teraz duplikat będzie pomijany).
    if (admin && inboxId) {
      try {
        const { completeWebhook } = await import('@/lib/webhook-inbox');
        await completeWebhook(admin, inboxId);
      } catch {
        // best-effort — brak oznaczenia najwyżej dopuści (idempotentne po Resend) ponowienie.
      }
    }
    return Response.json({ ok: true });
  } catch (err) {
    captureError(err, { area: 'auth.email-hook', actionType });
    // GoTrue może ponowić; nie ujawniamy szczegółów.
    return Response.json({ error: 'send failed' }, { status: 500 });
  }
}
