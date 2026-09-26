import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { savedJobsFixture, toSavedJob, SAVED_JOB_STATE_KEYS, type SavedJob } from '@/lib/saved-job-availability';
import { SavedJobUnavailableItem } from '@/components/candidate/SavedJobUnavailableItem';
import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';

/**
 * 0215 — `/candidate/zapisane`: zapisana oferta bez strony publicznej ma kartę ze stanem, bez
 * linku do 404, z „Usuń z zapisanych”. SQL i klasyfikacja: `rls.sql` sekcja SV215.
 */

const toggleSavedJob = vi.fn();
vi.mock('@/lib/actions/candidate', () => ({ toggleSavedJob: (...args: unknown[]) => toggleSavedJob(...args) }));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}(${Object.values(values).join(',')})` : key,
}));

const closedJob: SavedJob = {
  id: 'cccccccc-cccc-4ccc-8ccc-000000000002',
  slug: null,
  title: 'Magazynier',
  companyName: 'Firma A',
  city: 'Gent',
  availability: 'closed',
};

beforeEach(() => {
  toggleSavedJob.mockReset();
});
afterEach(() => cleanup());

describe('toSavedJob', () => {
  it('maps every RPC state and keeps the link only for a public job', () => {
    const states = ['available', 'closed', 'expired', 'paused', 'unavailable'] as const;
    const mapped = states.map((state) =>
      toSavedJob({ id: 'x', slug: 'praca', title: 'T', company_name: 'F', city: 'C', job_availability: state }));
    expect(mapped.map((j) => [j.availability, j.slug])).toEqual([
      ['available', 'praca'],
      ['closed', null],
      ['expired', null],
      ['paused', null],
      ['unavailable', null],
    ]);
  });

  it('never links an unknown state or a public job without slug', () => {
    expect(toSavedJob({ id: 'x', slug: 'praca', title: 'T', job_availability: 'deleted' })).toMatchObject({ availability: 'unavailable', slug: null });
    expect(toSavedJob({ id: 'x', slug: '', title: 'T', job_availability: 'available' })).toMatchObject({ availability: 'unavailable', slug: null });
    // Baza sprzed 0215: kolumny brak, RPC zwracało wyłącznie oferty publiczne.
    expect(toSavedJob({ id: 'x', slug: 'praca', title: 'T' })).toMatchObject({ availability: 'available', slug: 'praca' });
  });

  it('fixture covers every unavailable state through the same mapping', () => {
    const fixture = savedJobsFixture('pl');
    expect(new Set(fixture.map((j) => j.availability))).toEqual(new Set(['available', 'closed', 'expired', 'paused', 'unavailable']));
    expect(fixture.filter((j) => j.availability !== 'available').every((j) => j.slug === null)).toBe(true);
  });

  it('state labels exist in every language', () => {
    for (const messages of [pl, nl, fr, en]) {
      const dashboard = messages.dashboard as Record<string, string>;
      for (const key of [...Object.values(SAVED_JOB_STATE_KEYS), 'savedRemove', 'savedRemoveLabel', 'savedRemoved', 'savedRemoveError', 'savedRemoving', 'savedUnavailableHint']) {
        expect(dashboard[key], key).toBeTruthy();
      }
    }
  });
});

describe('SavedJobUnavailableItem', () => {
  it('shows state, title and company without any link', () => {
    render(<ul><SavedJobUnavailableItem job={closedJob} locationLabel="Lokalizacja" /></ul>);
    expect(screen.getByText('savedStateClosed')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Magazynier' })).toBeTruthy();
    expect(screen.getByText('Firma A')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'savedRemoveLabel(Magazynier)' })).toBeTruthy();
  });

  it('negative control: a public job is not rendered by this card', () => {
    const { container } = render(<ul><SavedJobUnavailableItem job={{ ...closedJob, availability: 'available', slug: 'x' }} locationLabel="L" /></ul>);
    expect(container.querySelector('li')).toBeNull();
  });

  it('removes the saved job, blocks double click and moves focus to the status', async () => {
    let resolve!: (value: unknown) => void;
    toggleSavedJob.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<ul><SavedJobUnavailableItem job={closedJob} locationLabel="L" /></ul>);
    const button = screen.getByRole('button', { name: 'savedRemoveLabel(Magazynier)' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(toggleSavedJob).toHaveBeenCalledTimes(1);
    expect(toggleSavedJob).toHaveBeenCalledWith(closedJob.id, false);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { resolve({ ok: true, saved: false }); });
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('savedRemoved(Magazynier)');
    expect(document.activeElement).toBe(status);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the card and reports an error when removal fails', async () => {
    toggleSavedJob.mockResolvedValue({ ok: false, error: 'INTERNAL' });
    render(<ul><SavedJobUnavailableItem job={closedJob} locationLabel="L" /></ul>);
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    expect(screen.getByRole('alert').textContent).toBe('savedRemoveError');
    expect(screen.getByRole('heading', { level: 3, name: 'Magazynier' })).toBeTruthy();
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);

    toggleSavedJob.mockRejectedValue(new Error('network'));
    await act(async () => { fireEvent.click(screen.getByRole('button')); });
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
