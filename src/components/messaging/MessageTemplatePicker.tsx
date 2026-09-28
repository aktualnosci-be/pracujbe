'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';

import type { Locale } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import {
  fillTemplate,
  pickTemplateVariant,
  type ComposerTemplates,
  type TemplatePick,
} from '@/lib/validation/message-template';
import { BTN_SMALL, FORM_SELECT, INLINE_LINK } from '@/components/dashboard/panel-styles';

/**
 * Wstawianie szablonu odpowiedzi w kompozytorze rekrutera (0170).
 *
 * Wariant = język KANDYDATA (Invariant #1, `resolve_recipient_locale` z bazy). Gdy szablon nie
 * ma wersji w tym języku, nic nie jest wstawiane po cichu: komunikat mówi rekruterowi, że
 * kandydat ma inny język, a wersję w innym języku można wstawić tylko świadomie (przycisk
 * z nazwą języka). Zmienne `{imie}`, `{stanowisko}`, `{firma}` wypełniane danymi rozmowy;
 * wstawiony tekst trafia do pola — rekruter widzi i poprawia go przed wysłaniem.
 */

export interface MessageTemplatePickerProps {
  context: ComposerTemplates;
  /** Imię/nazwa kandydata z wątku (pusty = znacznik `{imie}` zostaje do uzupełnienia). */
  candidateName: string;
  disabled: boolean;
  onInsert: (text: string) => void;
}

export function MessageTemplatePicker({
  context,
  candidateName,
  disabled,
  onInsert,
}: MessageTemplatePickerProps): React.JSX.Element {
  const t = useTranslations('messageTemplates');
  const locale = useLocale();
  const selectId = React.useId();
  const noticeId = `${selectId}-notice`;
  const [chosenId, setChosenId] = React.useState('');
  const [missing, setMissing] = React.useState<Extract<TemplatePick, { status: 'missing' }> | null>(null);

  const language = (code: Locale | null): string => (code ? t(`languages.${code}`) : t('languageUnknown'));

  function insertBody(body: string): void {
    onInsert(
      fillTemplate(body, {
        imie: candidateName,
        stanowisko: context.jobTitle,
        firma: context.companyName,
      }),
    );
    setMissing(null);
    setChosenId('');
  }

  function choose(id: string): void {
    setChosenId(id);
    const template = context.templates.find((item) => item.id === id);
    if (!template) {
      setMissing(null);
      return;
    }
    const pick = pickTemplateVariant(template, context.candidateLocale);
    if (pick.status === 'match') insertBody(pick.body);
    else setMissing(pick);
  }

  const chosen = context.templates.find((item) => item.id === chosenId);

  return (
    <div className="mb-3 flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <label htmlFor={selectId} className="text-[13px] font-semibold text-foreground">
          {t('pickerLabel')}
        </label>
        {context.templates.length === 0 ? (
          <a href={`/${locale}/employer/szablony`} className={INLINE_LINK}>
            {t('pickerEmpty')}
          </a>
        ) : (
          <select
            id={selectId}
            className={cn(FORM_SELECT, 'min-w-[12rem] flex-1 basis-48')}
            value={chosenId}
            disabled={disabled}
            aria-describedby={missing ? noticeId : undefined}
            onChange={(event) => choose(event.target.value)}
          >
            <option value="">{t('pickerPlaceholder')}</option>
            {context.templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        )}
        <span className="text-xs text-muted-foreground">
          {t('pickerCandidateLanguage', { language: language(context.candidateLocale) })}
        </span>
      </div>
      {missing && chosen ? (
        <div id={noticeId} role="alert" className="rounded-[11px] border border-[color:var(--pp-line)] bg-soft p-3 text-[13px] text-foreground">
          <p>
            {t('pickerMissingVariant', {
              name: chosen.name,
              language: language(missing.candidateLocale),
            })}
          </p>
          {missing.available.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {missing.available.map((code) => (
                <button
                  key={code}
                  type="button"
                  className={BTN_SMALL}
                  disabled={disabled}
                  onClick={() => {
                    const body = chosen.variants[code];
                    if (body) insertBody(body);
                  }}
                >
                  {t('pickerInsertOther', { language: language(code) })}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
