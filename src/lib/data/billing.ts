/**
 * Warstwa danych płatności/subskrypcji pracodawcy — Pracuj.be (Etap 7h, scaffold).
 *
 * Strategia spójna z `@/lib/data/company`/`@/lib/data/employer`: przy skonfigurowanej bazie
 * (`isPortalDataConfigured`, #25) dane czytane są pod SESJĄ zalogowanego użytkownika
 * (`withPortalTransaction`, RLS, NIGDY service-role). Bez konfiguracji (build/preview bez env)
 * zwracamy dane DEMO, dzięki czemu
 * ekran `/employer/platnosci` renderuje pełny widok (pakiety, subskrypcja, faktury) bez backendu.
 *
 * PROVIDER-GATED: realne rozliczenia wymagają zewnętrznego dostawcy (np. Stripe). Bez klucza
 * (`STRIPE_SECRET_KEY`) działamy w trybie podglądu — `providerConfigured=false`, akcje zwracają
 * `{ ok: true, demo: true }` (patrz `@/lib/actions/billing`). Ten moduł NIE integruje dostawcy.
 *
 * „Aktywna firma" = `getActiveCompanyId` (cookie zwalidowane względem aktywnych członkostw,
 * FUN-07) — jak w panelu pracodawcy. Odczyt subskrypcji/faktur wymaga roli owner/admin firmy (RLS
 * `subscriptions_select_admin` / `invoices_select_admin` → `is_company_admin`). Członek bez tej
 * roli zobaczy pusty stan.
 *
 * `discount_codes` NIE jest czytane tutaj (RLS: deny) — walidację kodu robi server action
 * service-rolem. Kontekst firmy importowany LENIWIE (moduł nie ciągnie `next/headers` do bundla
 * trybu DEMO).
 */

import { isBillingEnabled } from '@/lib/billing/flag';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { attempt, queryOne, queryRows } from '@/lib/db/sql';
import type { TransactionQuery } from '@/lib/db/transaction';
import { captureError } from '@/lib/sentry';
import { getSignedFileUrl } from '@/lib/storage';

/* ---------------------------------------------------------------------------
 * Kontrakty dla UI
 * ------------------------------------------------------------------------- */

/** Identyfikatory pakietów (stabilne, używane też przez server action). */
export type BillingPlanId = 'starter' | 'standard' | 'pro';

/** Statyczny opis pakietu. Teksty (nazwa, cechy) to KLUCZE i18n z namespace `billing`. */
export interface BillingPlan {
  id: BillingPlanId;
  /** Cena miesięczna w centach. */
  priceCents: number;
  currency: string;
  /** Wyróżniony pakiet (badge „Polecany"). */
  recommended: boolean;
  /** Sufiksy kluczy i18n (`billing.<key>`) z cechami pakietu. */
  features: string[];
}

/** Bieżąca subskrypcja firmy (znormalizowana). */
export interface BillingSubscription {
  id: string;
  /** Surowa nazwa/identyfikator planu z DB (mapowana na nazwę i18n w UI, fallback: surowa). */
  plan: string;
  /** Surowy `subscription_status`: trialing/active/past_due/canceled/incomplete/expired. */
  status: string;
  /** ISO koniec bieżącego okresu rozliczeniowego albo null. */
  currentPeriodEnd: string | null;
  /** ISO koniec okresu próbnego albo null. */
  trialEndsAt: string | null;
  /** ISO zaplanowanego anulowania (koniec okresu) albo null. */
  cancelAt: string | null;
  /** ISO faktycznego anulowania albo null. */
  canceledAt: string | null;
}

/** Faktura firmy (znormalizowana). */
export interface BillingInvoice {
  id: string;
  number: string | null;
  /** Surowy `invoice_status`: draft/open/paid/void/uncollectible. */
  status: string;
  amountCents: number;
  taxCents: number;
  currency: string;
  /** ISO daty wystawienia albo null. */
  issuedAt: string | null;
  /** Krótkotrwały signed URL do PDF (jeśli dostępny) albo null. */
  pdfUrl: string | null;
}

