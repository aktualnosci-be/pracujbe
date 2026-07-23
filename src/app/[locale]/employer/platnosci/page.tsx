import type { Metadata } from 'next';
import { Check, Download, FileText, Info } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getBilling } from '@/lib/data/billing';
import { Badge } from '@/components/ui/badge';
import { CheckoutButton } from '@/components/employer/billing/CheckoutButton';
import { DiscountForm } from '@/components/employer/billing/DiscountForm';
import { CancelSubscriptionButton } from '@/components/employer/billing/CancelSubscriptionButton';

/**
 * Panel pracodawcy — Płatności i subskrypcja (Etap 7h, scaffold PROVIDER-GATED).
 *
 * Pokazuje: baner „płatności w przygotowaniu" (gdy brak dostawcy), pakiety (wybór → `startCheckout`),
 * bieżącą subskrypcję + status (+ anulowanie → `cancelSubscription`), listę faktur (numer/kwota/
 * status/data + link do PDF gdy dostępny) oraz pole kodu rabatowego (`applyDiscount`). Dane z
 * `@/lib/data/billing` pod sesją użytkownika (RLS); bez env — dane DEMO.
 *
 * NOINDEX (panel) + `force-dynamic` (dane zależne od sesji/RLS). Guard członkostwa dziedziczony
 * z `employer/layout.tsx`.
 */

export const dynamic = 'force-dynamic';

/** Surowy `subscription_status` → klucz i18n (fallback: surowy status). */
const SUB_STATUS_KEY: Record<string, string> = {
  trialing: 'subStatus_trialing',
  active: 'subStatus_active',
  past_due: 'subStatus_past_due',
  canceled: 'subStatus_canceled',
  incomplete: 'subStatus_incomplete',
  expired: 'subStatus_expired',
};

/** Surowy `invoice_status` → klucz i18n (fallback: surowy status). */
const INV_STATUS_KEY: Record<string, string> = {
  draft: 'invStatus_draft',
  open: 'invStatus_open',
  paid: 'invStatus_paid',
  void: 'invStatus_void',
  uncollectible: 'invStatus_uncollectible',
};

/** Identyfikator pakietu → klucz nazwy i18n (fallback: surowa nazwa planu z DB). */
const PLAN_NAME_KEY: Record<string, string> = {
  starter: 'plan_starter_name',
  standard: 'plan_standard_name',
  pro: 'plan_pro_name',
};

/** Statusy „pozytywne" → zielony badge; reszta → neutralny. */
const POSITIVE_STATUSES = new Set(['active', 'trialing', 'paid']);

function badgeVariant(status: string): 'success' | 'outline' {
  return POSITIVE_STATUSES.has(status) ? 'success' : 'outline';
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'billing' });
  return {
    title: t('title'),
    robots: { index: false, follow: false },
  };
}

