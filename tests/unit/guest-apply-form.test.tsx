import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GuestApplyForm } from '@/components/public/GuestApplyForm';
import { screeningFieldId } from '@/components/public/ScreeningQuestionsFields';
import { submitGuestApplication } from '@/lib/actions/guest-applications';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/**
 * #98 — formularz aplikacji bez konta (Invariant #11): błędy przy polach z aria-invalid i
 * aria-describedby, fokus na pierwszym błędzie, brak wysyłki bez zgody, blokada w trakcie,
 * zachowane dane po błędzie sieci i TEN SAM klucz idempotencji przy ponowieniu, neutralny
 * sukces „sprawdź skrzynkę”. Język formularza trafia do akcji (język e-maili do gościa).
 */

vi.mock('@/lib/actions/guest-applications', () => ({ submitGuestApplication: vi.fn() }));

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

afterEach(cleanup);
beforeEach(() => vi.mocked(submitGuestApplication).mockReset());

type Messages = typeof en;

const REQUIRED_QUESTION = {
  id: '44444444-4444-4444-8444-444444444444',
  position: 0,
  type: 'yes_no' as const,
  required: true,
  prompt: { en: 'Do you have a C driving licence?' },
  options: [],
};

function renderForm(locale = 'en', messages: Messages = en, questions: (typeof REQUIRED_QUESTION)[] = []) {
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <GuestApplyForm
        jobId="11111111-1111-4111-8111-111111111111"
        companyName="ACME"
        screeningQuestions={questions}
        contentLocale="en"
      />
    </NextIntlClientProvider>,
  );
  const m = messages.guestApply;
  return {
    name: screen.getByRole('textbox', { name: new RegExp(m.fullName) }),
    email: screen.getByRole('textbox', { name: new RegExp(m.email) }),
    consent: screen.getByRole('checkbox', { name: messages.apply.consent }),
    submit: screen.getByRole('button', { name: messages.apply.submit }),
  };
}

describe('GuestApplyForm', () => {
  it('empty submit: field errors, focus on the first one, nothing sent', () => {
    const f = renderForm();
    fireEvent.click(f.submit);
    expect(submitGuestApplication).not.toHaveBeenCalled();
    expect(f.name).toHaveAttribute('aria-invalid', 'true');
    expect(f.name).toHaveAccessibleDescription(en.guestApply.error.nameRequired);
    expect(f.email).toHaveAccessibleDescription(en.guestApply.error.emailRequired);
    expect(f.consent).toHaveAccessibleDescription(en.guestApply.error.consentRequired);
    expect(document.activeElement).toBe(f.name);
  });

  it('invalid address is flagged at the field', () => {
    const f = renderForm();
    fireEvent.change(f.name, { target: { value: 'Anna' } });
    fireEvent.change(f.email, { target: { value: 'anna@' } });
    fireEvent.click(f.consent);
    fireEvent.click(f.submit);
    expect(submitGuestApplication).not.toHaveBeenCalled();
    expect(f.email).toHaveAccessibleDescription(en.guestApply.error.emailInvalid);
    expect(document.activeElement).toBe(f.email);
  });

  for (const [locale, messages] of Object.entries({ pl, nl, fr, en })) {
    it(`network error keeps data; retry reuses the idempotency key; success is neutral (${locale})`, async () => {
      const m = messages as Messages;
      vi.mocked(submitGuestApplication)
        .mockRejectedValueOnce(new Error('connection reset'))
        .mockResolvedValueOnce({ ok: true });
      const f = renderForm(locale, m);
      fireEvent.change(f.name, { target: { value: 'Anna Nowak' } });
      fireEvent.change(f.email, { target: { value: 'anna@example.com' } });
      fireEvent.click(f.consent);
      fireEvent.click(f.submit);

      expect(await screen.findByRole('alert')).toHaveTextContent(m.apply.errorNetwork);
      expect(f.name).toHaveValue('Anna Nowak');
      expect(f.submit).toBeEnabled();

      fireEvent.click(f.submit);
      expect(await screen.findByTestId('guest-apply-sent')).toHaveTextContent('anna@example.com');
      expect(screen.getByRole('heading', { name: m.guestApply.sentTitle })).toHaveFocus();

      const calls = vi.mocked(submitGuestApplication).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0]![0].idempotencyKey).toBe(calls[1]![0].idempotencyKey);
      expect(calls[0]![0]).toMatchObject({ locale, email: 'anna@example.com', fullName: 'Anna Nowak', agreeTerms: true });
    });
  }

  it('server phone error lands on the phone field; button is disabled while sending', async () => {
    let resolve: (v: Awaited<ReturnType<typeof submitGuestApplication>>) => void = () => {};
    vi.mocked(submitGuestApplication).mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const f = renderForm();
    fireEvent.change(f.name, { target: { value: 'Anna' } });
    fireEvent.change(f.email, { target: { value: 'anna@example.com' } });
    fireEvent.change(screen.getByRole('textbox', { name: en.guestApply.phoneOptional }), { target: { value: 'abc' } });
    fireEvent.click(f.consent);
    fireEvent.click(f.submit);
    await waitFor(() => expect(screen.getByRole('button', { name: en.apply.submitting })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: en.apply.submitting }));
    expect(submitGuestApplication).toHaveBeenCalledTimes(1);

    resolve({ ok: false, error: 'VALIDATION_FAILED', field: 'phone' });
    const phone = await screen.findByRole('textbox', { name: en.guestApply.phoneOptional });
    await waitFor(() => expect(phone).toHaveAttribute('aria-invalid', 'true'));
    expect(phone).toHaveAccessibleDescription(en.apply.phoneInvalid);
  });

  it('#101: required screening question blocks sending; the database error lands on the question', async () => {
    const f = renderForm('en', en, [REQUIRED_QUESTION]);
    fireEvent.change(f.name, { target: { value: 'Anna' } });
    fireEvent.change(f.email, { target: { value: 'anna@example.com' } });
    fireEvent.click(f.consent);
    fireEvent.click(f.submit);
    expect(submitGuestApplication).not.toHaveBeenCalled();
    expect(document.activeElement?.id).toBe(screeningFieldId(REQUIRED_QUESTION.id));

    vi.mocked(submitGuestApplication).mockResolvedValueOnce({
      ok: false,
      error: 'SCREENING_ANSWER_REQUIRED',
      questionId: REQUIRED_QUESTION.id,
    });
    const yes = screen.getByRole('radio', { name: en.apply.screeningYes });
    fireEvent.click(yes);
    fireEvent.click(f.submit);
    await waitFor(() => expect(submitGuestApplication).toHaveBeenCalledTimes(1));
    expect(vi.mocked(submitGuestApplication).mock.calls[0]![0].answers).toEqual({ [REQUIRED_QUESTION.id]: true });
    await waitFor(() => expect(document.activeElement?.id).toBe(screeningFieldId(REQUIRED_QUESTION.id)));
  });

  it('rate limit and unavailable feature show their own messages', async () => {
    vi.mocked(submitGuestApplication)
      .mockResolvedValueOnce({ ok: false, error: 'RATE_LIMITED' })
      .mockResolvedValueOnce({ ok: false, error: 'GUEST_APPLY_UNAVAILABLE' });
    const f = renderForm();
    fireEvent.change(f.name, { target: { value: 'Anna' } });
    fireEvent.change(f.email, { target: { value: 'anna@example.com' } });
    fireEvent.click(f.consent);
    fireEvent.click(f.submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.rateLimited);
    fireEvent.click(f.submit);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(en.guestApply.unavailable));
  });
});
