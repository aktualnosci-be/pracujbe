import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmailCampaignEditor } from '@/components/admin/EmailCampaignEditor';
import { routing } from '@/i18n/routing';
import { emptyCampaignForm, type CampaignEditorForm } from '@/lib/admin/campaign-editor';

/**
 * #820 — edytor kampanii traci zmianę wprowadzoną podczas zapisu: pola tekstowe pozostawały
 * edytowalne w trakcie `startTransition`, a `createEmailCampaignRevision` dostawał snapshot
 * z chwili kliknięcia. Ponieważ ta akcja jest idempotentna po `clientKey` (retry z tym samym
 * kluczem NIE aktualizuje treści), jedyną poprawną naprawą jest zablokowanie pól na czas
 * zapisu — administrator widzi, że formularz jest zamrożony, zamiast po cichu tracić edycję.
 */

const { createEmailCampaignRevision, push } = vi.hoisted(() => ({
  createEmailCampaignRevision: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@/lib/actions/admin-campaigns', () => ({ createEmailCampaignRevision }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

function fullForm(): CampaignEditorForm {
  const form = emptyCampaignForm('newsletter-pazdziernik');
  for (const locale of routing.locales) {
    form.content[locale] = [{ slug: `magazynier-${locale}`, title: `Magazynier ${locale}`, city: 'Gent', salary: '' }];
  }
  return form;
}

/** Pierwszy zapis czeka na ręczne rozwiązanie. */
function deferFirstSave(): (value?: { ok: true; id: string; demo?: false }) => void {
  let resolveSave: (value: { ok: true; id: string; demo?: false }) => void = () => {};
  createEmailCampaignRevision.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
  );
  return (value = { ok: true, id: 'c1' }) => resolveSave(value);
}

function slugInput(): HTMLInputElement {
  return screen.getByDisplayValue(/newsletter-pazdziernik|nowy-wpis/) as HTMLInputElement;
}

beforeEach(() => {
  createEmailCampaignRevision.mockReset();
  push.mockReset();
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('EmailCampaignEditor: pola w trakcie zapisu (#820)', () => {
  it('slug jest zablokowany podczas zapisu, żeby zmiana w tym czasie nie przepadła po cichu', async () => {
    const resolveSave = deferFirstSave();
    render(<EmailCampaignEditor mode="new" initial={fullForm()} />);

    const input = slugInput();
    expect(input).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'campaignEditorSave' }));
    expect(createEmailCampaignRevision).toHaveBeenCalledTimes(1);

    // Zablokowane pole nie przyjmuje edycji — brak fałszywego wrażenia zapisanej zmiany.
    expect(input).toBeDisabled();
    fireEvent.change(input, { target: { value: 'inny-slug' } });
    expect(input).toHaveValue('newsletter-pazdziernik');

    resolveSave({ ok: true, id: 'c1' });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/kampanie/c1'));

    // Zapisana treść to dokładnie ta ze snapshotu z chwili kliknięcia.
    expect(createEmailCampaignRevision.mock.calls[0]?.[1]).toMatchObject({ slug: 'newsletter-pazdziernik' });
  });

  it('pole treści oferty jest zablokowane podczas zapisu (nie tylko slug)', async () => {
    const resolveSave = deferFirstSave();
    render(<EmailCampaignEditor mode="new" initial={fullForm()} />);

    const titleInput = screen.getByDisplayValue(`Magazynier ${routing.locales[0]}`);
    expect(titleInput).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'campaignEditorSave' }));
    expect(titleInput).toBeDisabled();
    fireEvent.change(titleInput, { target: { value: 'Inny tytuł' } });
    expect(titleInput).toHaveValue(`Magazynier ${routing.locales[0]}`);

    resolveSave({ ok: true, id: 'c1' });
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it('kontrola ujemna: bez zapisu w toku pole przyjmuje edycję normalnie', () => {
    createEmailCampaignRevision.mockResolvedValue({ ok: true, id: 'c1' });
    render(<EmailCampaignEditor mode="new" initial={fullForm()} />);

    const input = slugInput();
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: 'nowy-wpis' } });
    expect(input).toHaveValue('nowy-wpis');
  });

  it('po zakończeniu zapisu (błąd) pole jest znów edytowalne', async () => {
    createEmailCampaignRevision.mockResolvedValueOnce({ ok: false, error: 'INTERNAL' });
    render(<EmailCampaignEditor mode="new" initial={fullForm()} />);

    fireEvent.click(screen.getByRole('button', { name: 'campaignEditorSave' }));
    await screen.findByText('errors.internal');
    await waitFor(() => expect(slugInput()).toBeEnabled());
  });
});
