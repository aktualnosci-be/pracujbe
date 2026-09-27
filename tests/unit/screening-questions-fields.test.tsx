import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScreeningQuestionsFields } from '@/components/public/ScreeningQuestionsFields';
import type { ScreeningAnswerValue, ScreeningQuestion } from '@/lib/screening/questions';
import pl from '@/messages/pl.json';

/**
 * #916 — pytania `yes_no`/`single_choice` muszą pozwalać wrócić do stanu „bez odpowiedzi”,
 * gdy pytanie jest opcjonalne. Przycisk „Wyczyść odpowiedź” woła `onChange(id, undefined)`;
 * dla pytań wymaganych kontrolka się nie pojawia (kontrola ujemna).
 */

afterEach(cleanup);

const YES_NO: ScreeningQuestion = {
  id: 'q1',
  position: 1,
  type: 'yes_no',
  required: false,
  prompt: { pl: 'Czy masz prawo jazdy kat. B?' },
  options: [],
};

const SINGLE_CHOICE: ScreeningQuestion = {
  id: 'q2',
  position: 2,
  type: 'single_choice',
  required: false,
  prompt: { pl: 'Jak dojedziesz do pracy?' },
  options: [
    { id: 'o1', label: { pl: 'Samochodem' } },
    { id: 'o2', label: { pl: 'Rowerem' } },
  ],
};

const REQUIRED_YES_NO: ScreeningQuestion = {
  ...YES_NO,
  id: 'q3',
  required: true,
  prompt: { pl: 'Czy masz certyfikat VCA?' },
};

function renderFields(
  questions: ScreeningQuestion[],
  values: Record<string, ScreeningAnswerValue>,
  onChange: (id: string, value: ScreeningAnswerValue | undefined) => void,
) {
  return render(
    <NextIntlClientProvider locale="pl" messages={pl}>
      <ScreeningQuestionsFields
        questions={questions}
        companyName="Test sp. z o.o."
        values={values}
        errors={{}}
        onChange={onChange}
      />
    </NextIntlClientProvider>,
  );
}

describe('ScreeningQuestionsFields — czyszczenie opcjonalnej odpowiedzi (#916)', () => {
  it('pytanie tak/nie: przycisk „Wyczyść odpowiedź” pojawia się dopiero po zaznaczeniu i woła onChange(undefined)', () => {
    const onChange = vi.fn();
    const { rerender } = renderFields([YES_NO], {}, onChange);

    expect(screen.queryByRole('button', { name: pl.apply.screeningClearAnswer })).toBeNull();

    fireEvent.click(screen.getByLabelText('Tak'));
    expect(onChange).toHaveBeenCalledWith('q1', true);

    rerender(
      <NextIntlClientProvider locale="pl" messages={pl}>
        <ScreeningQuestionsFields
          questions={[YES_NO]}
          companyName="Test sp. z o.o."
          values={{ q1: true }}
          errors={{}}
          onChange={onChange}
        />
      </NextIntlClientProvider>,
    );

    const clearButton = screen.getByRole('button', { name: pl.apply.screeningClearAnswer });
    fireEvent.click(clearButton);
    expect(onChange).toHaveBeenLastCalledWith('q1', undefined);
  });

  it('pytanie jednokrotnego wyboru: zmiana odpowiedzi zastępuje wartość, wyczyszczenie usuwa ją bez utraty innych pól', () => {
    const onChange = vi.fn();
    renderFields([SINGLE_CHOICE], { q2: 'o1' }, onChange);

    fireEvent.click(screen.getByLabelText('Rowerem'));
    expect(onChange).toHaveBeenCalledWith('q2', 'o2');

    const clearButton = screen.getByRole('button', { name: pl.apply.screeningClearAnswer });
    fireEvent.click(clearButton);
    expect(onChange).toHaveBeenLastCalledWith('q2', undefined);
  });

  it('kontrola ujemna: pytanie wymagane nigdy nie pokazuje przycisku czyszczenia, nawet z odpowiedzią', () => {
    renderFields([REQUIRED_YES_NO], { q3: false }, vi.fn());
    expect(screen.queryByRole('button', { name: pl.apply.screeningClearAnswer })).toBeNull();
  });

  it('dwa pytania naraz: wyczyszczenie jednego nie dotyka drugiego (rodzic usuwa tylko swój klucz)', () => {
    const values: Record<string, ScreeningAnswerValue> = { q1: true, q2: 'o1' };
    const onChange = vi.fn((id: string, value: ScreeningAnswerValue | undefined) => {
      if (value === undefined) delete values[id];
      else values[id] = value;
    });
    renderFields([YES_NO, SINGLE_CHOICE], values, onChange);

    const buttons = screen.getAllByRole('button', { name: pl.apply.screeningClearAnswer });
    expect(buttons).toHaveLength(2);
    const [firstButton] = buttons;
    expect(firstButton).toBeDefined();
    fireEvent.click(firstButton as HTMLElement);

    expect(onChange).toHaveBeenLastCalledWith('q1', undefined);
    expect(values).toEqual({ q2: 'o1' });
  });
});
