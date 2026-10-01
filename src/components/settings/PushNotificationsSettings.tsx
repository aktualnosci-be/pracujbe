'use client';

import * as React from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { AlertCircle, BellRing, CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PAPER } from '@/components/dashboard/panel-styles';
import { useRouter } from '@/i18n/navigation';
import { registerPushDevice, revokePushDevice, unregisterPushDevice } from '@/lib/actions/push-subscriptions';
import type { PushDevice } from '@/lib/data/push-devices';
import { APP_TIME_ZONE } from '@/lib/datetime';

/**
 * PushNotificationsSettings — powiadomienia push o alertach zapisanych wyszukiwań (#724).
 *
 * Sekcja renderuje się tylko przy włączonej funkcji (flaga + klucze VAPID, serwer). Zgoda
 * przeglądarki jest prośbą WYŁĄCZNIE po kliknięciu „Włącz na tym urządzeniu” (nigdy przy
 * wejściu na stronę). Stany: brak obsługi w przeglądarce, uprawnienie zablokowane (instrukcja,
 * bez ponownego pytania), włączone/wyłączone na tym urządzeniu oraz lista urządzeń z usuwaniem.
 * Endpoint subskrypcji nie trafia do HTML — „to urządzenie” rozpoznajemy po SHA-256 endpointu.
 * Invariant #11: jedno działanie naraz, przyciski zablokowane w trakcie, błąd `role="alert"`,
 * sukces `role="status"` z fokusem.
 */

type Support = 'checking' | 'unsupported' | 'ready';
type Pending = 'enable' | 'disable' | `device:${string}` | null;
type Notice =
  | 'enabled'
  | 'disabled'
  | 'removed'
  | 'errorGeneric'
  | 'errorDeviceLimit'
  | 'errorDenied'
  | 'errorDismissed';

const SW_READY_TIMEOUT_MS = 10_000;

export interface PushNotificationsSettingsProps {
  vapidPublicKey: string;
  devices: PushDevice[];
  loadFailed?: boolean;
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function endpointHash(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('SW_NOT_READY')), SW_READY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

export function PushNotificationsSettings({
  vapidPublicKey,
  devices,
  loadFailed = false,
}: PushNotificationsSettingsProps): React.JSX.Element {
  const t = useTranslations('pushSettings');
  const format = useFormatter();
  const router = useRouter();
  const [support, setSupport] = React.useState<Support>('checking');
  const [permission, setPermission] = React.useState<NotificationPermission>('default');
  const [currentHash, setCurrentHash] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<Pending>(null);
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const noticeRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    if (!pushSupported()) {
      setSupport('unsupported');
      return;
    }
    setPermission(Notification.permission);
    void (async () => {
      try {
        const subscription = await currentSubscription();
        const hash = subscription ? await endpointHash(subscription.endpoint) : null;
        if (!cancelled) setCurrentHash(hash);
      } catch {
        // Brak dostępu do subskrypcji = traktujemy jak wyłączone na tym urządzeniu.
      } finally {
        if (!cancelled) setSupport('ready');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const subscribedHere = currentHash !== null && devices.some((d) => d.endpointHash === currentHash);

  const enable = async (): Promise<void> => {
    if (pending) return;
    setPending('enable');
    setNotice(null);
    try {
      // Prośba o zgodę wyłącznie po działaniu użytkownika (to kliknięcie).
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') {
        setNotice(result === 'denied' ? 'errorDenied' : 'errorDismissed');
        return;
      }
      const registration = await readyRegistration();
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(vapidPublicKey),
        }));
      const json = subscription.toJSON();
      const saved = await registerPushDevice({
        endpoint: subscription.endpoint,
        keys: { p256dh: json.keys?.['p256dh'] ?? '', auth: json.keys?.['auth'] ?? '' },
      });
      if (!saved.ok) {
        // Bez zapisu w portalu subskrypcja przeglądarki nie ma sensu — wycofujemy ją.
        await subscription.unsubscribe().catch(() => undefined);
        setCurrentHash(null);
        setNotice(saved.reason === 'deviceLimit' ? 'errorDeviceLimit' : 'errorGeneric');
        return;
      }
      setCurrentHash(await endpointHash(subscription.endpoint));
      setNotice('enabled');
      router.refresh();
    } catch {
      setNotice('errorGeneric');
    } finally {
      setPending(null);
    }
  };

