'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Sparkles } from 'lucide-react';

import { MatchBar } from '@/components/ui/match-bar';
import { getMyJobMatchAction } from '@/lib/actions/matching';
import type { MatchResult } from '@/lib/matching/score';

/**
 * JobMatchCard — wyspa kliencka pokazująca dopasowanie ZALOGOWANEGO kandydata do oferty.
 *
 * Match liczony jest po stronie serwera (`getMyJobMatchAction` → deterministyczny `scoreMatch`)
 * i dohydrowany PO montażu — dzięki temu SSR/HTML detalu oferty jest identyczny dla anonimów
 * i robotów (SEO/cache), a kandydat dostaje spersonalizowany wynik. Dla anonimów/pracodawców/
 * osób bez profilu kandydata action zwraca `null` → komponent nie renderuje nic.
 *
 * Etykiety kryteriów: `strengths`/część `missing` to znane klucze (tłumaczone), a pozostałe
 * pozycje `missing`/`matched` to surowe etykiety danych (np. nazwa umiejętności) — pokazywane
 * bez tłumaczenia. `summaryKey` zawsze jest jednym z good/partial/low.
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
  const [result, setResult] = useState<MatchResult | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    getMyJobMatchAction(jobId)
      .then((r) => {
        if (active) {
          setResult(r);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [jobId]);

  // Do czasu odpowiedzi oraz dla anonimów/pracodawców/braku profilu — nic nie renderujemy.
  if (!loaded || !result) return null;

  const label = (key: string): string => (KNOWN_CRITERIA.has(key) ? t(`criteria.${key}`) : key);

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

      {result.missing.length > 0 ? (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{t('gapsTitle')}</h3>
          <ul className="space-y-1.5">
            {result.missing.map((m) => (
              <li key={m} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground"
                  aria-hidden="true"
                />
                <span>{label(m)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
