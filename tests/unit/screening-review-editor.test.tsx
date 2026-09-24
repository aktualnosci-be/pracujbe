import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';

import { ScreeningQuestionsEditor } from '@/components/employer/ScreeningQuestionsEditor';
import type { ScreeningQuestionDraft } from '@/lib/screening/questions';
import type { ScreeningReviewNotice } from '@/lib/screening/review';
import pl from '@/messages/pl.json';

/**
 * #497 — kreator: pytanie oznaczone przez detektor ma informację przy treści (powiązaną
 * z polem przez aria-describedby); stan z próby publikacji pokazuje odrzucenie z uzasadnieniem;
 * typowe pytanie nie ma żadnej informacji (kontrola ujemna).
 */

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

afterEach(cleanup);

const QUESTIONS: ScreeningQuestionDraft[] = [
  { type: 'yes_no', required: true, prompt: { pl: 'Czy masz prawo jazdy C+E?' }, options: [] },
  { type: 'date', required: false, prompt: { pl: 'Od kiedy?', fr: 'Votre date de naissance ?' }, options: [] },
];

function renderEditor(reviews: ScreeningReviewNotice[] = []) {
  render(
    <NextIntlClientProvider locale="pl" messages={pl}>
      <ScreeningQuestionsEditor
        value={QUESTIONS}
        onChange={() => {}}
        contentLocale="pl"
        readOnly={false}
        errors={{}}
        reviews={reviews}
      />
    </NextIntlClientProvider>,
  );
}

describe('ScreeningQuestionsEditor — kontrola treści (#497)', () => {
  it('ryzykowne tłumaczenie → podpowiedź przy treści pytania, powiązana z polem', () => {
    renderEditor();
    const hint = screen.getByTestId('screening-question-2-review');
    expect(hint.textContent).toContain(pl.screeningReview.categoryAge);
    const input = document.getElementById('job-sq-1-prompt');
    expect(input?.getAttribute('aria-describedby')).toContain(hint.id);
  });

  it('kontrola ujemna: pytanie o prawo jazdy bez informacji', () => {
    renderEditor();
    expect(screen.queryByTestId('screening-question-1-review')).toBeNull();
    expect(document.getElementById('job-sq-0-prompt')?.getAttribute('aria-describedby')).toBeNull();
  });

  it('stan z publikacji: odrzucone z uzasadnieniem admina', () => {
    renderEditor([{ index: 1, status: 'rejected', categories: ['age'], reason: 'Usuń datę urodzenia.' }]);
    const notice = screen.getByTestId('screening-question-2-review');
    expect(notice.textContent).toContain('Usuń datę urodzenia.');
    expect(notice.textContent).toContain(
      pl.jobWizard.screeningReviewRejected.replace('{categories}', pl.screeningReview.categoryAge),
    );
  });
});
