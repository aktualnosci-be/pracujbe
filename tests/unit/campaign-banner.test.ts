import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BANNER_FORMATS,
  BANNER_PALETTE,
  BannerInputError,
  bannerJobUrl,
  renderCampaignBanner,
  type BannerTexts,
} from '@/lib/campaign-banner/render';
import { FONT_SHA256 } from '@/lib/campaign-banner/metrics.generated';
import { cleanBannerText, fitText, measureText, truncateText } from '@/lib/campaign-banner/text';
import { toCampaignJob } from '@/lib/campaign-banner/source';

/**
 * Baner kampanii z oferty (#175): tokeny marki, pomiar tekstu, escaping, brak PII i brak
 * treści aktywnej. Pomiar w prawdziwym Chromium: tests/unit/campaign-banner-chromium.test.ts.
 */

const ROOT = process.cwd();

const JOB = {
  slug: 'operator-wozka-widlowego-antwerpia',
  title: 'Operator wózka widłowego',
  companyName: 'Logistyka Noord NV',
  city: 'Antwerpia',
};

const TEXTS: BannerTexts = {
  eyebrow: 'Oferta pracy w Belgii',
  cta: 'Aplikuj teraz',
  salary: '17–20 € brutto / godz.',
  conditions: 'Umowa na stałe · Z zakwaterowaniem',
  accessibleName: 'Pracuj.be — oferta pracy: Operator wózka widłowego',
};

function render(format: (typeof BANNER_FORMATS)[number], job = JOB, texts = TEXTS) {
  return renderCampaignBanner({ format, locale: 'pl', job, texts });
}

function textNodes(svg: string): string[] {
  return Array.from(svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g), (m) => m[1] ?? '');
}

describe('baner kampanii — identyfikacja marki', () => {
  it('kolory to tokeny --pp-* z globals.css (bez własnych hexów)', () => {
    const css = readFileSync(resolve(ROOT, 'src/app/globals.css'), 'utf8');
    for (const [token, value] of Object.entries(BANNER_PALETTE)) {
      const match = new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
      expect(match?.[1]?.toLowerCase(), token).toBe(value);
    }
    for (const format of BANNER_FORMATS) {
      const colors = new Set(Array.from(render(format).matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/g), (m) => m[1]));
      expect([...colors].every((c) => Object.values(BANNER_PALETTE).includes(c as never)), format).toBe(true);
    }
  });

  it('tablica szerokości odpowiada osadzanemu plikowi fontu', () => {
    const font = readFileSync(resolve(ROOT, 'src/app/fonts/DMSans-latin.woff2'));
    expect(createHash('sha256').update(font).digest('hex')).toBe(FONT_SHA256);
  });

  it('każdy format ma rozmiar, znak pracuj/.be i przycisk do oferty w pracuj.be', () => {
    for (const format of BANNER_FORMATS) {
      const [w, h] = format.split('x');
      const svg = render(format);
      expect(svg).toContain(`width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"`);
      expect(textNodes(svg)).toEqual(expect.arrayContaining(['pracuj', '.be', 'Aplikuj teraz →']));
      const hrefs = Array.from(svg.matchAll(/href="([^"]*)"/g), (m) => m[1]);
      expect(hrefs).toEqual([`https://pracuj.be/pl/oferty-pracy/${JOB.slug}`]);
    }
  });
});

