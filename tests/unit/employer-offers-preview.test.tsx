import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { EmployerOffersPreview } from '@/components/employer/EmployerOffersPreview';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: React.ComponentProps<'a'>) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/components/ui/status-pill', () => ({
  StatusPill: ({ status }: { status: string }) => <span>{status}</span>,
}));

for (const locale of ['pl', 'nl', 'fr', 'en'] as const) {
  const messages = JSON.parse(readFileSync(resolve('src/messages', `${locale}.json`), 'utf8')) as {
    dashboard: Record<string, string>;
  };
  const t = messages.dashboard;
  const labels = {
    title: t['yourActiveOffers']!,
    seeAll: t['seeAllOffers']!,
    empty: t['emptyState']!,
    loadError: t['employerOffersLoadError']!,
    loadErrorHint: t['employerOffersLoadErrorHint']!,
    retry: t['employerOffersRetry']!,
    newApplications: t['employerOffersApplicationsLabel']!,
    matched: t['colMatched']!,
    noData: t['funnelNoData']!,
  };

  describe(`employer dashboard offers preview (${locale})`, () => {
    it('shows a localized retry on read failure, never a false empty state', () => {
      const html = renderToStaticMarkup(
        <EmployerOffersPreview result={{ status: 'error' }} locale={locale} labels={labels} />,
      );
      const text = new DOMParser().parseFromString(html, 'text/html').body.textContent;
      expect(html).toContain('role="alert"');
      expect(text).toContain(labels.loadError);
      expect(text).toContain(labels.loadErrorHint);
      expect(html).toContain(`href="/${locale}/employer"`);
      expect(text).toContain(labels.retry);
      expect(text).not.toContain(labels.empty);
    });

    it('shows the empty state only after a successful empty read', () => {
      const html = renderToStaticMarkup(
        <EmployerOffersPreview result={{ status: 'ok', jobs: [], prevCursor: null, nextCursor: null }} locale={locale} labels={labels} />,
      );
      expect(html).toContain(labels.empty);
      expect(html).not.toContain('role="alert"');
      expect(html).not.toContain(labels.retry);
    });

    it('keeps actual offer data and the full-list link after a successful read', () => {
      const html = renderToStaticMarkup(
        <EmployerOffersPreview
          result={{
            status: 'ok',
            prevCursor: null, nextCursor: null,
            jobs: [{ id: 'job-1', title: 'Operator wózka', city: 'Liège', status: 'active', slug: 'operator-wozka', pastExpiry: false, newApplications: 2, matched: 3, createdAt: null }],
          }}
          locale={locale}
          labels={labels}
        />,
      );
      expect(html).toContain('Operator wózka');
      expect(html).toContain('Liège');
      expect(html).toContain('href="/employer/oferty"');
      expect(html).not.toContain('role="alert"');
      expect(html).not.toContain(labels.empty);
    });

    it('P1-14: counters unavailable for the role show "no data", never a false zero', () => {
      const render = (newApplications: number | null, matched: number | null) => renderToStaticMarkup(
        <EmployerOffersPreview
          result={{
            status: 'ok',
            prevCursor: null, nextCursor: null,
            jobs: [{ id: 'job-1', title: 'Operator wózka', city: 'Liège', status: 'active', slug: 'operator-wozka', pastExpiry: false, newApplications, matched, createdAt: null }],
          }}
          locale={locale}
          labels={labels}
        />,
      );
      const values = (html: string) => [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('dd')]
        .map((dd) => dd.textContent);
      expect(values(render(null, null))).toEqual([`—${labels.noData}`, `—${labels.noData}`]);
      // Kontrola ujemna: realne zero z bazy to 0, nie „brak danych”.
      expect(values(render(0, 0))).toEqual(['0', '0']);
    });
  });
}
