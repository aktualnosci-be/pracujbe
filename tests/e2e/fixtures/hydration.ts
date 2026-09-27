import { expect, type Locator } from '@playwright/test';

/**
 * Czeka, aż React zhydratuje element: po hydratacji węzeł DOM dostaje właściwość
 * `__reactProps$<id>` (z handlerami zdarzeń). Wpis do pola przed hydratacją ginie —
 * React przywraca wartość z serwera, a `onChange` nie dociera do formularza. Pod obciążeniem
 * (równoległe workery) okno przed hydratacją jest dłuższe, więc test bez tego czekania
 * jest niestabilny.
 */
export async function waitForHydrated(locator: Locator): Promise<void> {
  await expect
    .poll(
      () => locator.evaluate((el) => Object.keys(el).some((key) => key.startsWith('__reactProps$'))),
      { message: 'element zhydratowany przez React' },
    )
    .toBe(true);
}