describe('baner kampanii — bezpieczeństwo treści', () => {
  const hostile = {
    ...JOB,
    title: 'Magazynier <script>alert(1)</script> & "Co" ‮gnp.exe',
    companyName: 'Firma" onload="alert(1)',
  };

  it('escapuje tekst i usuwa znaki sterujące; brak skryptów, zdarzeń i zasobów zewnętrznych', () => {
    for (const format of BANNER_FORMATS) {
      const svg = render(format, hostile, { ...TEXTS, accessibleName: '<b>x</b>' });
      const tags = new Set(Array.from(svg.matchAll(/<\/?([a-zA-Z]+)/g), (m) => m[1]));
      expect([...tags].sort()).toEqual(['a', 'g', 'line', 'rect', 'svg', 'text', 'title'].filter((t) => format === '1200x300' || t !== 'line'));
      expect(svg).not.toMatch(/\son\w+="|javascript:|xlink:href/i);
      expect(svg).not.toContain('‮');
      expect(svg).toContain('&lt;b&gt;x&lt;/b&gt;');
      // Poza jedynym odnośnikiem nie ma adresów (font jest osadzony jako data:).
      expect(svg.replace(/href="https:\/\/pracuj\.be\/pl\/oferty-pracy\/[a-z0-9-]+"/, '')).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
    }
    // Kontrola ujemna: surowy tekst wstawiony bez escapingu dałby znacznik <script>.
    expect(`<text>${hostile.title}</text>`).toMatch(/<script/);
  });

  it('odrzuca niebezpieczny adres i brakujące pola zamiast rysować coś zastępczego', () => {
    expect(() => bannerJobUrl('javascript:alert(1)', 'pl')).toThrow(BannerInputError);
    expect(() => bannerJobUrl('../admin', 'pl')).toThrow(BannerInputError);
    expect(() => bannerJobUrl(JOB.slug, 'de')).toThrow(BannerInputError);
    expect(() => render('1200x300', { ...JOB, title: ' \u0000 ' })).toThrow(BannerInputError);
    expect(() => render('1200x300', { ...JOB, companyName: '' })).toThrow(BannerInputError);
    expect(() => renderCampaignBanner({ format: 'x' as never, locale: 'pl', job: JOB, texts: TEXTS })).toThrow(BannerInputError);
  });

  it('bez PII: z wiersza bazy trafiają tylko pola grafiki, nawet gdy przyszłyby dodatkowe', () => {
    const row = {
      slug: JOB.slug,
      title: JOB.title,
      company_name: JOB.companyName,
      city: JOB.city,
      contract_type: 'permanent',
      accommodation: true,
      salary_min: 17,
      salary_max: 20,
      currency: 'EUR',
      salary_period: 'hour',
      id: '5c3a1f0e-0000-4000-8000-000000000001',
      email: 'hr@firma.be',
      phone: '+32 470 12 34 56',
      recruiter_name: 'Jan Kowalski',
      is_demo: false,
    };
    const job = toCampaignJob(row);
    expect(job).toEqual({
      slug: JOB.slug,
      title: JOB.title,
      companyName: JOB.companyName,
      city: JOB.city,
      contractType: 'permanent',
      accommodation: true,
      salaryMin: 17,
      salaryMax: 20,
      currency: 'EUR',
      salaryPeriod: 'hour',
    });
    const svg = render('300x600', job!);
    expect(svg).not.toMatch(/hr@firma|\+32|Kowalski|5c3a1f0e|is_demo/);
    expect(toCampaignJob({ ...row, title: '' })).toBeNull();
    expect(toCampaignJob(null)).toBeNull();
  });
});

describe('baner kampanii — układ tekstu', () => {
  it('stawka pojawia się tylko, gdy oferta ją ma', () => {
    const withSalary = textNodes(render('1200x300'));
    const without = textNodes(render('1200x300', JOB, { ...TEXTS, salary: null }));
    expect(withSalary).toContain('17–20 € brutto / godz.');
    expect(without.join(' ')).not.toMatch(/€/);
    expect(without).toContain('Antwerpia');
  });

  it('długi tytuł mieści się w dozwolonych liniach, a nadmiar kończy „…”', () => {
    const long = { ...JOB, title: 'Operator wózka widłowego wysokiego składowania '.repeat(6).trim() };
    const svg = render('1200x300', long);
    const titleLines = Array.from(svg.matchAll(/<text x="42" y="[\d.]+" font-size="(\d+)" font-weight="700" fill="#151515">([^<]*)<\/text>/g));
    expect(titleLines.length).toBe(2);
    for (const [, size, line] of titleLines) {
      expect(measureText(line!, Number(size), 700)).toBeLessThanOrEqual(690);
    }
    expect(titleLines.at(-1)?.[2]).toMatch(/…$/);
  });

  it('krótki tytuł zostaje w największym kroju; wyraz dłuższy od linii jest skracany', () => {
    expect(fitText('Kucharz', [46, 40, 34], 700, 690, 2)).toEqual({ size: 46, lines: ['Kucharz'] });
    const word = 'Ż'.repeat(80);
    const { lines } = fitText(word, [30, 26, 22], 700, 256, 2);
    expect(lines).toHaveLength(1);
    expect(measureText(lines[0]!, 22, 700)).toBeLessThanOrEqual(256);
    expect(truncateText('abc', 16, 700, 1)).toBe('');
  });

  it('znak spoza fontu liczony ostrożnie (szerzej niż litera łacińska)', () => {
    expect(measureText('字', 20, 700)).toBeGreaterThan(measureText('W', 20, 700));
    expect(cleanBannerText('  a\u0007b\nc  ')).toBe('a b c');
  });
});
