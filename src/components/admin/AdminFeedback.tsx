'use client';

import * as React from 'react';

import { useRouter } from '@/i18n/navigation';
import { ADMIN_PAGE_HEADING_FOCUS } from '@/lib/admin/focus';
import { ToastRegion } from '@/components/ui/toast';

/**
 * AdminFeedbackProvider — komunikaty i fokus po akcjach panelu admina (#415, WCAG 2.4.3).
 *
 * Toast i odświeżenie listy żyją POZA wierszem: po `router.refresh()` wiersz może zniknąć
 * (firma opuszcza filtr „Do weryfikacji”, zgłoszenie opuszcza filtr „Aktywne”) albo zmienić
 * zestaw przycisków — komunikat i fokus nie mogą być renderowane w odmontowanym komponencie.
 *
 * Po sukcesie `succeed({ message, focusKey })`:
 *   1. pokazuje toast na poziomie strony,
 *   2. odświeża dane (`router.refresh()` w przejściu),
 *   3. po zakończeniu odświeżenia przenosi fokus na widoczny element `[data-admin-focus=focusKey]`
 *      (nagłówek zaktualizowanego wiersza), a gdy go już nie ma — na nagłówek strony
 *      (`[data-admin-focus="page-heading"]`). Fokus nigdy nie spada na `<body>`.
 */



type ToastState = { tone: 'success' | 'error'; message: string; id: number };

interface AdminFeedbackValue {
  /**
   * Zakończona akcja: toast + odświeżenie + fokus na `focusKey` (albo nagłówek strony).
   * `tone: 'error'` — np. nieaktualny widok (`STALE_STATE`): dane i tak trzeba odświeżyć.
   */
  succeed: (input: { message: string; focusKey: string; tone?: 'success' | 'error' }) => void;
  /** Błąd: sam toast (fokus zostaje tam, gdzie był — np. w otwartym dialogu). */
  fail: (message: string) => void;
}

const AdminFeedbackContext = React.createContext<AdminFeedbackValue | null>(null);

/** Pierwszy WIDOCZNY element o danym kluczu (wiersz tabeli i karta mobilna mają ten sam klucz). */
function findVisible(key: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(
    `[data-admin-focus="${CSS.escape(key)}"]`,
  );
  for (const node of nodes) {
    if (node.getClientRects().length > 0) return node;
  }
  return null;
}

/** Przenosi fokus na cel albo nagłówek strony. Zwraca element, który dostał fokus. */
export function focusAdminTarget(key: string): HTMLElement | null {
  const target = findVisible(key) ?? findVisible(ADMIN_PAGE_HEADING_FOCUS);
  target?.focus();
  return target;
}

export function AdminFeedbackProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const router = useRouter();
  const [refreshing, startRefresh] = React.useTransition();
  const [toast, setToast] = React.useState<ToastState | null>(null);
  const [focusRequest, setFocusRequest] = React.useState<{ key: string; id: number } | null>(
    null,
  );
  const seq = React.useRef(0);

  // Fokus dopiero po zakończeniu odświeżenia — wtedy DOM odpowiada nowym danym.
  React.useEffect(() => {
    if (refreshing || !focusRequest) return;
    focusAdminTarget(focusRequest.key);
    setFocusRequest(null);
  }, [refreshing, focusRequest]);

  const value = React.useMemo<AdminFeedbackValue>(
    () => ({
      succeed: ({ message, focusKey, tone = 'success' }) => {
        seq.current += 1;
        setToast({ tone, message, id: seq.current });
        setFocusRequest({ key: focusKey, id: seq.current });
        startRefresh(() => router.refresh());
      },
      fail: (message) => {
        seq.current += 1;
        setToast({ tone: 'error', message, id: seq.current });
      },
    }),
    [router],
  );

  return (
    <AdminFeedbackContext.Provider value={value}>
      {children}
      <ToastRegion
        toast={toast}
        onClose={() => setToast(null)}
        className="bottom-20 z-[80] lg:bottom-4"
      />
    </AdminFeedbackContext.Provider>
  );
}

/** Dostęp do komunikatów panelu admina (tylko wewnątrz `AdminFeedbackProvider` — `AdminShell`). */
export function useAdminFeedback(): AdminFeedbackValue {
  const ctx = React.useContext(AdminFeedbackContext);
  if (!ctx) throw new Error('useAdminFeedback: brak AdminFeedbackProvider');
  return ctx;
}
