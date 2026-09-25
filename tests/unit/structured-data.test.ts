import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { JobDetail } from '@/lib/jobs';
import { getGuideBySlug } from '@/lib/guides/guides';
import {
  brandShareImageUrl,
  buildArticleJsonLd,
  buildJobPostingJsonLd,
  publicHttpsUrl,
  serializeJsonLd,
  type JobPostingLabels,
} from '@/lib/seo/structured-data';
import plMessages from '@/messages/pl.json';

const BASE = 'https://pracuj.be';
const labels: JobPostingLabels = {
  responsibilities: plMessages.job.responsibilities,
  requirementsMandatory: plMessages.job.requirementsMandatory,
  requirementsOptional: plMessages.job.requirementsOptional,
  conditions: plMessages.job.conditions,
  workingHours: plMessages.job.workingHours,
  shifts: plMessages.job.shifts,
};

function job(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    slug: 'murarz',
    title: 'Murarz',
    companyName: 'Bouw & Co',
    companyVerified: true,
    city: 'Brussel',
    region: 'Brussels',
    contractType: 'permanent',
    currency: 'EUR',
    publishedAt: '2026-09-01T08:00:00.000Z',
    isNew: false,
    highlights: [],
    category: 'construction',
    accommodation: false,
    immediate: false,
    noLanguageRequired: false,
    description: 'Budowa domów.\n\nPraca w zespole <3 osób>.',
    responsibilities: ['Murowanie ścian', '  '],
    requirementsMandatory: ['Doświadczenie 2 lata'],
    requirementsOptional: ['Prawo jazdy B'],
    conditions: ['Umowa na czas nieokreślony'],
    workingHours: '7:00–15:30',
    shifts: 'Jedna zmiana',
    languages: [],
    transport: false,
    companyDescription: '',
    ...overrides,
  };
}

describe('JobPosting JSON-LD (#313)', () => {
  it('bez expiresAt pomija validThrough (bez wymyślonej daty)', () => {
    const data = buildJobPostingJsonLd(job(), `${BASE}/pl/oferty-pracy/murarz`, labels);
    expect(data).not.toHaveProperty('validThrough');
  });

  it('validThrough pochodzi wyłącznie z realnego expiresAt', () => {
    const data = buildJobPostingJsonLd(job({ expiresAt: '2026-10-15T23:59:00+00:00' }), 'u', labels);
    expect(data.validThrough).toBe('2026-10-15T23:59:00.000Z');
  });

  it('nieczytelna data wygaśnięcia nie jest publikowana', () => {
    const data = buildJobPostingJsonLd(job({ expiresAt: 'nie-data' }), 'u', labels);
    expect(data).not.toHaveProperty('validThrough');
  });

  it('opis jest pełnym HTML: obowiązki, wymagania, warunki, godziny i zmiany', () => {
    const description = String(buildJobPostingJsonLd(job(), 'u', labels).description);
    expect(description).toContain('<p>Budowa domów.</p>');
    expect(description).toContain(`<h3>${labels.responsibilities}</h3><ul><li>Murowanie ścian</li></ul>`);
    expect(description).toContain(`<h3>${labels.requirementsMandatory}</h3><ul><li>Doświadczenie 2 lata</li></ul>`);
    expect(description).toContain(`<h3>${labels.requirementsOptional}</h3><ul><li>Prawo jazdy B</li></ul>`);
    expect(description).toContain('<li>Umowa na czas nieokreślony</li>');
    expect(description).toContain(`<h3>${labels.workingHours}</h3><p>7:00–15:30</p>`);
    expect(description).toContain(`<h3>${labels.shifts}</h3><p>Jedna zmiana</p>`);
    // Puste pozycje nie tworzą pustych <li>.
    expect(description).not.toContain('<li></li>');
  });

  it('treść z bazy jest escapowana w HTML opisu', () => {
    const description = String(buildJobPostingJsonLd(job(), 'u', labels).description);
    expect(description).toContain('zespole &lt;3 osób&gt;');
    expect(description).not.toContain('<3 osób>');
  });

  it('pomija puste sekcje (bez nagłówka bez treści)', () => {
    const description = String(
      buildJobPostingJsonLd(
        job({ requirementsOptional: [], shifts: undefined, workingHours: '' }),
        'u',
        labels,
      ).description,
    );
    expect(description).not.toContain(labels.requirementsOptional);
    expect(description).not.toContain(labels.shifts);
    expect(description).not.toContain(labels.workingHours);
  });

  it('kontrola ujemna: stary sklejony opis nie spełniłby testu wymagań', () => {
    const legacy = [job().description, ...job().responsibilities].join(' ');
    expect(legacy).not.toContain('Doświadczenie 2 lata');
  });

  it('serializacja nie pozwala zamknąć tagu <script>', () => {
    const html = serializeJsonLd(buildJobPostingJsonLd(job({ title: '</script><b>' }), 'u', labels));
    expect(html).not.toContain('<');
    expect(JSON.parse(html).title).toBe('</script><b>');
  });
});

