'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
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
 *
 * #403: link „Dodaj kolejną firmę” (`/employer/firma/nowa`) — pod znakiem firmy i na końcu
 * listy firm; bez niego użytkownik z jedną firmą nigdy nie zobaczyłby przełącznika.
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

/** `.people .side-person strong` — 14 px / 700, margines 12/4 px; `span` — 12 px, muted. */
const SIDE_PERSON_NAME = 'mb-1 mt-3 block break-words text-sm font-bold text-foreground';
const SIDE_PERSON_ROLE = 'block break-words text-xs text-muted-foreground';

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
  const tt = useTranslations('team');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [failed, setFailed] = useState(false);

  const name = activeName || td('employerRole');
  const initials = initialsOf(name);

  const badge = (
    <span
      className="flex size-12 shrink-0 items-center justify-center rounded-[14px] border border-border bg-card text-[15px] font-extrabold tracking-[-0.04em] text-foreground"
      aria-hidden="true"
    >
      {initials}
    </span>
  );

  // Jedna firma (lub brak listy) → statyczny znak, bez przełącznika.
  const addCompany = (
    <Link
      href="/employer/firma/nowa"
      className="flex min-h-11 w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[13px] font-bold text-primary transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Plus className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 break-words">{tt('addCompany')}</span>
    </Link>
  );

  if (companies.length <= 1) {
    return (
      <div className="w-full">
        <div className="w-full">
          {badge}
          <span className="block min-w-0">
            <span className={SIDE_PERSON_NAME}>{name}</span>
            <span className={SIDE_PERSON_ROLE}>{td('employerRole')}</span>
          </span>
        </div>
        <div className="mt-1">{addCompany}</div>
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
          className="block w-full cursor-pointer list-none rounded-[10px] text-left transition-colors hover:bg-muted [&::-webkit-details-marker]:hidden"
        >
          <span className="flex items-start justify-between gap-2">
            {badge}
            <ChevronDown className="mt-4 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </span>
          <span className="block min-w-0">
            <span className="sr-only">{td('switchCompany')}: </span>
            <span className={SIDE_PERSON_NAME}>{name}</span>
            <span className={SIDE_PERSON_ROLE}>{td('employerRole')}</span>
          </span>
        </summary>

        <div className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-[14px] border border-border bg-card py-1 shadow-lg">
          {companies.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={pending}
              aria-current={c.id === activeId ? 'true' : undefined}
              onClick={() => choose(c.id)}
              className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-soft disabled:opacity-60"
            >
              <span className="min-w-0 flex-1 break-words">{c.name}</span>
              {c.id === activeId ? (
                <Check className="size-4 shrink-0 text-accent" aria-hidden="true" />
              ) : null}
            </button>
          ))}
          <div className="mt-1 border-t border-border pt-1">{addCompany}</div>
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
