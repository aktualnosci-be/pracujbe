import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthForm } from '@/components/auth/AuthForm';
import { requestPasswordReset } from '@/lib/actions/auth';
import en from '@/messages/en.json';

/**
 * Formularz z Turnstile (#46): bez klucza witryny nic się nie zmienia; z kluczem wysyłka bez
 * tokenu pokazuje komunikat (przycisk nie jest martwy), a nieudane ładowanie skryptu daje
 * komunikat i przycisk ponownego ładowania. Skrypt Cloudflare nigdy nie jest pobierany.
 */

vi.mock('@/lib/actions/auth', () => ({
  requestPasswordReset: vi.fn(),
  signIn: vi.fn(),
  registerCandidate: vi.fn(),
  registerEmployer: vi.fn(),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Omit<React.ComponentProps<'a'>, 'href'> & { href: string }) => (
    <a {...props} href={href}>
      {children}
    </a>
  ),
}));

Element.prototype.scrollIntoView ??= function scrollIntoView() {};

const reset = vi.mocked(requestPasswordReset);

function renderReset() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <AuthForm variant="reset" />
    </NextIntlClientProvider>,
  );
}

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText(en.auth.email), { target: { value: 'jan@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: en.auth.resetSubmit }));
}

beforeEach(() => {
  reset.mockReset().mockResolvedValue({ ok: true });
  document.getElementById('cf-turnstile-script')?.remove();
  delete window.turnstile;
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('bez klucza witryny (demo/E2E)', () => {
  it('nie ładuje skryptu i wysyła formularz bez tokenu', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
    renderReset();
    expect(screen.queryByRole('group', { name: en.auth.botCheckLabel })).toBeNull();
    fillAndSubmit();
    await waitFor(() => expect(reset).toHaveBeenCalledWith({ email: 'jan@example.com' }, null));
    expect(document.getElementById('cf-turnstile-script')).toBeNull();
  });
});

describe('z kluczem witryny', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key'));

  it('wysyłka bez tokenu: komunikat przy widżecie, akcja niewywołana, przycisk aktywny', async () => {
    renderReset();
    fillAndSubmit();
    expect(await screen.findByText(en.auth.botCheckRequired)).toBeInTheDocument();
    expect(reset).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: en.auth.resetSubmit })).toBeEnabled();
  });

  it('nieudane ładowanie skryptu: komunikat i ponowne ładowanie', async () => {
    renderReset();
    const script = document.getElementById('cf-turnstile-script') as HTMLScriptElement;
    expect(script.src).toContain('https://challenges.cloudflare.com/turnstile/v0/api.js');
    act(() => {
      script.dispatchEvent(new Event('error'));
    });
    expect(await screen.findByText(en.auth.botCheckLoadFailed)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.auth.botCheckRetry }));
    await waitFor(() => expect(document.getElementById('cf-turnstile-script')).not.toBeNull());
  });

  it('kontrola ujemna: z tokenem akcja dostaje token, po błędzie widżet jest resetowany', async () => {
    const api = {
      render: vi.fn((_el: HTMLElement, opts: { action: string; callback?: (t: string) => void }) => {
        queueMicrotask(() => opts.callback?.('token-123'));
        return 'w1';
      }),
      reset: vi.fn(),
      remove: vi.fn(),
    };
    window.turnstile = api;
    reset.mockResolvedValue({ ok: false, error: 'BOT_CHECK_FAILED' });
    renderReset();
    await waitFor(() => expect(api.render).toHaveBeenCalled());
    expect(api.render.mock.calls[0]?.[1].action).toBe('password_reset');
    await act(async () => {
      await Promise.resolve();
    });
    fillAndSubmit();
    await waitFor(() =>
      expect(reset).toHaveBeenCalledWith({ email: 'jan@example.com' }, 'token-123'),
    );
    expect(await screen.findByText(en.errors.botCheckFailed)).toBeInTheDocument();
    expect(api.reset).toHaveBeenCalledWith('w1');
  });
});