  const disable = async (): Promise<void> => {
    if (pending) return;
    setPending('disable');
    setNotice(null);
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        const result = await unregisterPushDevice({ endpoint: subscription.endpoint });
        if (!result.ok) {
          setNotice('errorGeneric');
          return;
        }
        await subscription.unsubscribe().catch(() => undefined);
      }
      setCurrentHash(null);
      setNotice('disabled');
      router.refresh();
    } catch {
      setNotice('errorGeneric');
    } finally {
      setPending(null);
    }
  };

  const removeDevice = async (device: PushDevice): Promise<void> => {
    if (pending) return;
    setPending(`device:${device.id}`);
    setNotice(null);
    try {
      const result = await revokePushDevice({ id: device.id });
      if (!result.ok) {
        setNotice('errorGeneric');
        return;
      }
      if (device.endpointHash === currentHash) {
        const subscription = await currentSubscription().catch(() => null);
        await subscription?.unsubscribe().catch(() => undefined);
        setCurrentHash(null);
      }
      setNotice('removed');
      router.refresh();
    } catch {
      setNotice('errorGeneric');
    } finally {
      setPending(null);
    }
  };

  const formatDate = (value: string | null): string | null => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? null
      : format.dateTime(date, { dateStyle: 'long', timeZone: APP_TIME_ZONE });
  };

  const isError = notice !== null && notice.startsWith('error');

  return (
    <section aria-labelledby="push-settings-title" className={PAPER}>
      <h2
        id="push-settings-title"
        className="flex items-center gap-2 text-[23px] font-bold leading-[1.3] tracking-[-0.025em] text-foreground"
      >
        <BellRing className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        {t('sectionTitle')}
      </h2>
      <p className="mt-1 text-[15px] leading-[1.7] text-muted-foreground">{t('intro')}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t('inAppNote')}</p>

      {support === 'unsupported' ? (
        <p className="mt-4 text-sm text-foreground">{t('unsupported')}</p>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-sm text-foreground" data-push-state={subscribedHere ? 'on' : 'off'}>
            {subscribedHere ? t('statusOn') : t('statusOff')}
          </p>
          {subscribedHere ? (
            <Button
              type="button"
              variant="outline"
              disabled={support !== 'ready' || pending !== null}
              aria-busy={pending === 'disable' || undefined}
              onClick={() => void disable()}
            >
              {pending === 'disable' ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {pending === 'disable' ? t('disabling') : t('disable')}
            </Button>
          ) : permission === 'denied' ? null : (
            <Button
              type="button"
              disabled={support !== 'ready' || pending !== null}
              aria-busy={pending === 'enable' || undefined}
              onClick={() => void enable()}
            >
              {pending === 'enable' ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {pending === 'enable' ? t('enabling') : t('enable')}
            </Button>
          )}
        </div>
      )}
      {support === 'ready' && permission === 'denied' && !subscribedHere ? (
        <p className="mt-2 text-sm text-foreground">{t('denied')}</p>
      ) : null}

      <div aria-live="polite">
        {notice ? (
          <div
            ref={noticeRef}
            tabIndex={-1}
            role={isError ? 'alert' : 'status'}
            className={
              isError
                ? 'mt-4 flex items-start gap-3 rounded-md border border-error/30 bg-error/10 p-3 text-sm text-error-text focus:outline-none'
                : 'mt-4 flex items-start gap-3 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success-text focus:outline-none'
            }
          >
            {isError ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <p>{t(notice)}</p>
          </div>
        ) : null}
      </div>

      <h3 className="mt-6 text-base font-semibold text-foreground">{t('devicesTitle')}</h3>
      {loadFailed ? (
        <p role="alert" className="mt-2 text-sm text-error-text">
          {t('loadError')}
        </p>
      ) : devices.length === 0 ? (
        <p className="mt-2 text-sm text-foreground">{t('devicesEmpty')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {devices.map((device) => {
            const name = device.label ?? t('deviceUnknown');
            const added = formatDate(device.createdAt);
            const lastSent = formatDate(device.lastSuccessAt);
            const busy = pending === `device:${device.id}`;
            return (
              <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="break-words font-medium text-foreground">
                    {name}
                    {device.endpointHash === currentHash ? (
                      <span className="ml-2 text-sm font-normal text-muted-foreground">{t('thisDevice')}</span>
                    ) : null}
                  </p>
                  {added ? <p className="text-sm text-muted-foreground">{t('deviceAdded', { date: added })}</p> : null}
                  {lastSent ? (
                    <p className="text-sm text-muted-foreground">{t('deviceLastSent', { date: lastSent })}</p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  aria-label={t('removeDeviceLabel', { name })}
                  aria-busy={busy || undefined}
                  disabled={pending !== null}
                  onClick={() => void removeDevice(device)}
                >
                  {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                  {t('removeDevice')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