/** Komplet danych ekranu płatności. */
export interface BillingData {
  subscription: BillingSubscription | null;
  invoices: BillingInvoice[];
  plans: BillingPlan[];
  /** Czy skonfigurowano dostawcę płatności (STRIPE_SECRET_KEY). Bez niego UI pokazuje baner. */
  providerConfigured: boolean;
}

/* ---------------------------------------------------------------------------
 * Statyczna lista pakietów (współdzielona z server action do walidacji)
 * ------------------------------------------------------------------------- */

export const PLANS: BillingPlan[] = [
  {
    id: 'starter',
    priceCents: 4900,
    currency: 'EUR',
    recommended: false,
    features: ['starterFeat1', 'starterFeat2', 'starterFeat3'],
  },
  {
    id: 'standard',
    priceCents: 9900,
    currency: 'EUR',
    recommended: true,
    features: ['standardFeat1', 'standardFeat2', 'standardFeat3', 'standardFeat4'],
  },
  {
    id: 'pro',
    priceCents: 19900,
    currency: 'EUR',
    recommended: false,
    features: ['proFeat1', 'proFeat2', 'proFeat3', 'proFeat4'],
  },
];

/** Zbiór dozwolonych identyfikatorów pakietów (walidacja `startCheckout`). */
export const PLAN_IDS: ReadonlySet<string> = new Set(PLANS.map((plan) => plan.id));

/**
 * Czy skonfigurowano dostawcę płatności. LENIWY odczyt `process.env` (build bez env działa).
 * `STRIPE_SECRET_KEY` nie jest `NEXT_PUBLIC_*` — czytany wyłącznie po stronie serwera.
 */
export function isBillingProviderConfigured(): boolean {
  return isBillingEnabled() && Boolean(process.env.STRIPE_SECRET_KEY);
}

/* ---------------------------------------------------------------------------
 * Dane DEMO (fallback bez env)
 * ------------------------------------------------------------------------- */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = Date.now();

const DEMO_SUBSCRIPTION: BillingSubscription = {
  id: 'demo-subscription',
  plan: 'standard',
  status: 'active',
  currentPeriodEnd: new Date(NOW_MS + 24 * DAY_MS).toISOString(),
  trialEndsAt: null,
  cancelAt: null,
  canceledAt: null,
};

const DEMO_INVOICES: BillingInvoice[] = [
  {
    id: 'demo-invoice-2',
    number: 'PB-2026-0002',
    status: 'paid',
    amountCents: 9900,
    taxCents: 2079,
    currency: 'EUR',
    issuedAt: new Date(NOW_MS - 6 * DAY_MS).toISOString(),
    pdfUrl: null,
  },
  {
    id: 'demo-invoice-1',
    number: 'PB-2026-0001',
    status: 'paid',
    amountCents: 9900,
    taxCents: 2079,
    currency: 'EUR',
    issuedAt: new Date(NOW_MS - 36 * DAY_MS).toISOString(),
    pdfUrl: null,
  },
];

/* ---------------------------------------------------------------------------
 * Pomocnicze parsowanie (wiersze JSON z bazy → `unknown`)
 * ------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

function asInt(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/* ---------------------------------------------------------------------------
 * Pomocnicze — aktywna firma i signed URL faktury
 * ------------------------------------------------------------------------- */

/** Id aktywnej firmy zalogowanego (cookie-aware, zwalidowane — FUN-07) albo null. */
async function activeCompanyId(tx: TransactionQuery, userId: string): Promise<string | null> {
  const { getActiveCompanyId } = await import('@/lib/company-context');
  return getActiveCompanyId(tx, userId);
}

/**
 * Best-effort metadane pliku PDF faktury, czytane pod sesją (RLS `files_select_own`); jeśli plik
 * należy do usługi (nie do usera) odczyt zwróci null i po prostu nie pokażemy linku. Sekcja
 * `attempt` — błąd odczytu nie przerywa transakcji ekranu. NIGDY nie rzuca do wywołującego.
 */
async function readInvoicePdfFile(
  tx: TransactionQuery,
  pdfFileId: string,
): Promise<{ bucket: string; path: string } | null> {
  const result = await attempt(tx, () =>
    queryOne(tx, 'billing.invoice-pdf-file', 'SELECT bucket, path FROM public.files WHERE id = $1', [pdfFileId]));
  if (!result.ok || !result.value) return null;
  const bucket = asString(result.value['bucket']);
  const path = asString(result.value['path']);
  return bucket && path ? { bucket, path } : null;
}

