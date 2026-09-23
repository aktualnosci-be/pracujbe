import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import pl from '@/messages/pl.json';
import { RecruitmentFunnel, conversionPct } from '@/components/employer/RecruitmentFunnel';

type Dashboard = typeof pl.dashboard;

vi.mock('next-intl', () => ({
  useTranslations:
    () =>
    (key: keyof Dashboard, values?: Record<string, unknown>) =>
      String(pl.dashboard[key]).replace('{value}', String(values?.value ?? '')),
  useFormatter: () => ({ number: (value: number) => String(value) }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

afterEach(cleanup);

describe('RecruitmentFunnel (#302)', () => {
  it('shows „brak danych” for unknown views instead of a fake 0 and 0% conversion', () => {
    render(<RecruitmentFunnel views={null} applications={10} interviews={4} hired={1} />);
    expect(screen.getByText(pl.dashboard.funnelNoData)).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText('0% konwersji')).not.toBeInTheDocument();
    // Pozostałe konwersje liczone z realnych etapów.
    expect(screen.getByText('40% konwersji')).toBeInTheDocument();
    expect(screen.getByText('25% konwersji')).toBeInTheDocument();
  });

  it('keeps real counts and conversions when views are known', () => {
    render(<RecruitmentFunnel views={200} applications={10} interviews={4} hired={1} />);
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('5% konwersji')).toBeInTheDocument();
    expect(screen.queryByText(pl.dashboard.funnelNoData)).not.toBeInTheDocument();
  });

  it('computes conversions only from known, non-zero denominators', () => {
    expect(conversionPct(3, null)).toBeNull();
    expect(conversionPct(0, 0)).toBeNull();
    expect(conversionPct(1, 3)).toBe(33.3);
  });
});
