import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { contactMessageFocusKey } from '@/lib/admin/focus';
import {
  CONTACT_MESSAGE_FILTERS,
  normalizeAdminSearch,
  parseContactMessageFilter,
} from '@/lib/admin/list-params';
import { listContactMessages } from '@/lib/data/admin';
import { createAppDateFormatter } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { CONTACT_TOPIC_KEY, isContactTopic } from '@/lib/validation/contact';
import { AdminLoadError } from '@/components/admin/AdminLoadError';
import {
  AdminPageHeader,
  AdminPager,
  AdminSearchForm,
} from '@/components/admin/AdminListControls';
import { ContactMessageActions } from '@/components/admin/ContactMessageActions';

/**
 * Panel administratora — wiadomości z formularza kontaktu (#61).
 *
 * Tu (a nie w e-mailu) admin czyta treść i adres nadawcy: powiadomienie e-mail niesie tylko
 * numer i temat. Filtr nowe/obsłużone/wszystkie (domyślnie nowe), wyszukiwanie po numerze,
 * adresie i imieniu, stronicowanie kursorem, daty w Europe/Brussels. Odpowiedź — ze skrzynki
 * administratora na adres nadawcy (link `mailto:`). Odczyt service-rolem po potwierdzeniu roli
 * admina. NOINDEX + `force-dynamic` (z layoutu).
 */

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/kontakt';

const FILTER_LABEL: Record<string, string> = {
  new: 'contactFilterNew',
  handled: 'contactFilterHandled',
  all: 'filterAll',
};

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('contactTitle'), robots: { index: false, follow: false } };
}

export default async function AdminContactMessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [t, tContact] = await Promise.all([
    getTranslations({ locale, namespace: 'admin' }),
    getTranslations({ locale, namespace: 'contact' }),
  ]);
  const sp = await searchParams;
  const filter = parseContactMessageFilter(firstValue(sp['status']));
  const q = normalizeAdminSearch(firstValue(sp['q']));
  const cursor = firstValue(sp['cursor']) ?? null;
  const statusQuery = filter === 'new' ? null : filter;

  const result = await listContactMessages({ status: filter, q, cursor });
  const rows = result.status === 'ok' ? result.rows : [];
  const formatDate = createAppDateFormatter(locale, { withTime: true });
  const listQuery = { status: statusQuery, q };
  const retryParams = new URLSearchParams(
    Object.entries({ ...listQuery, cursor }).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();

  const topicLabel = (topic: string): string =>
    isContactTopic(topic) ? tContact(CONTACT_TOPIC_KEY[topic]) : t('statusUnknown');

  return (
    <div className="space-y-6">
      <AdminPageHeader title={t('contactTitle')} subtitle={t('contactSubtitle')} />

      <nav aria-label={t('contactFilterLabel')} className="flex flex-wrap gap-2">
        {CONTACT_MESSAGE_FILTERS.map((value) => {
          const isActive = value === filter;
          const query: Record<string, string> = {};
          if (value !== 'new') query['status'] = value;
          if (q) query['q'] = q;
          return (
            <Link
              key={value}
              href={{ pathname: BASE_PATH, query }}
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-soft hover:text-foreground',
              )}
            >
              {t(FILTER_LABEL[value] ?? 'filterAll')}
            </Link>
          );
        })}
      </nav>

      <AdminSearchForm
        action={`/${locale}${BASE_PATH}`}
        q={q}
        label={t('contactSearchLabel')}
        hint={t('contactSearchHint')}
        keep={{ status: statusQuery }}
        clearHref={{ pathname: BASE_PATH, query: statusQuery ? { status: statusQuery } : {} }}
      />

      {result.status === 'error' ? (
        <AdminLoadError retryHref={`/${locale}${BASE_PATH}${retryParams ? `?${retryParams}` : ''}`} />
      ) : (
        <section className="rounded-lg border border-border bg-card">
          {rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t('contactEmpty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((row) => {
                const handled = row.status === 'handled';
                return (
                  <li key={row.id} className="p-4 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                              handled ? 'bg-soft text-muted-foreground' : 'bg-warning/10 text-warning-text',
                            )}
                          >
                            {handled ? t('contactStatusHandled') : t('contactStatusNew')}
                          </span>
                          <span className="text-xs font-medium text-muted-foreground">{topicLabel(row.topic)}</span>
                          <span className="text-xs text-muted-foreground">
                            {t('contactFormLocale', { locale: row.locale.toUpperCase() })}
                          </span>
                        </div>
                        <h2
                          tabIndex={-1}
                          data-admin-focus={contactMessageFocusKey(row.id)}
                          className="break-all font-mono text-sm font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {row.reference}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          {t('contactReceivedAt')}{' '}
                          <time dateTime={row.createdAt ?? undefined}>{formatDate(row.createdAt)}</time>
                        </p>
                        <p className="break-words text-sm text-foreground">
                          {row.senderName ? `${row.senderName} · ` : ''}
                          <a
                            href={`mailto:${row.senderEmail}?subject=${encodeURIComponent(row.reference)}`}
                            className="break-all font-medium underline underline-offset-2 hover:no-underline"
                          >
                            {row.senderEmail}
                          </a>
                        </p>
                        <p className="whitespace-pre-wrap break-words rounded-md bg-soft p-3 text-sm text-foreground">
                          {row.message}
                        </p>
                        {handled ? (
                          <p className="text-xs text-muted-foreground">
                            {t('contactHandledBy', { name: row.handledByName ?? t('adminName') })}{' '}
                            <time dateTime={row.handledAt ?? undefined}>{formatDate(row.handledAt)}</time>
                          </p>
                        ) : null}
                      </div>
                      <ContactMessageActions id={row.id} status={row.status} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      {result.status === 'ok' ? (
        <AdminPager
          pathname={BASE_PATH}
          query={listQuery}
          nextCursor={result.nextCursor}
          hasCursor={Boolean(cursor)}
          count={rows.length}
          q={q}
        />
      ) : null}
    </div>
  );
}
