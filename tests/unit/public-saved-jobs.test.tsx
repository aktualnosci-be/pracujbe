import * as React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PublicSavedJobsProvider,
  PublicSaveJobButton,
} from '@/components/public/PublicSavedJobs';
import { getPublicSavedJobs } from '@/lib/actions/public-saved-jobs';
import { toggleSavedJob } from '@/lib/actions/candidate';
import en from '@/messages/en.json';
vi.mock('@/lib/actions/public-saved-jobs', () => ({
  getPublicSavedJobs: vi.fn(),
}));
vi.mock('@/lib/actions/candidate', () => ({ toggleSavedJob: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    ...props
  }: Omit<React.ComponentProps<'a'>, 'href'> & {
    href: string | { pathname: string; query: Record<string, string> };
  }) => (
    <a
      {...props}
      href={
        typeof href === 'string'
          ? href
          : `${href.pathname}?${new URLSearchParams(href.query).toString()}`
      }
    >
      {children}
    </a>
  ),
}));
const pathname = vi.hoisted(() => ({ current: null as string | null }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  pathname.current = null;
});
const id = '11111111-1111-4111-8111-111111111111';
function show() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <PublicSavedJobsProvider jobIds={[id]}>
        <PublicSaveJobButton jobId={id} />
        <PublicSaveJobButton jobId={id} />
      </PublicSavedJobsProvider>
    </NextIntlClientProvider>,
  );
}
describe('Public saved jobs controls', () => {
  it('loads once and shares the persisted initial value between controls', async () => {
    vi.mocked(getPublicSavedJobs).mockResolvedValue({
      status: 'candidate',
      savedIds: [id],
    });
    show();
    const buttons = await screen.findAllByRole('button', {
      name: en.jobs.saved,
    });
    expect(buttons).toHaveLength(2);
    buttons.forEach((button) =>
      expect(button).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(getPublicSavedJobs).toHaveBeenCalledExactlyOnceWith([id]);
  });
  it('rolls back thrown mutations, prevents duplicate requests and allows retry', async () => {
    vi.mocked(getPublicSavedJobs).mockResolvedValue({
      status: 'candidate',
      savedIds: [],
    });
    let reject!: (reason: Error) => void;
    vi.mocked(toggleSavedJob)
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, rejectPromise) => {
            reject = rejectPromise;
          }),
      )
      .mockResolvedValue({ ok: true, saved: true });
    show();
    const buttons = await screen.findAllByRole('button', {
      name: en.jobs.save,
    });
    fireEvent.click(buttons[0]!);
    fireEvent.click(buttons[1]!);
    expect(toggleSavedJob).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error('transport')));
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    screen
      .getAllByRole('button', { name: en.jobs.save })
      .forEach((button) =>
        expect(button).toHaveAttribute('aria-pressed', 'false'),
      );
    fireEvent.click(screen.getAllByRole('button', { name: en.jobs.save })[0]!);
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: en.jobs.saved })[0],
      ).toBeEnabled(),
    );
  });
  it('retries read failure without pretending unsaved', async () => {
    vi.mocked(getPublicSavedJobs)
      .mockResolvedValueOnce({ status: 'error' })
      .mockResolvedValue({ status: 'candidate', savedIds: [id] });
    show();
    fireEvent.click(
      (await screen.findAllByRole('button', { name: en.jobs.saveRetry }))[0]!,
    );
    expect(
      await screen.findAllByRole('button', { name: en.jobs.saved }),
    ).toHaveLength(2);
    expect(toggleSavedJob).not.toHaveBeenCalled();
  });
  it('anonymous users receive a login link returning to the current offer', async () => {
    pathname.current = '/pl/oferty-pracy/murarz-bruksela-1002';
    vi.mocked(getPublicSavedJobs).mockResolvedValue({ status: 'anonymous' });
    show();
    (await screen.findAllByRole('link', { name: en.jobs.saveLogin })).forEach(
      (link) =>
        expect(link).toHaveAttribute(
          'href',
          '/logowanie?next=%2Fpl%2Foferty-pracy%2Fmurarz-bruksela-1002',
        ),
    );
    expect(toggleSavedJob).not.toHaveBeenCalled();
  });
  it('anonymous login link drops an unsafe or missing return path', async () => {
    pathname.current = '//evil.example/pl';
    vi.mocked(getPublicSavedJobs).mockResolvedValue({ status: 'anonymous' });
    show();
    (await screen.findAllByRole('link', { name: en.jobs.saveLogin })).forEach(
      (link) => expect(link).toHaveAttribute('href', '/logowanie'),
    );
  });
  it('unavailable mode cannot claim a saved result', async () => {
    vi.mocked(getPublicSavedJobs).mockResolvedValue({ status: 'unavailable' });
    show();
    (
      await screen.findAllByRole('button', { name: en.jobs.saveUnavailable })
    ).forEach((button) => {
      expect(button).toBeDisabled();
      expect(button).not.toHaveAttribute('aria-pressed');
    });
  });
});
