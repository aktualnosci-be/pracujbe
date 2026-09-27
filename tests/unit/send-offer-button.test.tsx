import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SendOfferButton } from '@/components/employer/SendOfferButton';

const { refresh, sendOffer } = vi.hoisted(() => ({ refresh: vi.fn(), sendOffer: vi.fn() }));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/actions/offers', () => ({ sendOffer }));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) =>
    params ? `${key}|${Object.values(params).join('|')}` : key,
  useFormatter: () => ({ dateTime: () => '20 wrz 2026' }),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const JOB = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const CANDIDATE = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';

const JOB_B = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';

function button(jobId: string, offerSentAt: string | null = null, jobTitle = 'Operator wózka') {
  return (
    <SendOfferButton
      jobId={jobId}
      candidateId={CANDIDATE}
      candidateName="Piotr Nowak"
      jobTitle={jobTitle}
      jobSlug="operator-wozka"
      offerSentAt={offerSentAt}
    />
  );
}

function renderButton(offerSentAt: string | null = null) {
  return render(button(JOB, offerSentAt));
}

async function submitOffer() {
  fireEvent.click(screen.getByRole('button', { name: /^sendOfferTo/ }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getAllByRole('button', { name: 'sendOffer' }).at(-1)!);
}

describe('SendOfferButton (#327)', () => {
  it('nie wysyła od razu: najpierw dialog z kandydatem, ofertą i podglądem zaproszenia', async () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'sendOfferTo|Piotr Nowak|Operator wózka' }));
    expect(sendOffer).not.toHaveBeenCalled();
    // Treść LightDialog montuje się po ramce z nakładką (#393).
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Piotr Nowak');
    expect(screen.getByRole('link', { name: 'Operator wózka' })).toHaveAttribute('href', '/oferty-pracy/operator-wozka');
    expect(dialog).toHaveTextContent('offerDefaultMessage');
  });

  it('potwierdzenie bez własnej treści wysyła message=undefined i stały klucz idempotencji', async () => {
    sendOffer.mockResolvedValue({ ok: false, error: 'INTERNAL' });
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /^sendOfferTo/ }));
    await screen.findByRole('dialog');
    const submitButton = () => screen.getAllByRole('button', { name: 'sendOffer' }).at(-1)!;
    fireEvent.click(submitButton());
    await waitFor(() => expect(sendOffer).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(submitButton()).toBeEnabled());
    fireEvent.click(submitButton());
    await waitFor(() => expect(sendOffer).toHaveBeenCalledTimes(2));
    const [first, second] = sendOffer.mock.calls.map((c) => c[0]);
    expect(first).toMatchObject({ jobId: JOB, candidateId: CANDIDATE, message: undefined });
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it('sukces: stan „wysłano” i komunikat o wysłaniu (toast nie znika razem z przyciskiem)', async () => {
    sendOffer.mockResolvedValue({ ok: true, id: 'offer-1' });
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /^sendOfferTo/ }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getAllByRole('button', { name: 'sendOffer' }).at(-1)!);
    expect(await screen.findByText('offerSentSuccess')).toBeInTheDocument();
    expect(screen.getByText('offerSentOn|20 wrz 2026')).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('za krótka własna wiadomość: błąd przy polu, brak wysyłki', async () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /^sendOfferTo/ }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('offerDialogMessageLabel'), { target: { value: 'Hej' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'sendOffer' }).at(-1)!);
    expect(screen.getByRole('alert')).toHaveTextContent('offer.error.messageTooShort');
    expect(sendOffer).not.toHaveBeenCalled();
  });

  it('propozycja wysłana wcześniej (stan z DB) — brak przycisku wysyłki po odświeżeniu', () => {
    renderButton('2026-09-20T10:00:00Z');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('offerSentOn|20 wrz 2026')).toBeInTheDocument();
  });

  describe('zmiana celu w tej samej instancji (#853)', () => {
    it('inna oferta po przełączeniu firmy = nowy klucz; retry tej samej pary = ten sam klucz', async () => {
      sendOffer.mockResolvedValue({ ok: true, id: 'offer-a' });
      const view = renderButton();
      await submitOffer();
      expect(await screen.findByText('offerSentSuccess')).toBeInTheDocument();
      const keyA = sendOffer.mock.calls[0]![0].idempotencyKey as string;

      // router.refresh() po przełączeniu firmy: ta sama instancja, inna oferta, bez propozycji.
      view.rerender(button(JOB_B, null, 'Kierowca'));
      sendOffer.mockResolvedValue({ ok: false, error: 'INTERNAL' });
      await submitOffer();
      await waitFor(() => expect(sendOffer).toHaveBeenCalledTimes(2));
      const second = sendOffer.mock.calls[1]![0];
      expect(second).toMatchObject({ jobId: JOB_B, candidateId: CANDIDATE });
      expect(second.idempotencyKey).not.toBe(keyA);

      // Ponowienie po błędzie dla oferty B — ten sam klucz B (Invariant #3).
      await waitFor(() => expect(screen.getAllByRole('button', { name: 'sendOffer' }).at(-1)).toBeEnabled());
      fireEvent.click(screen.getAllByRole('button', { name: 'sendOffer' }).at(-1)!);
      await waitFor(() => expect(sendOffer).toHaveBeenCalledTimes(3));
      expect(sendOffer.mock.calls[2]![0].idempotencyKey).toBe(second.idempotencyKey);
    });

    it('nowy cel czyści lokalny stan „wysłano” poprzedniej oferty', async () => {
      sendOffer.mockResolvedValue({ ok: true, id: 'offer-a' });
      const view = renderButton();
      await submitOffer();
      expect(await screen.findByText('offerSentOn|20 wrz 2026')).toBeInTheDocument();
      view.rerender(button(JOB_B, null, 'Kierowca'));
      expect(screen.queryByText('offerSentOn|20 wrz 2026')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'sendOfferTo|Piotr Nowak|Kierowca' })).toBeInTheDocument();
    });

    it('odpowiedź dla poprzedniego celu nie oznacza nowej oferty jako wysłanej', async () => {
      let resolve: (value: { ok: true; id: string }) => void = () => {};
      sendOffer.mockImplementation(() => new Promise((r) => { resolve = r; }));
      const view = renderButton();
      await submitOffer();
      await waitFor(() => expect(sendOffer).toHaveBeenCalledTimes(1));
      view.rerender(button(JOB_B, null, 'Kierowca'));
      await act(async () => resolve({ ok: true, id: 'offer-a' }));
      expect(screen.queryByText('offerSentSuccess')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'sendOfferTo|Piotr Nowak|Kierowca' })).toBeInTheDocument();
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });
});