describe('JobPosting hiringOrganization sameAs/logo (0112)', () => {
  const org = (overrides: Partial<JobDetail>) =>
    buildJobPostingJsonLd(job(overrides), 'u', labels).hiringOrganization as Record<string, unknown>;

  it('publikuje stronę i logo firmy jako sameAs i logo', () => {
    expect(
      org({
        companyWebsite: ' https://www.bouw.example/over-ons ',
        companyLogoUrl: 'https://cdn.bouw.example/logo.png?v=2',
      }),
    ).toEqual({
      '@type': 'Organization',
      name: 'Bouw & Co',
      sameAs: 'https://www.bouw.example/over-ons',
      logo: 'https://cdn.bouw.example/logo.png?v=2',
    });
  });

  it('bez linków firmy organizacja ma tylko nazwę', () => {
    expect(org({})).toEqual({ '@type': 'Organization', name: 'Bouw & Co' });
  });

  it.each([
    'http://bouw.example',
    'javascript:alert(1)',
    '//bouw.example',
    '/logo.png',
    'https://localhost',
    'https://user:pw@bouw.example',
    'https://bouw.example/x y',
    'https://bouw.example/"></script><script>alert(1)</script>',
    'https://-bouw.example',
    `https://bouw.example/${'x'.repeat(2048)}`,
    '',
  ])('zły adres %j → brak pola', (url) => {
    expect(publicHttpsUrl(url)).toBeUndefined();
    const data = org({ companyWebsite: url, companyLogoUrl: url });
    expect(data).not.toHaveProperty('sameAs');
    expect(data).not.toHaveProperty('logo');
  });

  it('serializacja escapuje „<” także w polach organizacji', () => {
    const data = buildJobPostingJsonLd(
      job({ companyName: 'A</script>', companyWebsite: 'https://a.example/?q=%3C' }),
      'u',
      labels,
    );
    const json = serializeJsonLd(data);
    expect(json).not.toContain('</script>');
    expect(json).toContain('"sameAs":"https://a.example/?q=%3C"');
  });

  it('kontrola ujemna: surowy adres bez walidacji przepuściłby javascript:', () => {
    const naive = (value: string | undefined) => value?.trim() || undefined;
    expect(naive('javascript:alert(1)')).toBeDefined();
    expect(publicHttpsUrl('javascript:alert(1)')).toBeUndefined();
  });
});

describe('Article JSON-LD poradnika (#313)', () => {
  const guide = getGuideBySlug('praca-w-belgii-bez-znajomosci-jezyka', 'pl');

  it('ma obraz marki, dateModified oraz wydawcę z url i logo', () => {
    expect(guide).not.toBeNull();
    const canonical = `${BASE}/pl/poradniki/${guide!.slug}`;
    const data = buildArticleJsonLd(guide!, { base: BASE, locale: 'pl', canonical });
    expect(data.image).toEqual([`${BASE}/og.png`]);
    expect(data.datePublished).toBe(guide!.publishedAt);
    expect(data.dateModified).toBe(guide!.updatedAt);
    expect(data.author).toMatchObject({ name: 'Pracuj.be', url: `${BASE}/pl` });
    expect(data.publisher).toMatchObject({
      url: `${BASE}/pl`,
      logo: { '@type': 'ImageObject', url: `${BASE}/icon-512.png` },
    });
    expect(data.mainEntityOfPage).toBe(canonical);
  });

  it('dateModified używa updatedAt, gdy treść zmieniono po publikacji', () => {
    const data = buildArticleJsonLd(
      { title: 't', excerpt: 'e', publishedAt: '2026-05-01', updatedAt: '2026-09-01' },
      { base: BASE, locale: 'nl', canonical: 'c' },
    );
    expect(data.dateModified).toBe('2026-09-01');
  });
});

describe('obraz marki w metadanych publicznych stron (#116, #182)', () => {
  const PUBLIC_ROOT = join(process.cwd(), 'src/app/[locale]/(public)');

  function pageFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return pageFiles(path);
      return name === 'page.tsx' ? [path] : [];
    });
  }

  /** Strona nadpisująca openGraph/twitter musi podać obraz marki w obu blokach. */
  function missingShareImage(source: string): string[] {
    const problems: string[] = [];
    for (const key of ['openGraph', 'twitter'] as const) {
      const start = source.indexOf(`${key}: {`);
      if (start === -1) continue;
      const block = source.slice(start, source.indexOf('\n    }', start));
      if (!/images:\s*\[/.test(block)) problems.push(`${key} bez images`);
    }
    if (/openGraph: \{/.test(source) && !source.includes('brandShareImageUrl(')) {
      problems.push('brak brandShareImageUrl');
    }
    return problems;
  }

  const files = pageFiles(PUBLIC_ROOT).filter((file) => readFileSync(file, 'utf8').includes('openGraph: {'));

  it('obejmuje stronę główną, listę i szczegół oferty, /praca, kategorię, miasto i poradniki', () => {
    const relative = files.map((file) => file.slice(PUBLIC_ROOT.length));
    expect(relative).toEqual(
      expect.arrayContaining([
        '/page.tsx',
        '/oferty-pracy/page.tsx',
        '/oferty-pracy/[slug]/page.tsx',
        '/praca/page.tsx',
        '/praca/kategoria/[category]/page.tsx',
        '/praca/miasto/[city]/page.tsx',
        '/poradniki/page.tsx',
        '/poradniki/[slug]/page.tsx',
      ]),
    );
  });

  it.each(files.map((file) => [file.slice(PUBLIC_ROOT.length), file]))(
    '%s emituje og:image i twitter:image marki',
    (_name, file) => {
      expect(missingShareImage(readFileSync(file, 'utf8'))).toEqual([]);
    },
  );

  it('kontrola ujemna: nadpisany openGraph bez images jest wykrywany', () => {
    const source = readFileSync(files[0]!, 'utf8').replace(/\n\s*images: \[[^\n]*\n/g, '\n');
    expect(missingShareImage(source).length).toBeGreaterThan(0);
  });

  it('adres obrazu jest bezwzględny i wskazuje zasób marki', () => {
    expect(brandShareImageUrl('https://pracuj.be')).toBe('https://pracuj.be/og.png');
  });
});
