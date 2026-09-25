'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { CHECKBOX, FORM_FIELD, FORM_HINT, FORM_LABEL_TEXT, FORM_SELECT, TAG } from '@/components/dashboard/panel-styles';
import type { CvApprovedProposals, CvProposal, CvProposalKind, LanguageLevel } from '@/lib/cv-import/types';
import { cn } from '@/lib/utils';
import { LANGUAGE_LEVELS } from '@/lib/validation/candidate';

/**
 * Lista propozycji pól profilu do zatwierdzenia (#487 import CV, #37 asystent profilu).
 * Każda pozycja osobno, domyślnie NIE zaznaczona, ze źródłem i oznaczeniem niepewności;
 * poziom języka do poprawienia przed zapisem. Źródło opisuje wywołujący (CV / odpowiedź).
 */

const KIND_ORDER: CvProposalKind[] = ['occupation', 'skill', 'language', 'certificate', 'experienceYears'];
const KIND_LABEL: Record<CvProposalKind, string> = {
  occupation: 'kindOccupation',
  skill: 'kindSkill',
  language: 'kindLanguage',
  certificate: 'kindCertificate',
  experienceYears: 'kindExperience',
};
const LEVEL_LABEL: Record<LanguageLevel, string> = {
  basic: 'levelBasic',
  intermediate: 'levelIntermediate',
  fluent: 'levelFluent',
  native: 'levelNative',
};

export interface ProposalChecklistProps {
  idPrefix: string;
  proposals: CvProposal[];
  selected: ReadonlySet<string>;
  onToggle: (id: string, checked: boolean) => void;
  levels: Readonly<Record<string, LanguageLevel>>;
  onLevel: (id: string, level: LanguageLevel) => void;
  busy: boolean;
  /** Tekst pod pozycją: źródło (cytat) albo informacja o jego braku. */
  sourceText: (proposal: CvProposal) => string;
}

export function ProposalChecklist({
  idPrefix,
  proposals,
  selected,
  onToggle,
  levels,
  onLevel,
  busy,
  sourceText,
}: ProposalChecklistProps): React.JSX.Element {
  const t = useTranslations('cvImport');
  const to = useTranslations('onboarding');
  return (
    <>
      {KIND_ORDER.map((kind) => {
        const items = proposals.filter((p) => p.kind === kind);
        if (items.length === 0) return null;
        return (
          <fieldset key={kind} className="mt-6 min-w-0 border-t border-border pt-4">
            <legend className="float-left mb-2 w-full text-[15px] font-bold text-foreground">{t(KIND_LABEL[kind])}</legend>
            <ul className="clear-both flex list-none flex-col gap-3 p-0">
              {items.map((p) => {
                const checkboxId = `${idPrefix}-${p.id}`;
                const sourceId = `${checkboxId}-source`;
                return (
                  <li key={p.id} className="min-w-0 rounded-[11px] border border-border p-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-[9px]">
                      <input
                        id={checkboxId}
                        type="checkbox"
                        className={CHECKBOX}
                        checked={selected.has(p.id)}
                        disabled={busy}
                        aria-describedby={sourceId}
                        onChange={(e) => onToggle(p.id, e.target.checked)}
                      />
                      <label htmlFor={checkboxId} className="min-w-0 break-words text-[15px] font-semibold text-foreground">
                        {kind === 'experienceYears' ? t('experienceValue', { count: Number(p.value) }) : p.value}
                      </label>
                      {p.uncertain ? <span className={cn(TAG, 'text-[12px] font-semibold text-warning-text')}>{t('uncertain')}</span> : null}
                    </div>
                    <p id={sourceId} className={cn(FORM_HINT, 'mt-1.5 break-words')}>
                      {sourceText(p)}
                    </p>
                    {kind === 'language' ? (
                      <div className={cn(FORM_FIELD, 'mt-2 max-w-xs')}>
                        <label htmlFor={`${checkboxId}-level`} className={FORM_LABEL_TEXT}>
                          {t('levelLabel', { language: p.value })}
                        </label>
                        <select
                          id={`${checkboxId}-level`}
                          className={FORM_SELECT}
                          disabled={busy}
                          value={levels[p.id] ?? p.level ?? 'basic'}
                          onChange={(e) => onLevel(p.id, e.target.value as LanguageLevel)}
                        >
                          {LANGUAGE_LEVELS.map((lvl) => (
                            <option key={lvl} value={lvl}>{to(LEVEL_LABEL[lvl])}</option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </>
  );
}

/** Zatwierdzone pozycje → wejście akcji zapisu (wspólne dla importu CV i asystenta). */
export function approvedPayload(
  proposals: CvProposal[],
  selected: ReadonlySet<string>,
  levels: Readonly<Record<string, LanguageLevel>>,
): CvApprovedProposals {
  const chosen = proposals.filter((p) => selected.has(p.id));
  const of = (kind: CvProposalKind) => chosen.filter((p) => p.kind === kind);
  const experience = of('experienceYears')[0];
  return {
    occupations: of('occupation').map((p) => p.value),
    skills: of('skill').map((p) => p.value),
    languages: of('language').map((p) => ({ language: p.value, level: levels[p.id] ?? p.level ?? 'basic' })),
    certificates: of('certificate').map((p) => p.value),
    experienceYears: experience ? Number(experience.value) : null,
  };
}
