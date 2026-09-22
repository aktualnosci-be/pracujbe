import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCandidatePassport } from '@/lib/data/candidate';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
});

describe('paszport zawodowy kandydata', () => {
  it('czyta wyłącznie profil właściciela i zachowuje zero lat doświadczenia', async () => {
    const profileQuery = {
      select: vi.fn(() => profileQuery),
      eq: vi.fn(() => profileQuery),
      is: vi.fn(() => profileQuery),
      maybeSingle: vi.fn(async () => ({
        data: { id: 'candidate-profile-1', occupations: ['Magazynier'], city: 'Gent', radius_km: 25, experience_years: 0, availability: 'immediate' },
        error: null,
      })),
    };
    const relation = (key: string, label: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(async (column: string, id: string) => {
          expect(column).toBe('candidate_profile_id');
          expect(id).toBe('candidate-profile-1');
          return { data: [{ [key]: label }], error: null };
        }),
      })),
    });
    const supabase = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'owner-1' } } })) },
      from: vi.fn((table: string) => ({
        candidate_profiles: profileQuery,
        candidate_skills: relation('skill_label', 'VCA'),
        candidate_languages: relation('language_label', 'Nederlands'),
        candidate_certificates: relation('certificate_label', 'ADR'),
      })[table as 'candidate_profiles' | 'candidate_skills' | 'candidate_languages' | 'candidate_certificates']),
    };
    vi.mocked(createServerClient).mockResolvedValue(supabase as never);

    await expect(getCandidatePassport()).resolves.toMatchObject({
      occupations: ['Magazynier'], city: 'Gent', radiusKm: 25, experienceYears: 0,
      skills: ['VCA'], languages: ['Nederlands'], certificates: ['ADR'],
    });
    expect(profileQuery.eq).toHaveBeenCalledWith('profile_id', 'owner-1');
    expect(profileQuery.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('bez sesji nie pobiera ani nie pokazuje danych zawodowych', async () => {
    const supabase = {
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
      from: vi.fn(),
    };
    vi.mocked(createServerClient).mockResolvedValue(supabase as never);

    await expect(getCandidatePassport()).resolves.toMatchObject({ occupations: [], skills: [] });
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
