'use client';

import * as React from 'react';

/**
 * Wspólny, potwierdzony przez serwer status pełnoletności kandydata na stronie ustawień (#828).
 *
 * Sekcja „Wiek” (`AgeAttestationSettings`) i sekcja widoczności profilu
 * (`ProfileVisibilitySettings`) dostają ten sam stan z jednego odczytu strony. Po UDANYM
 * zapisie deklaracji sekcja wieku zgłasza nowy przedział tutaj, więc przełącznik widoczności
 * odblokowuje się bez przeładowania strony. Sam zapis wieku NIE zmienia wyszukiwalności —
 * włączenie pozostaje osobną decyzją kandydata, a bazą rządzi `candidate_is_adult` (0126).
 *
 * `undefined` = status nieznany (brak deklaracji albo błąd odczytu) — bez blokady w UI.
 */
type AgeStatus = {
  adult: boolean | undefined;
  reportConfirmedAge: (adult: boolean) => void;
};

const AgeStatusContext = React.createContext<AgeStatus | null>(null);

export function AgeStatusProvider({
  initialAdult,
  children,
}: {
  initialAdult: boolean | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const [adult, setAdult] = React.useState<boolean | undefined>(initialAdult);
  const value = React.useMemo<AgeStatus>(() => ({ adult, reportConfirmedAge: setAdult }), [adult]);
  return <AgeStatusContext.Provider value={value}>{children}</AgeStatusContext.Provider>;
}

/** Status z dostawcy; poza dostawcą — wartość przekazana w propsie (dotychczasowe użycie). */
export function useConfirmedAdult(fallback: boolean | undefined): boolean | undefined {
  const context = React.useContext(AgeStatusContext);
  return context ? context.adult : fallback;
}

/** Zgłoszenie przedziału potwierdzonego przez serwer; poza dostawcą — brak efektu. */
export function useReportConfirmedAge(): (adult: boolean) => void {
  const context = React.useContext(AgeStatusContext);
  return context ? context.reportConfirmedAge : noop;
}

function noop(): void {}
