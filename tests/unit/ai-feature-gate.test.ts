import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { isAiFeatureAllowedInPortalMode, isAiFeatureEnabled } from '@/lib/ai/feature-gate';
import { AI_FEATURES, type AiFeatureId } from '@/lib/ai/inventory';
import { jobAssistProvider } from '@/lib/ai-assist/config';
import { jobImportProvider } from '@/lib/ai-import/config';
import { jobSearchAssistProvider } from '@/lib/ai-search/config';
import { jobFraudCheckProvider } from '@/lib/job-trust/ai-check';
import { PORTAL_LEGAL_MODE_ENV } from '@/lib/portal-mode';
import { translationProvider } from '@/lib/translation/config';
import { translationFeatureFor } from '@/lib/translation/feature';
import type { TranslationProvider } from '@/lib/translation/provider';
import type { ClaimedTranslationJob, TranslationQueueStore } from '@/lib/translation/store';
import { processTranslationBatch } from '@/lib/translation/worker';

/**
 * #1152 — wspólna bramka „flaga funkcji × tryb produktu” (decyzja produktowa: portal
 * ogłoszeniowy). W trybie ogłoszeniowym działają tylko funkcje na treści ogłoszenia.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

const MODES = [
  { mode: 'RECRUITMENT', recruitment: true },
  { mode: 'recruitment', recruitment: true },
  { mode: undefined, recruitment: false },
  { mode: '', recruitment: false },
  { mode: 'CLASSIFIEDS_ONLY', recruitment: false },
  { mode: 'true', recruitment: false },
  { mode: 'RECRUITMENT_', recruitment: false },
] as const;

const FLAGS = [
  { flag: undefined, on: false },
  { flag: '0', on: false },
  { flag: 'yes', on: false },
  { flag: '1', on: true },
  { flag: 'true', on: true },
] as const;

describe('isAiFeatureEnabled — każda kombinacja flaga funkcji × tryb', () => {
  for (const feature of AI_FEATURES) {
    for (const { mode, recruitment } of MODES) {
      for (const { flag, on } of FLAGS) {
        const expected = on && (feature.allowedInClassifieds || recruitment);
        it(`${feature.id}: ${feature.enableFlag}=${String(flag)} × ${PORTAL_LEGAL_MODE_ENV}=${String(mode)} → ${expected}`, () => {
          vi.stubEnv(feature.enableFlag, flag);
          vi.stubEnv(PORTAL_LEGAL_MODE_ENV, mode);
          expect(isAiFeatureEnabled(feature.id)).toBe(expected);
          expect(isAiFeatureAllowedInPortalMode(feature.id)).toBe(feature.allowedInClassifieds || recruitment);
        });
      }
    }
  }

  it('tryb nieustalony w produkcji (brak zmiennej) = funkcje z wejściem kandydata wyłączone', () => {
    vi.stubEnv('APP_MODE', 'production');
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, undefined);
    for (const feature of AI_FEATURES) vi.stubEnv(feature.enableFlag, 'true');
    const candidateFeatures = AI_FEATURES.filter((f) => !f.allowedInClassifieds).map((f) => f.id);
    expect(candidateFeatures).toEqual(expect.arrayContaining(['cv_profile_import', 'candidate_profile_translation']));
    for (const id of candidateFeatures) expect(isAiFeatureEnabled(id), id).toBe(false);
  });

  it('nieznana funkcja = wyłączona (fail-closed)', () => {
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, 'RECRUITMENT');
    expect(isAiFeatureEnabled('nie_ma' as AiFeatureId)).toBe(false);
    expect(isAiFeatureAllowedInPortalMode('nie_ma' as AiFeatureId)).toBe(false);
  });
});

describe('funkcje na treści ogłoszenia — bez zmian zachowania w trybie ogłoszeniowym', () => {
  it.each([
    ['AI_JOB_IMPORT_ENABLED', 'AI_JOB_IMPORT_PROVIDER', () => jobImportProvider()],
    ['AI_JOB_ASSIST_ENABLED', 'AI_JOB_ASSIST_PROVIDER', () => jobAssistProvider()],
    ['AI_JOB_FRAUD_CHECK_ENABLED', 'AI_JOB_FRAUD_CHECK_PROVIDER', () => jobFraudCheckProvider()],
    ['AI_TRANSLATION_ENABLED', 'AI_TRANSLATION_PROVIDER', () => translationProvider()],
    ['AI_JOB_SEARCH_ENABLED', 'AI_JOB_SEARCH_PROVIDER', () => jobSearchAssistProvider()],
  ] as const)('%s: tryb ogłoszeniowy = ten sam dostawca co RECRUITMENT; bez flagi = null', (flag, providerEnv, read) => {
    vi.stubEnv(providerEnv, 'fixture');
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, '');
    vi.stubEnv(flag, 'true');
    expect(read()).toBe('fixture');
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, 'RECRUITMENT');
    expect(read()).toBe('fixture');
    vi.stubEnv(flag, '');
    expect(read()).toBeNull();
  });

  it('konfiguracje funkcji używają wspólnej bramki, nie czytają flagi samodzielnie', () => {
    const ROOT = join(__dirname, '..', '..');
    const CONFIGS: Record<string, AiFeatureId> = {
      'src/lib/ai-import/config.ts': 'job_listing_import',
      'src/lib/ai-assist/config.ts': 'job_offer_assist',
      'src/lib/job-trust/ai-check.ts': 'job_fraud_check',
      'src/lib/translation/config.ts': 'content_translation',
      'src/lib/ai-search/config.ts': 'job_search_filters',
    };
    for (const [path, id] of Object.entries(CONFIGS)) {
      const source = readFileSync(join(ROOT, path), 'utf8');
      expect(source, path).toContain(`if (!isAiFeatureEnabled('${id}')) return null;`);
      const flag = AI_FEATURES.find((f) => f.id === id)!.enableFlag;
      expect(source, path).not.toMatch(new RegExp(`flagOn\\(process\\.env\\.${flag}\\)\\) return null`));
    }
  });
});

describe('worker tłumaczeń — profil kandydata w trybie ogłoszeniowym', () => {
  const job = (entity_type: ClaimedTranslationJob['entity_type']): ClaimedTranslationJob => ({
    job_id: `job-${entity_type}`,
    lease_id: 'lease-1',
    lease_expires_at: new Date(Date.now() + 300_000).toISOString(),
    attempt: 1,
    entity_type,
    entity_id: 'entity-1',
    revision_id: 'rev-1',
    revision_no: 1,
    source_locale: 'pl',
    target_locale: 'en',
    pipeline_version: 'translation-v1',
    fields: { title: 'Magazynier' },
  });
  const store = (jobs: ClaimedTranslationJob[]) =>
    ({
      claim: vi.fn(async () => jobs),
      complete: vi.fn(async () => 'applied' as const),
      fail: vi.fn(async () => 'failed' as const),
      defer: vi.fn(async () => 'deferred' as const),
    }) satisfies TranslationQueueStore;
  const provider = () =>
    ({
      translate: vi.fn(async () => ({ output: { title: 'Warehouse worker' }, model: 'gpt-6-luna', inputTokens: 1, outputTokens: 1 })),
    }) satisfies TranslationProvider;

  it('zadanie profilu nie trafia do modelu; oferta — tak (z funkcją budżetu content_translation)', async () => {
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, '');
    const s = store([job('candidate_profile'), job('job')]);
    const p = provider();
    const r = await processTranslationBatch({ store: s, provider: p });
    expect(r).toMatchObject({ claimed: 2, applied: 1, failed: 1 });
    expect(p.translate).toHaveBeenCalledTimes(1);
    expect(p.translate).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'job' }));
    expect(s.fail).toHaveBeenCalledWith(expect.objectContaining({ entity_type: 'candidate_profile' }), 'recruitment_disabled', false, null);
  });

  it('kontrola ujemna: w trybie RECRUITMENT ten sam profil jest tłumaczony (bramka zależy od trybu)', async () => {
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, 'RECRUITMENT');
    const s = store([job('candidate_profile')]);
    const p = provider();
    const r = await processTranslationBatch({ store: s, provider: p });
    expect(r.applied).toBe(1);
    expect(p.translate).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'candidate_profile' }));
  });

  it('budżet i log: profil kandydata rozliczany jako osobna funkcja', () => {
    expect(translationFeatureFor('job')).toBe('content_translation');
    expect(translationFeatureFor(undefined)).toBe('content_translation');
    expect(translationFeatureFor('candidate_profile')).toBe('candidate_profile_translation');
  });
});
