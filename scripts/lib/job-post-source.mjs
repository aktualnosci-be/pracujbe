/**
 * Źródło danych posta 1080 × 1080 (#181, #186). Eksporter nie przyjmuje danych oferty od
 * operatora (pliku JSON, flag CLI): jedynym źródłem jest wąski odczyt `get_campaign_job`
 * (migracja 0105) wykonany jak w portalu — ograniczony login aplikacji (`DATABASE_APP_URL`)
 * i `SET LOCAL ROLE anon`. RPC zwraca wiersz tylko dla oferty `active`, nieusuniętej,
 * niewygasłej, niedemonstracyjnej (`is_demo = false` oferty i firmy) i firmy `verified`;
 * każdy inny przypadek daje ten sam błąd „oferta niedostępna”. Kolumny to wyłącznie pola
 * grafiki (bez identyfikatorów, kontaktu i opisu).
 *
 * Obiekt oferty jest zamrożony i zarejestrowany w prywatnym `WeakSet`: renderer odmawia pracy
 * z obiektem zbudowanym ręcznie (np. `{ ...oferta, isDemo: false, status: "active" }`).
 */

export const LOCALES = Object.freeze(["pl", "nl", "fr", "en"]);
export const SITE_ORIGIN = "https://pracuj.be";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 200;
const trustedJobs = new WeakSet();

export class JobUnavailableError extends Error {
  constructor() {
    super(
      "Oferta niedostępna do eksportu: nie istnieje, nie jest aktywna, wygasła, jest demonstracyjna albo firma nie jest zweryfikowana.",
    );
    this.name = "JobUnavailableError";
  }
}

export function validateSlug(slug) {
  if (
    typeof slug !== "string" ||
    slug.length > MAX_SLUG_LENGTH ||
    !SLUG.test(slug)
  ) {
    throw new Error(
      "slug: podaj identyfikator oferty z adresu (małe litery, cyfry i myślniki), a nie plik z danymi.",
    );
  }
  return slug;
}

export function validateLocale(locale) {
  if (!LOCALES.includes(locale)) {
    throw new Error(`locale: obsługiwane języki to ${LOCALES.join(", ")}.`);
  }
  return locale;
}

export function jobUrl(slug, locale) {
  return `${SITE_ORIGIN}/${locale}/oferty-pracy/${slug}`;
}

export function isTrustedJob(job) {
  return typeof job === "object" && job !== null && trustedJobs.has(job);
}

const optionalNumber = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const optionalText = (value) => (typeof value === "string" ? value : null);

/**
 * Wczytuje ofertę przez `query(slug, locale)` (zwraca wiersze `get_campaign_job`) i zwraca
 * tylko pola potrzebne grafice. Filtry (status, demo, wygaśnięcie, weryfikacja) egzekwuje baza
 * — wiersz spoza RPC nie ma czym ich „potwierdzić”; każdy brak daje identyczny
 * `JobUnavailableError`.
 */
export async function loadExportableJob({ slug, locale, query }) {
  validateSlug(slug);
  validateLocale(locale);
  const rows = await query(slug, locale);
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (!row || row.slug !== slug) {
    throw new JobUnavailableError();
  }
  const job = Object.freeze({
    slug,
    locale,
    url: jobUrl(slug, locale),
    title: optionalText(row.title),
    companyName: optionalText(row.company_name),
    city: optionalText(row.city),
    region: optionalText(row.region),
    contractType: optionalText(row.contract_type),
    accommodation: row.accommodation === true,
    salaryMin: optionalNumber(row.salary_min),
    salaryMax: optionalNumber(row.salary_max),
    currency: optionalText(row.currency),
    salaryPeriod: optionalText(row.salary_period),
  });
  trustedJobs.add(job);
  return job;
}

const CAMPAIGN_JOB_SQL = `SELECT slug, title, company_name, city, region,
  contract_type, accommodation, salary_min, salary_max, currency, salary_period
  FROM public.get_campaign_job(p_slug => $1::text, p_locale => $2::text)`;

/**
 * Odrzuca login migratora/superusera: `SET ROLE anon` nie odbiera mu uprawnień
 * (ta sama zasada co `createRuntimePool` w `src/lib/db/pool.ts`).
 */
export async function assertRestrictedLogin(client) {
  const result = await client.query(
    "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = session_user",
  );
  const role = result.rows?.[0];
  if (!role || role.rolsuper !== false || role.rolbypassrls !== false) {
    throw new Error(
      "DATABASE_APP_URL: użyj ograniczonego loginu aplikacji, nie konta migratora ani superusera.",
    );
  }
}

/** Zapytanie w transakcji gościa — jak `withUserTransaction(pool, null, …)` w portalu. */
export function createAnonJobQuery(client) {
  return async (slug, locale) => {
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL ROLE anon");
      await client.query("SELECT set_config('app.current_uid', '', true)");
      const result = await client.query(CAMPAIGN_JOB_SQL, [slug, locale]);
      await client.query("COMMIT");
      return result.rows;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  };
}

/** Połączenie z `DATABASE_APP_URL`; zwraca ofertę i zamyka klienta. */
export async function fetchExportableJob({ slug, locale, connectionString }) {
  validateSlug(slug);
  validateLocale(locale);
  if (!connectionString) {
    throw new Error(
      "DATABASE_APP_URL: ustaw adres ograniczonego połączenia aplikacji (odczyt publiczny).",
    );
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString,
    statement_timeout: 30000,
  });
  await client.connect();
  try {
    await assertRestrictedLogin(client);
    return await loadExportableJob({
      slug,
      locale,
      query: createAnonJobQuery(client),
    });
  } finally {
    await client.end();
  }
}
