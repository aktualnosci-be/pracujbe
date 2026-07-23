import type { Metadata } from 'next';
import {
  ArrowRight,
  Bookmark,
  Briefcase,
  ChevronDown,
  ClipboardList,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Star,
} from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
import { StatusPill } from '@/components/ui/status-pill';
import { RecruitmentFunnel } from '@/components/employer/RecruitmentFunnel';
import { PricingPackageCard } from '@/components/employer/PricingPackageCard';

/**
 * Panel pracodawcy — Podsumowanie (makieta 05).
 *
 * Struktura: nagłówek + „Dodaj ofertę pracy", rząd 4 kafelków statystyk z deltami (StatCard),
 * kolumna główna z tabelą „Twoje aktywne oferty" (checkboxy, StatusPill, menu akcji) oraz
 * lejkiem rekrutacyjnym (RecruitmentFunnel), a kolumna boczna z „Top dopasowanymi kandydatami"
 * i kartą pakietu (PricingPackageCard). NOINDEX (panel). Wszystkie dane są DEMO — backend
 * niepodpięty (TODO(data)).
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return {
    title: t('greetingEmployer'),
    robots: { index: false, follow: false },
  };
}

/** Inicjały (placeholder avatara / logo). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '•';
}

// TODO(data): dane demonstracyjne — zastąpić realnymi z backendu (oferty pracodawcy).
const OFFERS = [
  { id: '12345', title: 'Operator wózka widłowego', city: 'Liège', newApps: 12, matched: 6, selected: false },
  { id: '12344', title: 'Pracownik magazynu', city: 'Antwerpia', newApps: 8, matched: 4, selected: false },
  { id: '12343', title: 'Elektryk przemysłowy', city: 'Charleroi', newApps: 5, matched: 3, selected: true },
  { id: '12342', title: 'Produkcja – operator maszyn', city: 'Genk', newApps: 7, matched: 4, selected: false },
  { id: '12341', title: 'Specjalista ds. logistyki', city: 'Bruksela', newApps: 3, matched: 2, selected: false },
] as const;

// TODO(data): dane demonstracyjne — zastąpić realnymi z matchingu.
const CANDIDATES = [
  { name: 'Piotr Nowak', role: 'Elektryk przemysłowy', city: 'Charleroi', match: 92 },
  { name: 'Katarzyna Zielińska', role: 'Operator wózka widłowego', city: 'Liège', match: 88 },
  { name: 'Michał Wiśniewski', role: 'Pracownik magazynu', city: 'Antwerpia', match: 85 },
] as const;

export default async function EmployerDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const td = await getTranslations({ locale, namespace: 'dashboard' });

  return (
    <div className="space-y-6">
      {/* Nagłówek + CTA */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {td('greetingEmployer')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {td('employerGreetingSub', { name: 'Jan' })}
          </p>
        </div>
        {/* TODO(data): kreator oferty — podpiąć w osobnym etapie. */}
        <Button asChild className="shrink-0 gap-2 self-start sm:self-auto">
          <Link href="/employer/oferty/nowa">
            <Plus className="size-4" aria-hidden="true" />
            {td('addJob')}
          </Link>
        </Button>
      </div>

      {/* Statystyki */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={td('activeOffers')}
          value={8}
          sub={td('sinceLastWeek', { count: 2 })}
          icon={<Briefcase />}
          tone="primary"
        />
        <StatCard
          label={td('newApplications')}
          value={42}
          sub={td('sinceLastWeek', { count: 18 })}
          icon={<ClipboardList />}
          tone="success"
        />
        <StatCard
          label={td('matchedCandidates')}
          value={26}
          sub={td('sinceLastWeek', { count: 7 })}
          icon={<Star />}
          tone="warning"
        />
        <StatCard
          label={td('messagesToAnswer')}
          value={5}
          sub={td('urgent', { count: 2 })}
          icon={<MessageSquare />}
          tone="error"
        />
      </div>

      {/* Główna siatka: lewa (2/3) + prawa (1/3) */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Twoje aktywne oferty */}
          <section className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border p-4 sm:px-5">
              <h2 className="text-base font-semibold text-foreground">{td('yourActiveOffers')}</h2>
              <Link
                href="/employer/oferty"
                className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-accent hover:underline"
              >
                {td('seeAllOffers')}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>

            {/* Desktop: tabela */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th scope="col" className="w-10 py-3 pl-4 pr-0">
                      <input
                        type="checkbox"
                        aria-label={td('selectAll')}
                        className="size-4 rounded border-border accent-accent"
                      />
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium text-muted-foreground">
                      {td('colOffer')}
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium text-muted-foreground">
                      {td('colLocation')}
                    </th>
                    <th scope="col" className="px-3 py-3 text-center font-medium text-muted-foreground">
                      {td('colNew')}
                    </th>
                    <th scope="col" className="px-3 py-3 text-center font-medium text-muted-foreground">
                      {td('colMatched')}
                    </th>
                    <th scope="col" className="px-3 py-3 font-medium text-muted-foreground">
                      {td('colStatusEmp')}
                    </th>
                    <th scope="col" className="w-10 py-3 pr-4">
                      <span className="sr-only">{td('rowActions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {OFFERS.map((offer) => (
                    <tr key={offer.id} className={offer.selected ? 'bg-accent/5' : undefined}>
                      <td className="py-3 pl-4 pr-0 align-middle">
                        <input
                          type="checkbox"
                          defaultChecked={offer.selected}
                          aria-label={td('selectOffer')}
                          className="size-4 rounded border-border accent-accent"
                        />
                      </td>
                      <td className="px-3 py-3 align-middle">
                        <p className="font-medium text-foreground">{offer.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {td('offerId')}: {offer.id}
                        </p>
                      </td>
                      <td className="px-3 py-3 align-middle">
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                          {offer.city}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center align-middle tabular-nums text-foreground">
                        {offer.newApps}
                      </td>
                      <td className="px-3 py-3 text-center align-middle tabular-nums text-foreground">
                        {offer.matched}
                      </td>
                      <td className="px-3 py-3 align-middle">
                        <StatusPill status="active" />
                      </td>
                      <td className="py-3 pr-4 text-right align-middle">
                        {/* TODO(data): menu akcji oferty (Zobacz/Edytuj/Zatrzymaj/Usuń). */}
                        <button
                          type="button"
                          aria-label={td('rowActions')}
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-soft hover:text-foreground"
                        >
                          <MoreHorizontal className="size-4" aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: karty */}
            <ul className="divide-y divide-border md:hidden">
              {OFFERS.map((offer) => (
                <li
                  key={offer.id}
                  className={cn('flex items-start gap-3 p-4', offer.selected && 'bg-accent/5')}
                >
                  <input
                    type="checkbox"
                    defaultChecked={offer.selected}
                    aria-label={td('selectOffer')}
                    className="mt-1 size-4 shrink-0 rounded border-border accent-accent"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{offer.title}</p>
                        <p className="mt-0.5 inline-flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                          {offer.city}
                        </p>
                      </div>
                      {/* TODO(data): menu akcji oferty. */}
                      <button
                        type="button"
                        aria-label={td('rowActions')}
                        className="-mt-1 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-soft hover:text-foreground"
                      >
                        <MoreHorizontal className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {td('offersApplications', { count: offer.newApps })}{' '}
                      <span className="text-border">·</span>{' '}
                      {td('offersMatched', { count: offer.matched })}
                    </p>
                    <div className="mt-2">
                      <StatusPill status="active" />
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {/* Pasek działań zbiorczych */}
            <div className="flex items-center justify-between gap-3 border-t border-border p-4 sm:px-5">
              <p className="text-sm text-muted-foreground">{td('selected', { count: 1 })}</p>
              {/* TODO(data): działania zbiorcze — podpiąć w osobnym etapie. */}
              <Button variant="outline" size="sm" className="gap-1.5">
                {td('bulkActions')}
                <ChevronDown className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </section>

          {/* Lejek rekrutacyjny */}
          <RecruitmentFunnel
            views={4126}
            applications={287}
            interviews={38}
            hired={6}
            conversions={[6.9, 13.2, 15.8]}
          />
        </div>

        {/* Kolumna boczna */}
        <div className="space-y-6">
          {/* Top dopasowani kandydaci */}
          <section className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border p-4 sm:px-5">
              <h2 className="text-base font-semibold text-foreground">{td('topMatched')}</h2>
              <Link
                href="/employer/kandydaci"
                className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-accent hover:underline"
              >
                {td('seeAllCandidates')}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
            <ul className="divide-y divide-border">
              {CANDIDATES.map((candidate) => (
                <li key={candidate.name} className="flex items-center gap-3 p-4 sm:px-5">
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-soft text-sm font-semibold text-muted-foreground ring-1 ring-inset ring-border"
                    aria-hidden="true"
                  >
                    {initials(candidate.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{candidate.name}</p>
                    <p className="truncate text-sm text-muted-foreground">{candidate.role}</p>
                    <p className="truncate text-xs text-muted-foreground">{candidate.city}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-success">
                    {candidate.match}%
                  </span>
                  {/* TODO(data): zapis kandydata — podpiąć akcję serwerową. */}
                  <button
                    type="button"
                    aria-label={td('saveCandidate')}
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-soft hover:text-accent"
                  >
                    <Bookmark className="size-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-border p-3">
              <Button asChild variant="outline" className="w-full">
                <Link href="/employer/kandydaci">{td('goToCandidates')}</Link>
              </Button>
            </div>
          </section>

          {/* Karta pakietu */}
          <PricingPackageCard activeUntil="24.06.2025" offersUsed={8} offersTotal={10} />
        </div>
      </div>
    </div>
  );
}
