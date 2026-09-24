'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Sparkles } from 'lucide-react';

import { MatchBar } from '@/components/ui/match-bar';
import { getMyJobMatchAction } from '@/lib/actions/matching';
import type { JobMatchLoad } from '@/lib/data/matching';

/**
 * JobMatchCard — wyspa kliencka pokazująca dopasowanie ZALOGOWANEGO kandydata do oferty.
 *
 * Match liczony jest po stronie serwera (`getMyJobMatchAction` → deterministyczny `scoreMatch`)
 * i dohydrowany PO montażu — dzięki temu SSR/HTML detalu oferty jest identyczny dla anonimów
 * i robotów (SEO/cache), a kandydat dostaje spersonalizowany wynik. Dla anonimów/pracodawców/
 * osób bez profilu kandydata action zwraca `none` → komponent nie renderuje nic. Błąd odczytu
 * (`error` lub nieudane wywołanie) → komunikat z ponowieniem, NIGDY procent (#197).
 *
 * Etykiety kryteriów: `strengths`/część `missing` to znane klucze (tłumaczone), a pozostałe
 * pozycje `missing`/`matched` to surowe etykiety danych (np. nazwa umiejętności) — pokazywane
 * bez tłumaczenia. `summaryKey` zawsze jest jednym z good/partial/low. `languageGaps` (#195)
 * to języki znane poniżej wymaganego poziomu — opisane z poziomem wymaganym i deklarowanym.
 * `expiredCertificates` (#96) to wymagane certyfikaty kandydata z upływem ważności.
 */

const KNOWN_CRITERIA = new Set([
  'allMandatorySkills',
  'localCandidate',
  'remoteJob',
  'withinCommuteRadius',
  'experienceExceeds',
  'immediateStart',
  'noLanguageBarrier',
  'ownTransport',
  'location',
  'experience',
  'availability',
  'drivingLicense',
  'contractType',
]);

export function JobMatchCard({ jobId }: { jobId: string }): React.JSX.Element | null {
  const t = useTranslations('match');
  const tCommon = useTranslations('common');
  const [load, setLoad] = useState<JobMatchLoad | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setLoad(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let active = true;
    getMyJobMatchAction(jobId)
      .then((r) => {
        if (active) setLoad(r);
      })
      .catch(() => {
        if (active) setLoad({ status: 'error' });
      });
    return () => {
      active = false;
    };
  }, [jobId, attempt]);

  // Do czasu odpowiedzi oraz dla anonimów/pracodawców/braku profilu — nic nie renderujemy.
  if (!load || load.status === 'none') return null;

  if (load.status === 'error') {
    return (
      <div role="alert" data-testid="job-match-error" className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
          {t('title')}
        </h2>
        <p className="mt-2 break-words text-sm text-foreground">{t('loadError')}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-3 inline-flex min-h-12 items-center rounded-xl border border-border px-4 text-sm font-semibold text-foreground hover:bg-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {tCommon('retry')}
        </button>
      </div>
    );
  }

  const result = load.result;
  const label = (key: string): string => (KNOWN_CRITERIA.has(key) ? t(`criteria.${key}`) : key);
  const gaps = [
    ...result.missing.map((m) => ({ key: m, text: label(m) })),
    // Starsza odpowiedź serwera może nie mieć pola — traktujemy jak brak luk.
    ...(result.languageGaps ?? []).map((g) => ({
      key: `language:${g.language}`,
      text: g.actual
        ? t('languageLevelBelow', {
            language: g.language,
            required: t(`levels.${g.required}`),
            actual: t(`levels.${g.actual}`),
          })
        : t('languageLevelUnknown', { language: g.language, required: t(`levels.${g.required}`) }),
    })),
    // Wymagany certyfikat, którego ważność minęła (#96) — nie daje punktów.
    ...(result.expiredCertificates ?? []).map((c) => ({
      key: `certificate:${c}`,
      text: t('certificateExpired', { certificate: c }),
    })),
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
        {t('title')}
      </h2>

      <div className="mt-3 flex items-center gap-3">
        <span className="text-2xl font-bold tabular-nums text-success">{result.score}%</span>
        <MatchBar value={result.score} className="flex-1" />
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{t(`summary.${result.summaryKey}`)}</p>
      {result.mandatoryTotal > 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {t('mandatory', { met: result.mandatoryMet, total: result.mandatoryTotal })}
        </p>
      ) : null}

      {result.strengths.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">{t('strengthsTitle')}</h3>
          <ul className="space-y-1.5">
            {result.strengths.map((s) => (
              <li key={s} className="flex items-start gap-2 text-sm text-foreground">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                <span>{label(s)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {gaps.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{t('gapsTitle')}</h3>
          <ul className="space-y-1.5">
            {gaps.map((gap) => (
              <li key={gap.key} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground"
                  aria-hidden="true"
                />
                <span>{gap.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
