// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyCvProposals, prepareCvImportAction, proposeFromCvAction } from '@/lib/actions/cv-import';
import { isCvImportEnabled } from '@/lib/cv-import/config';
import { isProductionMode, isSupabaseConfigured } from '@/lib/env';
import { checkRateLimit } from '@/lib/rate-limit';
import { buildDocx, CV_WITH_REFEREES, DOCX_TYPE, REFEREES } from '../helpers/cv-fixtures';

/**
 * #487 — akcje importu CV: flaga (domyślnie wyłączona), konto kandydata, limit wywołań
 * modelu, a zapis WYŁĄCZNIE zatwierdzonych pozycji przez RPC 0102. Brak zatwierdzenia =
 * brak wywołania bazy. Klient AI i baza to atrapy — zero prawdziwych wywołań.
 */

const extract = vi.fn();
const rpc = vi.fn();
const getUser = vi.fn();
const single = vi.fn();
const from = vi.fn(() => ({ select: () => ({ eq: () => ({ single }) }) }));

vi.mock('@/lib/env', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  isProductionMode: vi.fn(() => true),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => ({ rpc, from, auth: { getUser } })),
}));
vi.mock('@/lib/cv-import/extract', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/cv-import/extract')>();
  return {
    ...real,
    AnthropicCvExtractor: class {
      extract = extract;
    },
  };
});

const APPROVED = {
  occupations: ['Magazynier'],
  skills: ['Obsługa wózka widłowego'],
  languages: [{ language: 'Niderlandzki', level: 'intermediate' }],
  certificates: ['VCA'],
  experienceYears: 5,
};

function docxForm(): FormData {
  const fd = new FormData();
  fd.set('file', new File([new Uint8Array(buildDocx(CV_WITH_REFEREES))], 'cv.docx', { type: DOCX_TYPE }));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_CV_IMPORT_ENABLED = '1';
  process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  delete process.env.AI_CV_IMPORT_PROVIDER;
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  vi.mocked(isProductionMode).mockReturnValue(true);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  getUser.mockResolvedValue({ data: { user: { id: 'cand-1' } } });
  single.mockResolvedValue({ data: { role: 'candidate' }, error: null });
  rpc.mockResolvedValue({ data: { occupations: 1, skills: 1, languages: 1, certificates: 1, experienceYears: true }, error: null });
  extract.mockResolvedValue({
    isCv: true,
    suspiciousInstructions: false,
    occupations: [{ value: 'Magazynier', evidence: 'Magazynier', uncertain: false }],
    skills: [],
    languages: [],
    certificates: [],
    experienceYears: { value: '', evidence: '', uncertain: false },
  });
});

describe('flaga i dostawca', () => {
  it('bez flagi (domyślnie) albo bez klucza funkcja jest niewidoczna, a akcje nieaktywne', async () => {
    delete process.env.AI_CV_IMPORT_ENABLED;
    expect(isCvImportEnabled()).toBe(false);
    expect(await prepareCvImportAction(docxForm())).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await proposeFromCvAction('x')).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await applyCvProposals(APPROVED)).toEqual({ ok: false, error: 'NOT_FOUND' });

    process.env.AI_CV_IMPORT_ENABLED = '1';
    delete process.env.ANTHROPIC_API_KEY;
    expect(isCvImportEnabled()).toBe(false);
    // Flaga importu ogłoszeń nie włącza importu CV.
    process.env.AI_JOB_IMPORT_ENABLED = '1';
    expect(isCvImportEnabled()).toBe(false);
    delete process.env.AI_JOB_IMPORT_ENABLED;
    expect(extract).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('atrapa dostawcy nie działa w trybie produkcyjnym', () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.AI_CV_IMPORT_PROVIDER = 'fixture';
    expect(isCvImportEnabled()).toBe(false);
    vi.mocked(isProductionMode).mockReturnValue(false);
    expect(isCvImportEnabled()).toBe(true);
  });
});

describe('autoryzacja i limity', () => {
  it('bez sesji albo konto pracodawcy → odmowa, bez wywołania modelu', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } });
    expect(await proposeFromCvAction(CV_WITH_REFEREES)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    single.mockResolvedValueOnce({ data: { role: 'employer' }, error: null });
    expect(await proposeFromCvAction(CV_WITH_REFEREES)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(extract).not.toHaveBeenCalled();
  });

  it('limit per konto (bez IP) przed wywołaniem modelu', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    expect(await proposeFromCvAction(CV_WITH_REFEREES)).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(extract).not.toHaveBeenCalled();
    await proposeFromCvAction(CV_WITH_REFEREES);
    expect(checkRateLimit).toHaveBeenCalledWith('cv-import', expect.objectContaining({ identifier: 'cand-1', perIp: false }));
    expect(checkRateLimit).toHaveBeenCalledWith('cv-import-day', expect.objectContaining({ identifier: 'cand-1', perIp: false }));
  });
});

describe('podgląd i propozycje', () => {
  it('podgląd nie woła modelu ani bazy i nie zawiera danych referentów', async () => {
    const res = await prepareCvImportAction(docxForm());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (const v of Object.values(REFEREES)) expect(res.text).not.toContain(v);
    expect(extract).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('propozycje nie zapisują niczego w profilu', async () => {
    const res = await proposeFromCvAction(CV_WITH_REFEREES);
    expect(res).toMatchObject({ ok: true });
    expect(rpc).not.toHaveBeenCalled();
    for (const v of Object.values(REFEREES)) expect(String(extract.mock.calls[0]?.[0])).not.toContain(v);
  });
});

describe('zapis zatwierdzonych pozycji', () => {
  it('brak zatwierdzenia = brak zapisu (żadnego wywołania bazy)', async () => {
    const none = { occupations: [], skills: [], languages: [], certificates: [], experienceYears: null };
    expect(await applyCvProposals(none)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(await applyCvProposals({})).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('do bazy trafiają dokładnie zatwierdzone pozycje, jednym RPC', async () => {
    const res = await applyCvProposals({ ...APPROVED, occupations: [], experienceYears: null });
    expect(res).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('apply_candidate_cv_proposals', {
      p_occupations: [],
      p_skills: ['Obsługa wózka widłowego'],
      p_languages: [{ language: 'Niderlandzki', level: 'intermediate' }],
      p_certificates: ['VCA'],
      p_experience_years: null,
    });
  });

  it('pozycja z kontaktem, osobą trzecią, identyfikatorem albo spoza schematu → odrzucenie całości', async () => {
    for (const bad of [
      { skills: [REFEREES.email1] },
      { skills: [`Referencje: ${REFEREES.name1}`] },
      { certificates: ['NISS 85.07.30-033.28'] },
      { skills: ['x'.repeat(121)] },
      { languages: [{ language: 'Nederlands', level: 'expert' }] },
      { skills: ['ok'], referees: [REFEREES.name2] },
    ]) {
      expect(await applyCvProposals(bad), JSON.stringify(bad)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('błąd bazy → kod użytkowy bez szczegółów', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'VALIDATION_FAILED: skills too many' } });
    expect(await applyCvProposals(APPROVED)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'PERMISSION_DENIED: profil kandydata' } });
    expect(await applyCvProposals(APPROVED)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
  });

  it('tryb demo: walidacja bez zapisu', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    expect(await applyCvProposals(APPROVED)).toMatchObject({ ok: true, demo: true });
    expect(rpc).not.toHaveBeenCalled();
  });
});
