import { describe, expect, it } from 'vitest';

import { jobStartDateInstant, jobStartInfo } from '@/lib/job-start';

describe('jobStartInfo (#1112)', () => {
  it('„od zaraz” i poprawna data', () => {
    expect(jobStartInfo({ immediate: true })).toEqual({ immediate: true, date: null });
    expect(jobStartInfo({ startDate: '2026-10-15' })).toEqual({ immediate: false, date: '2026-10-15' });
    // Pełny znacznik czasu z bazy: liczy się dzień.
    expect(jobStartInfo({ startDate: '2026-10-15T00:00:00.000Z' }).date).toBe('2026-10-15');
  });

  it('kontrola ujemna: brak, śmieci i data spoza kalendarza = brak daty', () => {
    expect(jobStartInfo({})).toEqual({ immediate: false, date: null });
    expect(jobStartInfo({ startDate: '' }).date).toBeNull();
    expect(jobStartInfo({ startDate: 'jutro' }).date).toBeNull();
    expect(jobStartInfo({ startDate: '2026-02-31' }).date).toBeNull();
    expect(jobStartInfo({ startDate: '2026-13-01' }).date).toBeNull();
  });

  it('dzień kalendarzowy nie przesuwa się przy formatowaniu w UTC', () => {
    const instant = jobStartDateInstant('2026-10-01');
    expect(instant.toISOString()).toBe('2026-10-01T12:00:00.000Z');
    const utc = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', dateStyle: 'short' }).format(instant);
    expect(utc).toBe('01/10/2026');
    // Kontrola: północ UTC w strefie na zachód od Greenwich dawałaby poprzedni dzień.
    const midnight = new Date('2026-10-01T00:00:00Z');
    const shifted = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', dateStyle: 'short' }).format(midnight);
    expect(shifted).toBe('30/09/2026');
  });
});
