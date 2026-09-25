/**
 * Adres webhooka błędów (#571) — `ERROR_WEBHOOK_URL`, tylko po stronie serwera.
 *
 * Dwie postaci adresu Discorda: natywna `https://discord.com/api/webhooks/<id>/<token>`
 * (payload `{content, allowed_mentions}`) i zgodna ze Slackiem — ten sam adres z końcówką
 * `/slack` (payload `{text}`). Inny host, schemat, port, dane logowania, query albo fragment =
 * adres odrzucony (brak wysyłki). Adresu nie logujemy i nie zwracamy w komunikatach.
 */
export type ErrorWebhookFormat = 'discord' | 'slack';

export interface ErrorWebhookTarget {
  url: string;
  format: ErrorWebhookFormat;
}

const HOSTS = new Set(['discord.com', 'discordapp.com']);
const PATH_RE = /^\/api\/webhooks\/(\d{5,25})\/([A-Za-z0-9_-]{20,200})(\/slack)?\/?$/;

export function parseErrorWebhookUrl(raw: string | undefined | null): ErrorWebhookTarget | null {
  const value = raw?.trim();
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (!HOSTS.has(parsed.hostname.toLowerCase())) return null;
  if (parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  const match = PATH_RE.exec(parsed.pathname);
  if (!match) return null;
  const format: ErrorWebhookFormat = match[3] ? 'slack' : 'discord';
  const path = `/api/webhooks/${match[1]}/${match[2]}${match[3] ?? ''}`;
  return { url: `https://${parsed.hostname.toLowerCase()}${path}`, format };
}

/** Webhook z env (pusty/niepoprawny = null → nic nie wysyłamy, `/api/health` = false). */
export function errorWebhookFromEnv(): ErrorWebhookTarget | null {
  return parseErrorWebhookUrl(process.env.ERROR_WEBHOOK_URL);
}
