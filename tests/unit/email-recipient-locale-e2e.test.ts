import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EmailType } from "@/emails/copy";
import { renderEmail } from "@/emails/templates";
import { routing, type Locale } from "@/i18n/routing";
import { processEmailQueue } from "@/lib/email/outbox";
import { resolveRecipientLocale } from "@/lib/i18n/recipient-locale";
import { fakeDb, resetFakeDb } from "../helpers/fake-db";

/**
 * #348 — Invariant #1 na całej ścieżce: enqueue → worker → render.
 *
 * 1. Kontrakt SQL: najnowsze definicje `resolve_recipient_locale` i `enqueue_email` z
 *    `supabase/migrations` (tych funkcji używa produkcja) mają kolejność fallbacku
 *    preferred → account → signup → 'en' i biorą język z profilu ODBIORCY (`p_profile_id`).
 *    Ta sama tabela przypadków daje ten sam wynik w SQL i w `resolveRecipientLocale` (TS,
 *    używany przez e-maile Auth).
 * 2. Enqueue → worker: wiersz `email_deliveries` powstaje z locale wyliczonym regułą z SQL dla
 *    odbiorcy; `processEmailQueue` renderuje i wysyła temat/HTML/link w tym języku, choć nadawca
 *    ma inny język, a domyślny język serwera to 'pl'.
 * 3. Kontrola ujemna: wiersz z locale NADAWCY nie przechodzi tej samej asercji.
 */

// --- 1. Kontrakt SQL ------------------------------------------------------------------------

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");

