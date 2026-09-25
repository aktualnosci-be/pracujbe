import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { Pool } from 'pg';
import type { Locale } from './stack';

/**
 * Kroki UI przepływu na prawdziwej bazie (#351, #66): formularze Better Auth, panele i Server
 * Actions w przeglądarce. Kontrolki wybieramy rolą i nazwą z `src/messages` (zasada #376) —
 * te same pliki co aplikacja, bez literałów w teście.
 */

export const PASSWORD = 'RealFlowUi123';
/** Nazwa cookie sesji Better Auth (useSecureCookies: prefiks `__Secure-`). */
export const SESSION_COOKIE = '__Secure-better-auth.session_token';

type Tree = { [key: string]: string | Tree };
const cache = new Map<string, Tree>();

/** Tekst z `src/messages/<locale>.json` po ścieżce, z prostym podstawieniem `{param}`. */
export function msg(locale: Locale, path: string, params: Record<string, string | number> = {}): string {
  let tree = cache.get(locale);
  if (!tree) {
    tree = JSON.parse(readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8')) as Tree;
    cache.set(locale, tree);
  }
  let node: string | Tree | undefined = tree;
  for (const part of path.split('.')) node = typeof node === 'object' ? node[part] : undefined;
  if (typeof node !== 'string') throw new Error(`Brak klucza ${locale}:${path}`);
  return node.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

/**
 * Nazwa kontrolki z etykietą rich-text (np. `agreeTermsLinks`): początek przed pierwszym
 * znacznikiem — linki w etykiecie dokładają podpowiedź „otwiera się w nowej karcie”.
 */
export const richLabel = (text: string) => new RegExp(`^${escape(text.split('<')[0]!.trim())}`);

/** Wyrażenie dokładnie dopasowujące tekst (escape znaków specjalnych). */
export const exact = (text: string) => new RegExp(`^${escape(text)}$`);

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Formularz rejestracji (kandydat albo pracodawca) — tylko pola widoczne dla użytkownika. */
export async function registerThroughForm(page: Page, options: {
  locale: Locale;
  email: string;
  name: [string, string];
  company?: string;
}): Promise<void> {
  const { locale, email, name, company } = options;
  const t = (key: string) => msg(locale, `auth.${key}`);
  await page.goto(`/${locale}/${company ? 'rejestracja-pracodawca' : 'rejestracja'}`);
  if (company) await page.getByLabel(t('companyName'), { exact: true }).fill(company);
  await page.getByLabel(t('firstName'), { exact: true }).fill(name[0]);
  await page.getByLabel(t('lastName'), { exact: true }).fill(name[1]);
  await page.getByLabel(t('email'), { exact: true }).fill(email);
  await page.getByLabel(t('password'), { exact: true }).fill(PASSWORD);
  await page.getByLabel(t('passwordConfirm'), { exact: true }).fill(PASSWORD);
  // #493: regulamin i informacja o prywatności to osobne pola (zgoda marketingowa zostaje pusta).
  await page.getByRole('checkbox', { name: richLabel(t('termsAcceptLinks')) }).check();
  await page.getByRole('checkbox', { name: richLabel(t('privacyNoticeAckLinks')) }).check();
  // #492: kandydat deklaruje próg wieku (bez daty urodzenia).
  if (!company) {
    await page.getByRole('checkbox', { name: t('ageConfirm').replace('{age}', '18'), exact: true }).check();
  }
  await page.getByRole('button', { name: t('submitRegister'), exact: true }).click();
  await page.waitForURL(`**/${locale}/potwierdzenie`);
}

/**
 * Link potwierdzenia z trwałej kolejki wiadomości kont (0061) — to, co worker wysłałby e-mailem.
 * Zwraca też język zlecenia (Invariant #1: język odbiorcy z rejestracji).
 */
export async function verificationLink(admin: Pool, email: string): Promise<{ path: string; locale: string }> {
  const { rows } = await admin.query<{ token: string; locale: string }>(
    `SELECT o.token, o.locale FROM auth.email_outbox o JOIN auth.users u ON u.id = o.user_id
      WHERE u.email = $1 AND o.kind = 'verification' AND o.status = 'queued'
      ORDER BY o.created_at DESC LIMIT 1`, [email]);
  const row = rows[0];
  if (!row) throw new Error(`Brak zlecenia weryfikacji dla ${email}.`);
  return { path: `/${row.locale}/potwierdz-email#token=${row.token}`, locale: row.locale };
}

/** Otwiera link potwierdzenia i klika „Potwierdź adres” (skaner poczty nie aktywuje konta). */
export async function confirmThroughLink(page: Page, admin: Pool, email: string, locale: Locale): Promise<void> {
  const link = await verificationLink(admin, email);
  expect(link.locale).toBe(locale);
  await page.goto(link.path);
  await page.getByRole('button', { name: msg(locale, 'auth.confirmEmailSubmit'), exact: true }).click();
}

/** Formularz logowania. */
export async function signInThroughForm(page: Page, locale: Locale, email: string, password = PASSWORD): Promise<void> {
  await page.goto(`/${locale}/logowanie`);
  await page.getByLabel(msg(locale, 'auth.email'), { exact: true }).fill(email);
  await page.getByLabel(msg(locale, 'auth.password'), { exact: true }).fill(password);
  await page.getByRole('button', { name: msg(locale, 'auth.submitLogin'), exact: true }).click();
}

/** Nagłówek `Cookie` z sesją przeglądarki — ten sam nośnik tożsamości co żądania strony. */
export async function sessionCookieHeader(context: BrowserContext): Promise<string> {
  const session = (await context.cookies()).find((cookie) => cookie.name === SESSION_COOKIE);
  if (!session) throw new Error('Brak cookie sesji w przeglądarce.');
  return `${session.name}=${session.value}`;
}

/** Nowy kontekst przeglądarki z sesją wydaną przez Better Auth (np. konto założone przez API). */
export async function contextWithSession(browser: Browser, baseURL: string, cookie: string): Promise<BrowserContext> {
  const [name, ...value] = cookie.split(';')[0]!.split('=');
  const context = await browser.newContext();
  await context.addCookies([{
    // `url` z http:// odrzuca cookie Secure w CDP; domena + ścieżka jak po Set-Cookie z serwera.
    name: name!, value: value.join('='), domain: new URL(baseURL).hostname, path: '/',
    httpOnly: true, secure: true, sameSite: 'Lax',
  }]);
  return context;
}

/** Wybór opcji w kontrolce Radix Select (trigger → listbox → option). */
export async function chooseOption(page: Page, trigger: ReturnType<Page['locator']>, option: string): Promise<void> {
  await trigger.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
