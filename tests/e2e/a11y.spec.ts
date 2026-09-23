import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Testy dostępności (a11y) — audyt QA-01.
 *
 * Uruchamiają silnik axe-core na kluczowych stronach publicznych (dane demonstracyjne,
 * bez Supabase) i BLOKUJĄ CI przy naruszeniach WCAG 2.x poziomu A/AA o wadze
 * `critical` lub `serious`. Naruszenia `moderate`/`minor` są raportowane w logu, ale
 * nie blokują bramki (świadoma decyzja — priorytetyzujemy realne bariery dostępu).
 *
 * Kontekst: paleta i komponenty projektowane pod WCAG 2.2 AA (patrz CLAUDE.md §2),
 * ten test jest regresyjną strażą, a nie jednorazowym audytem.
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING = new Set(['critical', 'serious']);

/** Uruchamia axe na aktualnej stronie i zwraca naruszenia pogrupowane wg wagi. */
async function analyze(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page })
    .options({ rules: { 'target-size': { enabled: true } } })
    .withTags(WCAG_TAGS)
    .analyze();
  const blocking = results.violations.filter((v) => BLOCKING.has(v.impact ?? ''));
  const advisory = results.violations.filter((v) => !BLOCKING.has(v.impact ?? ''));
  const targetSize = results.violations.filter((v) => v.id === 'target-size');
  return { blocking, advisory, targetSize };
}

/** Czytelny opis naruszeń do komunikatu asercji (bez zrzutów technicznych do UI). */
function describe(violations: Awaited<ReturnType<typeof analyze>>['blocking']): string {
  return violations
    .map(
      (v) =>
        `- [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length}×)\n    ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join('\n    ')}`,
    )
    .join('\n');
}

const PAGES: Array<{ name: string; path: string }> = [
  { name: 'strona główna', path: '/pl' },
  { name: 'lista ofert', path: '/pl/oferty-pracy' },
  { name: 'logowanie', path: '/pl/logowanie' },
  { name: 'rejestracja', path: '/pl/rejestracja' },
];

for (const p of PAGES) {
  test(`a11y: ${p.name} (${p.path}) — brak naruszeń critical/serious`, async ({ page }) => {
    await page.goto(p.path);
    // Poczekaj na landmark `main` (obecny na wszystkich stronach) + krótki bufor na hydrację
    // treści montowanej po stronie klienta (baner cookies itp.). `networkidle` bywa flaky
    // w Next.js (prefetch/otwarte połączenia), a treść do analizy kontrastu jest już w SSR.
    await page.getByRole('main').first().waitFor();
    await page.waitForTimeout(1000);

    const { blocking, advisory, targetSize } = await analyze(page);
    if (advisory.length > 0) {
      // Raport pomocniczy — nie blokuje bramki.
      console.log(`[a11y advisory] ${p.path}:\n${describe(advisory)}`);
    }
    expect(blocking, `Naruszenia a11y (critical/serious) na ${p.path}:\n${describe(blocking)}`).toEqual(
      [],
    );
    if (p.path === '/pl/oferty-pracy') {
      expect(targetSize, `Cele dotykowe WCAG 2.2 AA na ${p.path}:\n${describe(targetSize)}`).toEqual([]);
    }
  });
}

for (const locale of ['pl', 'nl', 'fr', 'en']) {
  test(`a11y: lista ofert, ekran 320 px (${locale}) — brak naruszeń critical/serious i target-size`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/oferty-pracy`);
    await page.getByRole('main').first().waitFor();
    await page.waitForTimeout(1000);

    const { blocking, advisory, targetSize } = await analyze(page);
    if (advisory.length > 0) {
      console.log(`[a11y advisory] /${locale}/oferty-pracy (320 px):\n${describe(advisory)}`);
    }
    expect(
      blocking,
      `Naruszenia a11y (critical/serious) na /${locale}/oferty-pracy przy 320 px:\n${describe(blocking)}`,
    ).toEqual([]);
    expect(
      targetSize,
      `Cele dotykowe WCAG 2.2 AA na /${locale}/oferty-pracy przy 320 px:\n${describe(targetSize)}`,
    ).toEqual([]);
  });
}

/**
 * WCAG 2.4.11 (#208): przy cofaniu fokusu (Shift+Tab) przeglądarka przewija element do górnej
 * krawędzi okna — nie może on wtedy zniknąć w całości pod przyklejonym nagłówkiem.
 */
for (const viewport of [
  { width: 1280, height: 800 },
  { width: 320, height: 640 },
]) {
  test(`a11y: Shift+Tab nie chowa fokusu pod nagłówkiem (${viewport.width} px)`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('/pl/oferty-pracy?category=construction,transport,warehouse,production');
    const banner = page.locator('[aria-labelledby="cookie-banner-title"]');
    await banner.getByRole('button').first().click();
    await expect(banner).toHaveCount(0);

    await page.locator('footer a').last().focus();
    const hidden: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Shift+Tab');
      const stop = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        const header = document.querySelector('header');
        if (!el || el === document.body || !header || header.contains(el)) return null;
        // Elementy `position: fixed` (np. odnośnik „Przejdź do treści”) leżą nad nagłówkiem.
        if (getComputedStyle(el).position === 'fixed') return null;
        const rect = el.getBoundingClientRect();
        return {
          label: (el.textContent || el.getAttribute('aria-label') || el.tagName)
            .trim()
            .slice(0, 40),
          fullyHidden: rect.bottom <= header.getBoundingClientRect().bottom,
        };
      });
      if (stop?.fullyHidden) hidden.push(stop.label);
    }
    expect(hidden, 'elementy z fokusem w całości pod nagłówkiem').toEqual([]);
  });
}