/** Treść najnowszej definicji funkcji (migracje w kolejności prefiksu; wygrywa ostatnia). */
function latestFunctionBody(name: string): { file: string; body: string } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let found: { file: string; body: string } | null = null;
  const header = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`,
    "gi",
  );
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
    for (const match of sql.matchAll(header)) {
      const start = match.index ?? 0;
      const open = sql.indexOf("$$", start);
      const close = sql.indexOf("$$", open + 2);
      if (open < 0 || close < 0)
        throw new Error(`${file}: brak ciała $$ dla ${name}`);
      found = { file, body: sql.slice(start, close + 2) };
    }
  }
  if (!found) throw new Error(`Nie znaleziono definicji public.${name}`);
  return found;
}

type LocaleColumn = "preferred_locale" | "account_locale" | "signup_locale";
type RecipientProfile = Partial<Record<LocaleColumn, string | null>>;

interface ParsedResolver {
  steps: Array<{ column: LocaleColumn; allowed: string[] }>;
  elseLocale: string;
  missingProfileLocale: string;
}

/** Parsuje CASE z `resolve_recipient_locale` do postaci wykonywalnej w teście. */
function parseResolver(body: string): ParsedResolver {
  const steps = [
    ...body.matchAll(/when\s+p\.(\w+)\s+in\s*\(([^)]*)\)\s+then\s+p\.(\w+)/gi),
  ].map((m) => {
    if (m[1] !== m[3])
      throw new Error(`Gałąź sprawdza ${m[1]}, a zwraca ${m[3]}`);
    return {
      column: m[1] as LocaleColumn,
      allowed: [...m[2]!.matchAll(/'([^']+)'/g)].map((a) => a[1]!),
    };
  });
  const elseLocale = /else\s+'([^']+)'\s+end/i.exec(body)?.[1];
  const missingProfileLocale = /\)\s*,\s*'([^']+)'\s*\)\s*;?\s*\$\$/i.exec(
    body,
  )?.[1];
  if (!elseLocale || !missingProfileLocale)
    throw new Error("Nie rozpoznano fallbacku w SQL");
  return { steps, elseLocale, missingProfileLocale };
}

const resolverSql = latestFunctionBody("resolve_recipient_locale");
const resolver = parseResolver(resolverSql.body);

/** Wynik `resolve_recipient_locale` (SQL) dla profilu; `null` = brak wiersza profilu. */
function sqlRecipientLocale(profile: RecipientProfile | null): string {
  if (!profile) return resolver.missingProfileLocale;
  for (const step of resolver.steps) {
    const value = profile[step.column];
    if (value != null && step.allowed.includes(value)) return value;
  }
  return resolver.elseLocale;
}

// Kolumny w bazie mają CHECK (0002) na małe litery z listy języków, więc tabela używa takich
// wartości; `null` oznacza pustą kolumnę.
const FALLBACK_CASES: Array<{
  name: string;
  profile: RecipientProfile;
  expected: Locale;
}> = [
  {
    name: "preferred wygrywa z account i signup",
    profile: {
      preferred_locale: "fr",
      account_locale: "nl",
      signup_locale: "pl",
    },
    expected: "fr",
  },
  {
    name: "bez preferred → account",
    profile: {
      preferred_locale: null,
      account_locale: "nl",
      signup_locale: "pl",
    },
    expected: "nl",
  },
  {
    name: "bez preferred i account → signup",
    profile: {
      preferred_locale: null,
      account_locale: null,
      signup_locale: "pl",
    },
    expected: "pl",
  },
  { name: "tylko signup en", profile: { signup_locale: "en" }, expected: "en" },
  {
    name: "pusty profil → en",
    profile: {
      preferred_locale: null,
      account_locale: null,
      signup_locale: null,
    },
    expected: "en",
  },
];

describe("resolve_recipient_locale (SQL) — kontrakt Invariantu #1", () => {
  it("kolejność: preferred → account → signup → en", () => {
    expect(resolver.steps.map((s) => s.column)).toEqual([
      "preferred_locale",
      "account_locale",
      "signup_locale",
    ]);
    expect(resolver.elseLocale).toBe("en");
    expect(resolver.missingProfileLocale).toBe("en");
  });

  it("każdy poziom akceptuje dokładnie obsługiwane języki (routing.locales)", () => {
    for (const step of resolver.steps) {
      expect([...step.allowed].sort()).toEqual([...routing.locales].sort());
    }
  });

  it.each(FALLBACK_CASES)(
    "$name: SQL i TS dają $expected",
    ({ profile, expected }) => {
      expect(sqlRecipientLocale(profile)).toBe(expected);
      expect(resolveRecipientLocale(profile)).toBe(expected);
    },
  );

  it("brak profilu odbiorcy → en", () => {
    expect(sqlRecipientLocale(null)).toBe("en");
  });
});

describe("enqueue_email (SQL) — locale z profilu odbiorcy", () => {
  // #45 (0101): enqueue_email deleguje do enqueue_email_outcome z tym samym odbiorcą —
  // kontrakt locale sprawdzamy na ciele, które faktycznie wstawia wiersz.
  const wrapper = latestFunctionBody("enqueue_email").body;
  const delegates = /public\.enqueue_email_outcome\(\s*p_profile_id\b/i.test(wrapper);
  const { body } = delegates ? latestFunctionBody("enqueue_email_outcome") : { body: wrapper };

  it("wrapper przekazuje odbiorcę bez zmian (bez własnego locale)", () => {
    if (!delegates) return;
    expect(wrapper).not.toMatch(/resolve_recipient_locale|auth\.uid\(\)/i);
  });

  it("wylicza locale z p_profile_id (odbiorca) i zapisuje je w wierszu", () => {
    expect(body).toMatch(
      /v_locale\s*:=\s*public\.resolve_recipient_locale\(\s*p_profile_id\s*\)/i,
    );
    expect(body).toMatch(
      /insert\s+into\s+public\.email_deliveries[\s\S]*\blocale\b[\s\S]*values[\s\S]*\bv_locale\b/i,
    );
  });

  it("nie sięga po język nadawcy/sesji ani oferty", () => {
    expect(body).not.toMatch(/auth\.uid\(\)/i);
    expect(body).not.toMatch(/default_locale/i);
    expect(body).not.toMatch(/resolve_recipient_locale\(\s*(?!p_profile_id)/i);
  });
});

// --- 2. Enqueue → worker → render -----------------------------------------------------------

const { send } = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));
vi.mock("@/lib/db/portal", async () => (await import("../helpers/fake-db")).fakePortal());
vi.mock("@/lib/sentry", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  isProductionMode: () => true,
}));

const SITE = "https://pracuj.be";

type Render = (
  t: EmailType,
  l: Locale,
  d: Record<string, unknown>,
) => Promise<{ subject: string; html: string }>;
const render = renderEmail as Render;

interface Party {
  id: string;
  email: string;
  profile: RecipientProfile;
}

/**
 * Odpowiednik `enqueue_email`: wiersz kolejki dla odbiorcy z locale wyliczonym regułą
 * sparsowaną z najnowszej migracji. `localeOf` pozwala kontroli ujemnej podstawić język nadawcy.
 */
function enqueue(
  recipient: Party,
  template: EmailType,
  payload: Record<string, unknown>,
  localeOf: (p: Party) => string = (p) => sqlRecipientLocale(p.profile),
) {
  return {
    id: `delivery-${recipient.id}-${template}`,
    profile_id: recipient.id,
    to_email: recipient.email,
    template,
    locale: localeOf(recipient),
    payload,
    attempts: 0,
  };
}

interface SentMail {
  to: string;
  subject: string;
  html: string;
}

/** Asercja Invariantu #1 na wysłanym mailu: temat, `lang`, prefiks linku = język odbiorcy. */
async function assertRecipientLanguage(
  mail: SentMail,
  template: EmailType,
  payload: Record<string, unknown>,
  recipientLocale: Locale,
  targetPath: string,
) {
  const expected = await render(template, recipientLocale, {
    ...payload,
    firstName: "Ola",
  });
  expect(mail.subject).toBe(expected.subject);
  expect(mail.html).toContain(`lang="${recipientLocale}"`);
  expect(mail.html).toContain(`${SITE}/${recipientLocale}${targetPath}`);
}


/** #45: claim zwraca wiersze, budżet wysyłki (0087) zawsze przyznany w tych testach. */
function mockClaim(result: { data: unknown[] }) {
  fakeDb.rpc("claim_email_batch", result.data);
  fakeDb.rpc("take_email_send_budget", [{ granted: true, retry_at: null }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test";
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  // Pułapka: domyślny język serwera nie może wpływać na język odbiorcy.
  process.env.NEXT_PUBLIC_DEFAULT_LOCALE = "pl";
  send.mockResolvedValue({ data: { id: "provider-1" }, error: null });
  resetFakeDb(null)
    .rows("email.outbox.recipient-names", [{ id: "recipient", first_name: "Ola" }])
    .exec("email.outbox.mark-sent")
    .exec("email.outbox.mark-failed");
});

async function runWorker(
  rows: ReturnType<typeof enqueue>[],
): Promise<SentMail[]> {
  mockClaim({ data: rows });
  const result = await processEmailQueue();
  expect(result).toMatchObject({
    processed: rows.length,
    sent: rows.length,
    failed: 0,
    ok: true,
  });
  return send.mock.calls.map(([m]) => m as SentMail);
}

// Nadawca zawsze w innym języku niż odbiorca (pl — jak domyślny język serwera).
const SENDER: Party = {
  id: "sender",
  email: "sender@example.test",
  profile: { preferred_locale: "pl", signup_locale: "pl" },
};

const FLOWS: Array<{
  template: EmailType;
  path: string;
  payload: Record<string, unknown>;
}> = [
  {
    template: "newApplication",
    path: "/employer/aplikacje",
    payload: { candidateName: "Jan Kowalski", jobTitle: "Magazynier" },
  },
  {
    template: "statusChanged",
    path: "/candidate/aplikacje",
    payload: {
      companyName: "Acme",
      jobTitle: "Magazynier",
      status: "shortlisted",
    },
  },
  {
    template: "jobOffer",
    path: "/candidate/propozycje",
    payload: { companyName: "Acme", jobTitle: "Magazynier" },
  },
  {
    template: "offerAccepted",
    path: "/employer/aplikacje",
    payload: { candidateName: "Jan Kowalski", jobTitle: "Magazynier" },
  },
  {
    template: "offerDeclined",
    path: "/employer/kandydaci",
    payload: { candidateName: "Jan Kowalski", jobTitle: "Magazynier" },
  },
  {
    template: "newMessage",
    path: "/candidate/wiadomosci",
    payload: { senderName: "Acme", panel: "candidate" },
  },
];

describe("enqueue → processEmailQueue → render: język odbiorcy, nie nadawcy", () => {
  const nonPolish = FALLBACK_CASES.filter((c) => c.expected !== "pl");

  describe.each(nonPolish)(
    "odbiorca: $name ($expected)",
    ({ profile, expected }) => {
      const recipient: Party = {
        id: "recipient",
        email: "recipient@example.test",
        profile,
      };

      it.each(FLOWS)(
        "$template",
        async ({ template, path: targetPath, payload }) => {
          expect(sqlRecipientLocale(SENDER.profile)).not.toBe(expected);
          const [mail] = await runWorker([
            enqueue(recipient, template, payload),
          ]);
          await assertRecipientLanguage(
            mail!,
            template,
            payload,
            expected,
            targetPath,
          );
          const senderVersion = await render(template, "pl", {
            ...payload,
            firstName: "Ola",
          });
          expect(mail!.subject).not.toBe(senderVersion.subject);
          expect(mail!.html).not.toContain(`${SITE}/pl/`);
        },
      );
    },
  );

  it("odbiorca pl, nadawca nl: mail po polsku (wynik nie zależy od kierunku)", async () => {
    const recipient: Party = {
      id: "recipient",
      email: "r@example.test",
      profile: { signup_locale: "pl" },
    };
    const sender: Party = {
      id: "sender",
      email: "s@example.test",
      profile: { preferred_locale: "nl" },
    };
    const flow = FLOWS[2]!;
    const [mail] = await runWorker([
      enqueue(recipient, flow.template, flow.payload),
    ]);
    await assertRecipientLanguage(
      mail!,
      flow.template,
      flow.payload,
      "pl",
      flow.path,
    );
    expect(sqlRecipientLocale(sender.profile)).toBe("nl");
    expect(mail!.html).not.toContain(`${SITE}/nl/`);
  });

  // --- 3. Kontrola ujemna -------------------------------------------------------------------
  it("kontrola ujemna: locale nadawcy w kolejce łamie asercję języka odbiorcy", async () => {
    const recipient: Party = {
      id: "recipient",
      email: "recipient@example.test",
      profile: { preferred_locale: "fr", signup_locale: "nl" },
    };
    const flow = FLOWS[0]!;
    const wrongRow = enqueue(recipient, flow.template, flow.payload, () =>
      sqlRecipientLocale(SENDER.profile),
    );
    expect(wrongRow.locale).toBe("pl");
    const [mail] = await runWorker([wrongRow]);
    await expect(
      assertRecipientLanguage(
        mail!,
        flow.template,
        flow.payload,
        "fr",
        flow.path,
      ),
    ).rejects.toThrow();
  });
});