/** Krótkotrwały signed URL (TTL 300 s — link do pobrania, nie do udostępniania). NIGDY nie rzuca. */
async function signInvoicePdf(file: { bucket: string; path: string } | null): Promise<string | null> {
  if (!file) return null;
  try {
    return await getSignedFileUrl(file.path, file.bucket, 300);
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Publiczne API
 * ------------------------------------------------------------------------- */

/**
 * Dane ekranu płatności aktywnej firmy zalogowanego użytkownika. Bez env → dane DEMO.
 * Odczyt subskrypcji/faktur wymaga roli owner/admin firmy (RLS) — inaczej zwracamy pusty stan.
 */
export async function getBilling(): Promise<BillingData> {
  if (!isPortalDataConfigured()) {
    return {
      subscription: DEMO_SUBSCRIPTION,
      invoices: DEMO_INVOICES,
      plans: PLANS,
      providerConfigured: false,
    };
  }

  const providerConfigured = isBillingProviderConfigured();

  try {
    const me = await getPortalIdentity();
    if (!me) {
      return { subscription: null, invoices: [], plans: PLANS, providerConfigured };
    }

    const loaded = await withPortalTransaction(me, async (tx) => {
      const companyId = await activeCompanyId(tx, me.id);
      if (!companyId) return null;

      // Subskrypcja (najnowsza, nieusunięta). RLS: subscriptions_select_admin.
      const subRows = await queryRows(tx, 'billing.subscription',
        `SELECT id, plan, status, current_period_end, trial_ends_at, cancel_at, canceled_at, created_at
           FROM public.subscriptions
          WHERE company_id = $1 AND deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1`, [companyId]);

      // Faktury (najnowsze pierwsze). RLS: invoices_select_admin.
      const invoiceRows = await queryRows(tx, 'billing.invoices',
        `SELECT id, number, status, amount_cents, tax_cents, currency, issued_at, pdf_file_id
           FROM public.invoices
          WHERE company_id = $1
          ORDER BY issued_at DESC NULLS LAST
          LIMIT 50`, [companyId]);

      const invoiceFiles: ({ bucket: string; path: string } | null)[] = [];
      for (const row of asRows(invoiceRows)) {
        const pdfFileId = asString(row['pdf_file_id']);
        invoiceFiles.push(pdfFileId ? await readInvoicePdfFile(tx, pdfFileId) : null);
      }
      return { subRows, invoiceRows, invoiceFiles };
    });
    if (!loaded) {
      return { subscription: null, invoices: [], plans: PLANS, providerConfigured };
    }

    const subRow = asRows(loaded.subRows)[0];
    const subscription: BillingSubscription | null = subRow
      ? {
          id: asString(subRow['id']),
          plan: asString(subRow['plan']),
          status: asString(subRow['status'], 'active'),
          currentPeriodEnd: asNullableString(subRow['current_period_end']),
          trialEndsAt: asNullableString(subRow['trial_ends_at']),
          cancelAt: asNullableString(subRow['cancel_at']),
          canceledAt: asNullableString(subRow['canceled_at']),
        }
      : null;

    // Signed URL poza transakcją — połączenie z bazą nie czeka na Storage.
    const invoices: BillingInvoice[] = [];
    const rows = asRows(loaded.invoiceRows);
    for (const [index, row] of rows.entries()) {
      invoices.push({
        id: asString(row['id']),
        number: asNullableString(row['number']),
        status: asString(row['status'], 'draft'),
        amountCents: asInt(row['amount_cents']),
        taxCents: asInt(row['tax_cents']),
        currency: asString(row['currency'], 'EUR'),
        issuedAt: asNullableString(row['issued_at']),
        pdfUrl: await signInvoicePdf(loaded.invoiceFiles[index] ?? null),
      });
    }

    return { subscription, invoices, plans: PLANS, providerConfigured };
  } catch (error) {
    captureError(error, { area: 'billing.getBilling' });
    return { subscription: null, invoices: [], plans: PLANS, providerConfigured };
  }
}
