import { describe, expect, it } from "vitest";

import { routing } from "@/i18n/routing";
import {
  getAllGuides,
  getAllGuideSlugs,
  getGuideBySlug,
} from "@/lib/guides/guides";

/**
 * Czas czytania musi odpowiadać treści w danym języku. Wersje nl/fr/en poradników są
 * skrócone względem PL, więc nie mogą deklarować tego samego czasu co pełna wersja.
 */

function wordsOf(slug: string, locale: string): number {
  const guide = getGuideBySlug(slug, locale);
  if (!guide) throw new Error(`brak poradnika ${slug}`);
  const texts = [
    guide.title,
    guide.excerpt,
    ...guide.body.flatMap((block) =>
      block.type === "list" ? block.items : [block.text],
    ),
  ];
  return texts.join(" ").split(/\s+/).filter(Boolean).length;
}

describe("czas czytania poradników", () => {
  const slugs = getAllGuideSlugs();

  it("krótsza wersja językowa nigdy nie deklaruje dłuższego czasu niż dłuższa", () => {
    for (const slug of slugs) {
      const entries = routing.locales.map((locale) => ({
        locale,
        words: wordsOf(slug, locale),
        minutes: getGuideBySlug(slug, locale)!.readingMinutes,
      }));
      for (const a of entries) {
        expect(a.minutes, `${slug}/${a.locale}`).toBeGreaterThanOrEqual(1);
        for (const b of entries) {
          if (a.words < b.words) {
            expect(
              a.minutes,
              `${slug}: ${a.locale} vs ${b.locale}`,
            ).toBeLessThanOrEqual(b.minutes);
          }
        }
      }
    }
  });

  it("skrócona wersja NL pokazuje mniej minut niż pełna PL", () => {
    for (const slug of slugs) {
      const pl = wordsOf(slug, "pl");
      const nl = wordsOf(slug, "nl");
      // Wymóg dotyczy tylko sytuacji, gdy NL jest wyraźnie krótsza (co najmniej o połowę).
      if (nl * 2 <= pl) {
        expect(
          getGuideBySlug(slug, "nl")!.readingMinutes,
          `${slug}: ${nl} słów NL vs ${pl} PL`,
        ).toBeLessThan(getGuideBySlug(slug, "pl")!.readingMinutes);
      }
    }
  });

  it("karta na liście i artykuł pokazują ten sam czas", () => {
    for (const locale of routing.locales) {
      for (const entry of getAllGuides(locale)) {
        expect(entry.readingMinutes, `${entry.slug}/${locale}`).toBe(
          getGuideBySlug(entry.slug, locale)!.readingMinutes,
        );
      }
    }
  });
});
