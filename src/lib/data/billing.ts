/**
 * Warstwa danych płatności/subskrypcji pracodawcy — Pracuj.be (Etap 7h, scaffold).
 *
 * Strategia spójna z `@/lib/data/company`/`@/lib/data/employer`: przy skonfigurowanym Supabase
 * dane czytane są pod SESJĄ zalogowanego użytkownika (RLS, NIGDY service-role) przez
 * `createServerClient`. Bez konfiguracji (build/preview bez env) zwracamy dane DEMO, dzięki czemu
 * ekran `/employer/platnosci` renderuje pełny widok (pakiety, subskrypcja, faktury) bez backendu.
 *
 * PROVIDER-GATED: realne rozliczenia wymagają zewnętrznego dostawcy (np. Stripe). Bez klucza
 * (`STRIPE_SECRET_KEY`) działamy w trybie podglądu — `providerConfigured=false`, akcje zwracają
 * `{ ok: true, demo: true }` (patrz `@/lib/actions/billing`). Ten moduł NIE integruje dostawcy.
 *
 * „Aktywna firma" = pierwsze aktywne członkostwo (`company_members.is_active = true`) — jak w
 * panelu pracodawcy. Odczyt subskrypcji/faktur wymaga roli owner/admin firmy (RLS
 * `subscriptions_select_admin` / `invoices_select_admin` → `is_company_admin`). Członek bez tej
 * roli zobaczy pusty stan.
 *
 * `discount_codes` NIE jest czytane tutaj (RLS: deny) — walidację kodu robi server action
 * service-rolem. Klient Supabase importowany LENIWIE (moduł nie ciągnie `next/headers` do bundla
 * trybu DEMO).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { isSupabaseConfigured } from '@/lib/env';
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
  return Boolean(process.env.STRIPE_SECRET_KEY);
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
 * Pomocnicze parsowanie (klient Supabase jest nietypowany → dane `unknown`)
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

/** Pierwsze aktywne członkostwo zalogowanego = id aktywnej firmy (albo null). */
async function activeCompanyId(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('company_members')
    .select('company_id')
    .eq('profile_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw error;
  const id = asString(asRows(data)[0]?.['company_id']);
  return id || null;
}

/**
 * Best-effort signed URL do PDF faktury. Metadane pliku czytane pod sesją (RLS `files_select_own`);
 * jeśli plik należy do usługi (nie do usera) odczyt zwróci null i po prostu nie pokażemy linku.
 * NIGDY nie rzuca do wywołującego.
 */
async function resolveInvoicePdfUrl(
  supabase: SupabaseClient,
  pdfFileId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('files')
      .select('bucket, path')
      .eq('id', pdfFileId)
      .maybeSingle();
    if (error || !data) return null;
    const bucket = asString(asRecord(data)['bucket']);
    const path = asString(asRecord(data)['path']);
    if (!bucket || !path) return null;
    // TTL 300 s — link do pobrania, nie do udostępniania.
    return await getSignedFileUrl(path, bucket, 300);
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
  if (!isSupabaseConfigured()) {
    return {
      subscription: DEMO_SUBSCRIPTION,
      invoices: DEMO_INVOICES,
      plans: PLANS,
      providerConfigured: false,
    };
  }

  const providerConfigured = isBillingProviderConfigured();

  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { subscription: null, invoices: [], plans: PLANS, providerConfigured };
    }

    const companyId = await activeCompanyId(supabase, user.id);
    if (!companyId) {
      return { subscription: null, invoices: [], plans: PLANS, providerConfigured };
    }

    // Subskrypcja (najnowsza, nieusunięta). RLS: subscriptions_select_admin.
    const { data: subData, error: subErr } = await supabase
      .from('subscriptions')
      .select(
        'id, plan, status, current_period_end, trial_ends_at, cancel_at, canceled_at, created_at',
      )
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1);
    if (subErr) throw subErr;

    const subRow = asRows(subData)[0];
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

    // Faktury (najnowsze pierwsze). RLS: invoices_select_admin.
    const { data: invData, error: invErr } = await supabase
      .from('invoices')
      .select('id, number, status, amount_cents, tax_cents, currency, issued_at, pdf_file_id')
      .eq('company_id', companyId)
      .order('issued_at', { ascending: false, nullsFirst: false })
      .limit(50);
    if (invErr) throw invErr;

    const invoices: BillingInvoice[] = [];
    for (const row of asRows(invData)) {
      const pdfFileId = asString(row['pdf_file_id']);
      const pdfUrl = pdfFileId ? await resolveInvoicePdfUrl(supabase, pdfFileId) : null;
      invoices.push({
        id: asString(row['id']),
        number: asNullableString(row['number']),
        status: asString(row['status'], 'draft'),
        amountCents: asInt(row['amount_cents']),
        taxCents: asInt(row['tax_cents']),
        currency: asString(row['currency'], 'EUR'),
        issuedAt: asNullableString(row['issued_at']),
        pdfUrl,
      });
    }

    return { subscription, invoices, plans: PLANS, providerConfigured };
  } catch (error) {
    captureError(error, { area: 'billing.getBilling' });
    return { subscription: null, invoices: [], plans: PLANS, providerConfigured };
  }
}
