import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getRecentApplications } from '@/lib/data/employer';
import { StatusPill } from '@/components/ui/status-pill';
import { ApplicationStatusMenu } from '@/components/employer/ApplicationStatusMenu';

/**
 * Panel pracodawcy — Aplikacje (makieta 05, sekcja „Najnowsze aplikacje"), na REALNYCH danych.
 *
 * Lista aplikacji na oferty firmy (`getRecentApplications` pod sesją/RLS). Każdy wiersz: inicjały,
 * kandydat, tytuł oferty, pigułka statusu (StatusPill) i menu zmiany statusu (ApplicationStatusMenu
 * → `transitionApplication`, RPC z allow-listą przejść — Invariant #8). Bez env — dane DEMO.
 * NOINDEX dziedziczone z layoutu panelu.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return {
    title: t('navApplications'),
    robots: { index: false, follow: false },
  };
}

export const dynamic = 'force-dynamic';

/** Inicjały (placeholder avatara). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '•';
}

export default async function EmployerApplicationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const td = await getTranslations({ locale, namespace: 'dashboard' });

  const applications = await getRecentApplications();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {td('navApplications')}
        </h1>
      </div>

      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border p-4 sm:px-5">
          <h2 className="text-base font-semibold text-foreground">{td('recentApplications')}</h2>
        </div>

        {applications.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{td('emptyState')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {applications.map((application) => (
              <li
                key={application.id}
                className="flex flex-wrap items-center gap-3 p-4 sm:px-5"
              >
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-soft text-sm font-semibold text-muted-foreground ring-1 ring-inset ring-border"
                  aria-hidden="true"
                >
                  {initials(application.candidateName || td('candidateFallback'))}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {application.candidateName || td('candidateFallback')}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">{application.jobTitle}</p>
                </div>
                <StatusPill status={application.status} />
                <ApplicationStatusMenu
                  applicationId={application.id}
                  status={application.status}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
