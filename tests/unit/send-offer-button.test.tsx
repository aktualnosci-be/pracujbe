import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function renderButton(offerSentAt: string | null = null) {
  render(
    <SendOfferButton
      jobId={JOB}
      candidateId={CANDIDATE}
      candidateName="Piotr Nowak"
      jobTitle="Operator wózka"
      jobSlug="operator-wozka"
      offerSentAt={offerSentAt}
    />,
  );
}

describe('SendOfferButton (#327)', () => {
  it('nie wysyła od razu: najpierw dialog z kandydatem, ofertą i podglądem zaproszenia', () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'sendOfferTo|Piotr Nowak|Operator wózka' }));
    expect(sendOffer).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Piotr Nowak');
    expect(screen.getByRole('link', { name: 'Operator wózka' })).toHaveAttribute('href', '/oferty-pracy/operator-wozka');
    expect(dialog).toHaveTextContent('offerDefaultMessage');
  });

  it('potwierdzenie bez własnej treści wysyła message=undefined i stały klucz idempotencji', async () => {
    sendOffer.mockResolvedValue({ ok: false, error: 'INTERNAL' });
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /^sendOfferTo/ }));
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

  it('za krótka własna wiadomość: błąd przy polu, brak wysyłki', () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /^sendOfferTo/ }));
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
});
