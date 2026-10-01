import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import pl from '@/messages/pl.json';
import { PushNotificationsSettings, endpointHash } from '@/components/settings/PushNotificationsSettings';
import type { PushDevice } from '@/lib/data/push-devices';

/**
 * #724 — sekcja push w ustawieniach kandydata. Zgoda przeglądarki tylko po kliknięciu
 * (nigdy przy wejściu), odmowa = komunikat bez rejestracji, zablokowane uprawnienie = instrukcja
 * bez przycisku, brak obsługi = komunikat, nieudany zapis = wycofanie subskrypcji przeglądarki,
 * „to urządzenie” rozpoznane po skrócie endpointu, usunięcie urządzenia z listy.
 */

const { refresh, register, unregister, revoke } = vi.hoisted(() => ({
  refresh: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/actions/push-subscriptions', () => ({
  registerPushDevice: register,
  unregisterPushDevice: unregister,
  revokePushDevice: revoke,
}));

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/this-device';
const VAPID = 'B' + 'A'.repeat(86);

interface FakeSub {
  endpoint: string;
  toJSON: () => { keys: Record<string, string> };
  unsubscribe: ReturnType<typeof vi.fn>;
}

let current: FakeSub | null;
let permissionState: NotificationPermission;
const requestPermission = vi.fn();
const subscribe = vi.fn();

function makeSub(): FakeSub {
  return {
    endpoint: ENDPOINT,
    toJSON: () => ({ keys: { p256dh: 'C' + 'A'.repeat(86), auth: 'R'.repeat(22) } }),
    unsubscribe: vi.fn(async () => {
      current = null;
      return true;
    }),
  };
}

function installBrowser({ supported = true }: { supported?: boolean } = {}) {
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => current),
      subscribe: subscribe.mockImplementation(async () => {
        current = makeSub();
        return current;
      }),
    },
  };
  if (!supported) {
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: undefined });
    Reflect.deleteProperty(navigator, 'serviceWorker');
    return;
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve(registration), getRegistration: vi.fn(async () => registration) },
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  const NotificationStub = Object.defineProperties(function Notification() {}, {
    permission: { get: () => permissionState },
    requestPermission: { value: requestPermission },
  });
  vi.stubGlobal('Notification', NotificationStub);
}

function renderSection(devices: PushDevice[] = []) {
  return render(
    <NextIntlClientProvider locale="pl" messages={pl} timeZone="Europe/Brussels">
      <PushNotificationsSettings vapidPublicKey={VAPID} devices={devices} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  current = null;
  permissionState = 'default';
  requestPermission.mockReset();
  subscribe.mockReset();
  register.mockReset();
  unregister.mockReset();
  revoke.mockReset();
  refresh.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('PushNotificationsSettings', () => {
  it('nie pyta o zgodę przy wejściu; po kliknięciu zgoda → subskrypcja → rejestracja', async () => {
    installBrowser();
    requestPermission.mockImplementation(async () => (permissionState = 'granted'));
    register.mockResolvedValue({ ok: true });
    renderSection();
    const button = await screen.findByRole('button', { name: pl.pushSettings.enable });
    await waitFor(() => expect(button).toBeEnabled());
    expect(requestPermission).not.toHaveBeenCalled();
    fireEvent.click(button);
    await screen.findByText(pl.pushSettings.enabled);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(register).toHaveBeenCalledWith({ endpoint: ENDPOINT, keys: { p256dh: 'C' + 'A'.repeat(86), auth: 'R'.repeat(22) } });
    expect(refresh).toHaveBeenCalled();
  });

  it('kontrola ujemna: odmowa zgody — bez subskrypcji i bez zapisu', async () => {
    installBrowser();
    requestPermission.mockImplementation(async () => (permissionState = 'denied'));
    renderSection();
    const button = await screen.findByRole('button', { name: pl.pushSettings.enable });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect((await screen.findByRole('alert')).textContent).toContain(pl.pushSettings.errorDenied);
    expect(subscribe).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: pl.pushSettings.enable })).toBeNull();
  });

  it('zablokowane uprawnienie: instrukcja, bez przycisku włączenia', async () => {
    installBrowser();
    permissionState = 'denied';
    renderSection();
    await screen.findByText(pl.pushSettings.denied);
    expect(screen.queryByRole('button', { name: pl.pushSettings.enable })).toBeNull();
  });

  it('przeglądarka bez obsługi push: komunikat, bez przycisków', async () => {
    installBrowser({ supported: false });
    renderSection();
    await screen.findByText(pl.pushSettings.unsupported);
    expect(screen.queryByRole('button', { name: pl.pushSettings.enable })).toBeNull();
  });

  it('limit urządzeń: komunikat i wycofanie subskrypcji przeglądarki', async () => {
    installBrowser();
    requestPermission.mockImplementation(async () => (permissionState = 'granted'));
    register.mockResolvedValue({ ok: false, error: 'VALIDATION_FAILED', reason: 'deviceLimit' });
    renderSection();
    const button = await screen.findByRole('button', { name: pl.pushSettings.enable });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect((await screen.findByRole('alert')).textContent).toContain(pl.pushSettings.errorDeviceLimit);
    expect(current).toBeNull();
  });

  it('to urządzenie z listy: wyłączenie wycofuje w portalu i w przeglądarce; usunięcie innego urządzenia', async () => {
    installBrowser();
    current = makeSub();
    permissionState = 'granted';
    unregister.mockResolvedValue({ ok: true });
    revoke.mockResolvedValue({ ok: true });
    const devices: PushDevice[] = [
      { id: 'dev-1', label: 'Chrome · Android', createdAt: '2026-09-30T10:00:00Z', lastSuccessAt: null, endpointHash: await endpointHash(ENDPOINT) },
      { id: 'dev-2', label: null, createdAt: '2026-09-29T10:00:00Z', lastSuccessAt: '2026-09-30T08:00:00Z', endpointHash: 'f'.repeat(64) },
    ];
    renderSection(devices);
    await screen.findByText(pl.pushSettings.statusOn);
    expect(screen.getByText(pl.pushSettings.thisDevice)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: pl.pushSettings.removeDeviceLabel.replace('{name}', pl.pushSettings.deviceUnknown) }));
    await screen.findByText(pl.pushSettings.removed);
    expect(revoke).toHaveBeenCalledWith({ id: 'dev-2' });
    expect(current).not.toBeNull(); // inne urządzenie — subskrypcja tej przeglądarki zostaje
    fireEvent.click(screen.getByRole('button', { name: pl.pushSettings.disable }));
    await screen.findByText(pl.pushSettings.disabled);
    expect(unregister).toHaveBeenCalledWith({ endpoint: ENDPOINT });
    expect(current).toBeNull();
  });
});
