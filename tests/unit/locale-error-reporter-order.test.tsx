// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import pl from '@/messages/pl.json';

/**
 * #851: w `[locale]/layout.tsx` `{children}` się montuje PRZED `<ClientErrorReporter />`
 * (React 19 wykonuje efekty potomków przed rodzicem tego samego commitu), więc pierwszy
 * błąd klienta złapany przez `LocaleError` mógł trafić do `captureError`, zanim
 * `ClientErrorReporter` zdążył w swoim `useEffect` zainstalować reporter — `captureError`
 * bez reportera cicho nic nie robi i nie ponawia wywołania po instalacji. Ten test renderuje
 * WYŁĄCZNIE `LocaleError` (jak w layoucie: rodzeństwo reportera jeszcze nie zamontowane,
 * `setErrorReporter` nigdy nie wywołane) i sprawdza, że mimo to zgłoszenie dociera —
 * bo `LocaleError` sam instaluje reporter przed `captureError` (patrz komentarz w pliku źródłowym).
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

async function freshLocaleError() {
  // Modul `client-error/reporter` trzyma `installed`/reporter jako stan modułu — świeży
  // import na każdy test odtwarza dokładnie stan "reporter jeszcze nigdy nie zainstalowany",
  // czyli sytuację przy pierwszym błędzie na pierwszej stronie po starcie karty.
  vi.resetModules();
  const { default: LocaleError } = await import('@/app/[locale]/error');
  return LocaleError;
}

describe('LocaleError instaluje reporter przed pierwszym zgłoszeniem (#851)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('pierwszy błąd klienta (bez digest) dociera do /api/client-error mimo braku wcześniej zainstalowanego reportera', async () => {
    const LocaleError = await freshLocaleError();
    render(
      <NextIntlClientProvider locale="pl" messages={pl}>
        <LocaleError error={new Error('boom')} reset={vi.fn()} />
      </NextIntlClientProvider>,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/client-error');
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
    expect(body).toMatchObject({ code: 'INTERNAL' });
    expect(body.route).toBeTypeOf('string');
  });

  it('kontrola ujemna: błąd serwera z digest nadal jest pomijany, mimo instalacji reportera tutaj', async () => {
    const LocaleError = await freshLocaleError();
    render(
      <NextIntlClientProvider locale="pl" messages={pl}>
        <LocaleError error={Object.assign(new Error('boom'), { digest: 'abc123' })} reset={vi.fn()} />
      </NextIntlClientProvider>,
    );

    // Reporter jest zainstalowany (moduł zaimportowany i wykonany), ale `captureError`
    // pomija błędy z `digest` w przeglądarce (już zgłoszone przez `onRequestError`) —
    // ta gałąź nie powinna się zepsuć przez wywołanie instalacji tuż przed nią.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
