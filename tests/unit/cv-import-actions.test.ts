// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyCvProposals, prepareCvImportAction, proposeFromCvAction } from '@/lib/actions/cv-import';
import { isCvImportEnabled } from '@/lib/cv-import/config';
import type { PortalIdentity } from '@/lib/auth/session';
import { isProductionMode } from '@/lib/env';
import { checkRateLimit } from '@/lib/rate-limit';
import { buildDocx, CV_WITH_REFEREES, DOCX_TYPE, REFEREES } from '../helpers/cv-fixtures';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #487 — akcje importu CV: flaga (domyślnie wyłączona), konto kandydata, limit wywołań
 * modelu, a zapis WYŁĄCZNIE zatwierdzonych pozycji przez RPC 0115 pod sesją kandydata.
 * Brak zatwierdzenia = brak wywołania bazy. Klient AI i baza to atrapy — zero prawdziwych wywołań.
 */

const extract = vi.fn();
const USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CANDIDATE = { id: USER, role: 'candidate' } as PortalIdentity;

vi.mock('@/lib/env', () => ({ isProductionMode: vi.fn(() => true) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
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
  vi.mocked(isProductionMode).mockReturnValue(true);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  resetFakeDb(CANDIDATE).rpc('apply_candidate_cv_proposals', () => ({
    occupations: 1,
    skills: 1,
    languages: 1,
    certificates: 1,
    experienceYears: true,
  }));
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
    expect(fakeDb.calls).toHaveLength(0);
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
    fakeSession.identity = null;
    expect(await proposeFromCvAction(CV_WITH_REFEREES)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(await applyCvProposals(APPROVED)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    fakeSession.identity = { id: USER, role: 'employer' } as PortalIdentity;
    expect(await proposeFromCvAction(CV_WITH_REFEREES)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(await applyCvProposals(APPROVED)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(extract).not.toHaveBeenCalled();
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('limit per konto (bez IP) przed wywołaniem modelu', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    expect(await proposeFromCvAction(CV_WITH_REFEREES)).toEqual({ ok: false, error: 'RATE_LIMITED' });
    expect(extract).not.toHaveBeenCalled();
    await proposeFromCvAction(CV_WITH_REFEREES);
    expect(checkRateLimit).toHaveBeenCalledWith('cv-import', expect.objectContaining({ identifier: USER, perIp: false }));
    expect(checkRateLimit).toHaveBeenCalledWith('cv-import-day', expect.objectContaining({ identifier: USER, perIp: false }));
  });
});

describe('podgląd i propozycje', () => {
  it('podgląd nie woła modelu ani bazy i nie zawiera danych referentów', async () => {
    const res = await prepareCvImportAction(docxForm());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (const v of Object.values(REFEREES)) expect(res.text).not.toContain(v);
    expect(extract).not.toHaveBeenCalled();
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('log użycia AI: jeden wiersz bez treści CV (#489)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await proposeFromCvAction(CV_WITH_REFEREES);
    const lines = info.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"ai_usage"'));
    info.mockRestore();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ feature: 'cv_profile_import', outcome: 'ok', inputKind: 'text' });
    for (const v of Object.values(REFEREES)) expect(lines[0]).not.toContain(v);
    expect(lines[0]).not.toContain('Magazynier');
  });

  it('propozycje nie zapisują niczego w profilu', async () => {
    const res = await proposeFromCvAction(CV_WITH_REFEREES);
    expect(res).toMatchObject({ ok: true });
    expect(fakeDb.calls).toHaveLength(0);
    for (const v of Object.values(REFEREES)) expect(String(extract.mock.calls[0]?.[0])).not.toContain(v);
  });
});

describe('zapis zatwierdzonych pozycji', () => {
  it('brak zatwierdzenia = brak zapisu (żadnego wywołania bazy)', async () => {
    const none = { occupations: [], skills: [], languages: [], certificates: [], experienceYears: null };
    expect(await applyCvProposals(none)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(await applyCvProposals({})).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('do bazy trafiają dokładnie zatwierdzone pozycje, jednym RPC pod sesją kandydata', async () => {
    const res = await applyCvProposals({ ...APPROVED, occupations: [], experienceYears: null });
    expect(res).toMatchObject({ ok: true });
    expect(fakeDb.calls.map((c) => c.name)).toEqual(['apply_candidate_cv_proposals']);
    const call = fakeDb.callsTo('apply_candidate_cv_proposals')[0]!;
    expect(call.as).toBe(USER);
    expect(call.args).toEqual({
      p_occupations: [],
      p_skills: ['Obsługa wózka widłowego'],
      p_languages: JSON.stringify([{ language: 'Niderlandzki', level: 'intermediate' }]),
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
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('błąd bazy → kod użytkowy bez szczegółów', async () => {
    for (const [message, code] of [
      ['VALIDATION_FAILED: skills too many', 'VALIDATION_FAILED'],
      ['PERMISSION_DENIED: profil kandydata', 'PERMISSION_DENIED'],
      ['relation "x" does not exist', 'INTERNAL'],
    ] as const) {
      resetFakeDb(CANDIDATE).rpc('apply_candidate_cv_proposals', () => {
        throw pgError('P0001', message);
      });
      expect(await applyCvProposals(APPROVED)).toEqual({ ok: false, error: code });
    }
  });

  it('tryb demo: walidacja bez zapisu', async () => {
    fakeSession.configured = false;
    expect(await applyCvProposals(APPROVED)).toMatchObject({ ok: true, demo: true });
    expect(fakeDb.calls).toHaveLength(0);
  });
});