export default async function EmployerBillingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'billing' });
  const billing = await getBilling();

  const moneyFmt = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' });
  const formatMoney = (cents: number, currency: string): string =>
    (currency === 'EUR'
      ? moneyFmt
      : new Intl.NumberFormat(locale, { style: 'currency', currency })
    ).format(cents / 100);

  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const formatDate = (iso: string | null): string => (iso ? dateFmt.format(new Date(iso)) : '—');

  const { subscription, invoices, plans, providerConfigured } = billing;
  const currentPlanId = subscription?.plan ?? null;

  const subStatusLabel =
    subscription && SUB_STATUS_KEY[subscription.status]
      ? t(SUB_STATUS_KEY[subscription.status]!)
      : subscription?.status ?? '';

  // Anulowanie pokazujemy tylko dla aktywnej/próbnej subskrypcji, która nie jest już anulowana.
  const canCancel =
    subscription != null &&
    subscription.canceledAt == null &&
    subscription.cancelAt == null &&
    (subscription.status === 'active' || subscription.status === 'trialing');

  return (
    <div className="max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {/* Baner: płatności w przygotowaniu (brak dostawcy). */}
      {!providerConfigured ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-accent/30 bg-accent/5 p-4 text-sm"
        >
          <Info className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
          <div>
            <p className="font-semibold text-foreground">{t('providerBannerTitle')}</p>
            <p className="mt-0.5 text-muted-foreground">{t('providerBanner')}</p>
          </div>
        </div>
      ) : null}

      {/* Pakiety */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">{t('plansTitle')}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => {
            const isCurrent = currentPlanId === plan.id;
            const nameLabel = PLAN_NAME_KEY[plan.id] ? t(PLAN_NAME_KEY[plan.id]!) : plan.id;
            return (
              <div
                key={plan.id}
                className={`relative flex flex-col rounded-lg border bg-card p-5 ${
                  plan.recommended ? 'border-accent ring-1 ring-accent' : 'border-border'
                }`}
              >
                {plan.recommended ? (
                  <Badge className="absolute -top-2.5 left-5 bg-accent text-white">
                    {t('recommended')}
                  </Badge>
                ) : null}

                <h3 className="text-lg font-bold text-foreground">{nameLabel}</h3>
                <p className="mt-1">
                  <span className="text-2xl font-bold text-foreground tabular-nums">
                    {formatMoney(plan.priceCents, plan.currency)}
                  </span>
                  <span className="text-sm text-muted-foreground">{t('perMonth')}</span>
                </p>

                <ul className="mt-4 flex-1 space-y-2.5">
                  {plan.features.map((featureKey) => (
                    <li
                      key={featureKey}
                      className="flex items-start gap-2.5 text-sm text-foreground"
                    >
                      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                      <span>{t(featureKey)}</span>
                    </li>
                  ))}
                </ul>

                <CheckoutButton
                  plan={plan.id}
                  recommended={plan.recommended}
                  isCurrent={isCurrent}
                  className="mt-5 w-full"
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* Bieżąca subskrypcja */}
      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">{t('currentTitle')}</h2>

        {subscription ? (
          <>
            <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('planLabel')}
                </dt>
                <dd className="mt-0.5 text-sm font-medium text-foreground">
                  {PLAN_NAME_KEY[subscription.plan]
                    ? t(PLAN_NAME_KEY[subscription.plan]!)
                    : subscription.plan}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('statusLabel')}
                </dt>
                <dd className="mt-1">
                  <Badge variant={badgeVariant(subscription.status)}>{subStatusLabel}</Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('periodEnd')}
                </dt>
                <dd className="mt-0.5 text-sm text-foreground">
                  {formatDate(subscription.currentPeriodEnd)}
                </dd>
              </div>
            </dl>

            {subscription.status === 'trialing' && subscription.trialEndsAt ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {t('trialEnds', { date: formatDate(subscription.trialEndsAt) })}
              </p>
            ) : null}

            {subscription.cancelAt ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {t('willCancel', { date: formatDate(subscription.cancelAt) })}
              </p>
            ) : null}

            {canCancel ? (
              <div className="mt-4">
                <CancelSubscriptionButton />
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">{t('noSubscription')}</p>
        )}
      </section>

      {/* Faktury */}
      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border p-4 sm:px-5">
          <h2 className="text-base font-semibold text-foreground">{t('invoicesTitle')}</h2>
        </div>

        {invoices.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{t('noInvoices')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th scope="col" className="px-4 py-3 font-medium text-muted-foreground sm:px-5">
                    {t('invNumber')}
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium text-muted-foreground">
                    {t('invDate')}
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium text-muted-foreground">
                    {t('invAmount')}
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium text-muted-foreground">
                    {t('invStatus')}
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium text-muted-foreground">
                    {t('invPdf')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="whitespace-nowrap px-4 py-3 align-middle font-medium text-foreground sm:px-5">
                      {invoice.number ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 align-middle text-muted-foreground">
                      {formatDate(invoice.issuedAt)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right align-middle tabular-nums text-foreground">
                      {formatMoney(invoice.amountCents + invoice.taxCents, invoice.currency)}
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <Badge variant={badgeVariant(invoice.status)}>
                        {INV_STATUS_KEY[invoice.status]
                          ? t(INV_STATUS_KEY[invoice.status]!)
                          : invoice.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-right align-middle">
                      {invoice.pdfUrl ? (
                        <a
                          href={invoice.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
                        >
                          <Download className="size-3.5" aria-hidden="true" />
                          {t('invDownload')}
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                          <FileText className="size-3.5" aria-hidden="true" />
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Kod rabatowy */}
      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">{t('discountTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('discountSubtitle')}</p>
        <div className="mt-4">
          <DiscountForm />
        </div>
      </section>
    </div>
  );
}
