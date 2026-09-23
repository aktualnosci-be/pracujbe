'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { setActiveCompany } from '@/lib/actions/company';

/**
 * CompanySwitcher (FUN-07) — realny przełącznik aktywnej firmy w nagłówku sidebara pracodawcy.
 *
 * Zastępuje atrapę: przy >1 firmie renderuje rozwijaną listę członkostw; wybór woła
 * `setActiveCompany` (walidacja członkostwa + zapis cookie po stronie serwera), a następnie
 * odświeża panel. Przy jednej firmie pokazuje statyczny znak firmy (bez rozwijania).
 *
 * Dostępność (#322): nazwa dostępna przełącznika zawiera widoczną nazwę firmy (WCAG 2.5.3),
 * aktywna pozycja ma `aria-current`, w trakcie zmiany jest ogłaszany stan, a odrzucona zmiana
 * (`{ ok: false }`) daje komunikat błędu bez odświeżania. Fokus wraca na przełącznik.
 */

export interface CompanySwitcherCompany {
  id: string;
  name: string;
  role: string;
}

function initialsOf(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((p) => p.charAt(0).toUpperCase())
    .join('');
  return letters || '•';
}

export function CompanySwitcher({
  companies,
  activeId,
  activeName,
}: {
  companies: CompanySwitcherCompany[];
  activeId: string | null;
  activeName: string;
}): React.JSX.Element {
  const td = useTranslations('dashboard');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [failed, setFailed] = useState(false);

  const name = activeName || td('employerRole');
  const initials = initialsOf(name);

  const badge = (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-md bg-soft text-xs font-semibold text-foreground"
      aria-hidden="true"
    >
      {initials}
    </span>
  );

  // Jedna firma (lub brak listy) → statyczny znak, bez przełącznika.
  if (companies.length <= 1) {
    return (
      <div className="flex w-full items-center gap-2.5 rounded-md p-1">
        {badge}
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-sm font-semibold text-foreground">{name}</span>
          <span className="block truncate text-xs text-muted-foreground">{td('employerRole')}</span>
        </span>
      </div>
    );
  }

  function close(): void {
    if (detailsRef.current) detailsRef.current.open = false;
    // Zamknięcie programowe zabiera fokus z listy — wracamy na przełącznik, nie na `body`.
    summaryRef.current?.focus();
  }

  function choose(id: string): void {
    setFailed(false);
    if (id === activeId) {
      close();
      return;
    }
    startTransition(async () => {
      let ok = false;
      try {
        ok = (await setActiveCompany(id))?.ok === true;
      } catch {
        ok = false;
      }
      close();
      if (!ok) {
        setFailed(true);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="w-full">
      <details ref={detailsRef} className="relative w-full">
        <summary
          ref={summaryRef}
          aria-busy={pending || undefined}
          className="flex w-full cursor-pointer list-none items-center gap-2.5 rounded-md p-1 text-left transition-colors hover:bg-soft [&::-webkit-details-marker]:hidden"
        >
          {badge}
          <span className="min-w-0 flex-1 leading-tight">
            <span className="sr-only">{td('switchCompany')}: </span>
            <span className="block truncate text-sm font-semibold text-foreground">{name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {td('employerRole')}
            </span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </summary>

        <div className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-md border border-border bg-background py-1 shadow-lg">
          {companies.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={pending}
              aria-current={c.id === activeId ? 'true' : undefined}
              onClick={() => choose(c.id)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-soft disabled:opacity-60"
            >
              <span className="flex-1 truncate">{c.name}</span>
              {c.id === activeId ? (
                <Check className="size-4 shrink-0 text-accent" aria-hidden="true" />
              ) : null}
            </button>
          ))}
        </div>
      </details>
      {/* Poza <details>: zamknięta lista ukrywa swoją treść, a komunikat musi być widoczny. */}
      <p role="status" aria-live="polite" className="sr-only">
        {pending ? td('switchCompanyPending') : ''}
      </p>
      {failed ? (
        <p role="alert" className="mt-1 px-1 text-xs text-error-text">
          {td('switchCompanyError')}
        </p>
      ) : null}
    </div>
  );
}
