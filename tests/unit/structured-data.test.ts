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

  // #840 — portal nie ma zewnętrznego ATS: każda realna, kanoniczna oferta ma formularz
  // aplikowania na tej samej stronie (zalogowany kandydat i gość bez konta), więc `directApply`
  // musi odzwierciedlać ten przepływ zamiast stałego `false`.
  it('#840: directApply jest true (aplikowanie odbywa się na stronie oferty)', () => {
    const data = buildJobPostingJsonLd(job(), 'u', labels);
    expect(data.directApply).toBe(true);
  });

  it('#840 kontrola ujemna: dawna stała false nie wraca dla innej oferty', () => {
    // Gdyby implementacja wróciła do stałej `directApply: false`, ten test staje się czerwony
    // niezależnie od danych konkretnej oferty (regresja #840).
    const data = buildJobPostingJsonLd(
      job({ title: 'Inna oferta', city: 'Antwerpen', contractType: 'freelance' }),
      'u',
      labels,
    );
    expect(data.directApply).not.toBe(false);
    expect(data.directApply).toBe(true);
  });

  it('#1130: tryb ogłoszeniowy — aplikowanie u ogłoszeniodawcy, directApply false', () => {
    expect(buildJobPostingJsonLd(job(), 'u', labels, { directApply: false }).directApply).toBe(false);
    expect(buildJobPostingJsonLd(job(), 'u', labels, { directApply: true }).directApply).toBe(true);
  });

  // #792 — TELECOMMUTE tylko dla potwierdzonej pracy w 100% zdalnej z krajem kandydata.
  describe('#792: jobLocationType TELECOMMUTE', () => {
    const physical = { '@type': 'Place' };

    it('praca w 100% zdalna z krajem: TELECOMMUTE + applicantLocationRequirements, bez jobLocation', () => {
      const data = buildJobPostingJsonLd(
        job({ workMode: 'remote', remoteApplicantCountries: ['be'] }),
        'u',
        labels,
      );
      expect(data.jobLocationType).toBe('TELECOMMUTE');
      expect(data.applicantLocationRequirements).toEqual({ '@type': 'Country', name: 'BE' });
      expect(data).not.toHaveProperty('jobLocation');
    });

    it('kilka krajów (bez duplikatów i błędnych kodów) = lista Country', () => {
      const data = buildJobPostingJsonLd(
        job({ workMode: 'remote', remoteApplicantCountries: ['BE', 'nl', 'BE', 'Belgium', ''] }),
        'u',
        labels,
      );
      expect(data.applicantLocationRequirements).toEqual([
        { '@type': 'Country', name: 'BE' },
        { '@type': 'Country', name: 'NL' },
      ]);
    });

    it('kontrola ujemna: stacjonarna zostaje z jobLocation, bez TELECOMMUTE', () => {
      const data = buildJobPostingJsonLd(
        job({ workMode: 'onsite', remoteApplicantCountries: ['BE'] }),
        'u',
        labels,
      );
      expect(data).not.toHaveProperty('jobLocationType');
      expect(data).not.toHaveProperty('applicantLocationRequirements');
      expect(data.jobLocation).toMatchObject(physical);
    });

    it('kontrola ujemna: hybrydowa nigdy nie dostaje TELECOMMUTE', () => {
      const data = buildJobPostingJsonLd(
        job({ workMode: 'hybrid', remoteApplicantCountries: ['BE'] }),
        'u',
        labels,
      );
      expect(data).not.toHaveProperty('jobLocationType');
      expect(data.jobLocation).toMatchObject(physical);
    });

    it('kontrola ujemna: tryb nieznany (dawny boolean remote) nie jest mapowany na TELECOMMUTE', () => {
      const data = buildJobPostingJsonLd(job({ remoteApplicantCountries: ['BE'] }), 'u', labels);
      expect(data).not.toHaveProperty('jobLocationType');
      expect(data.jobLocation).toMatchObject(physical);
    });

    it('kontrola ujemna: zdalna bez poprawnego kraju kandydata = zwykły jobLocation', () => {
      for (const countries of [undefined, [], ['Belgium', '  ']]) {
        const data = buildJobPostingJsonLd(
          job({ workMode: 'remote', remoteApplicantCountries: countries }),
          'u',
          labels,
        );
        expect(data).not.toHaveProperty('jobLocationType');
        expect(data).not.toHaveProperty('applicantLocationRequirements');
        expect(data.jobLocation).toMatchObject(physical);
      }
    });
  });

  // #842 — umowa na stałe nie mówi nic o wymiarze etatu (patrz `job.workingHours`, wolny tekst);
  // fałszywe `FULL_TIME` przy realnej ofercie na część etatu wprowadzało w błąd wyszukiwarki.
  it('#842: umowa na stałe (permanent) NIE emituje employmentType — wymiar etatu nieznany', () => {
    const data = buildJobPostingJsonLd(
      job({ contractType: 'permanent', workingHours: 'Part-time, 20 hours/week' }),
      'u',
      labels,
    );
    expect(data).not.toHaveProperty('employmentType');
    expect(data.employmentType).not.toBe('FULL_TIME');
  });

  // #811 (0194): wymiar pracy zadeklarowany przez pracodawcę (`jobs.work_time`) daje
  // FULL_TIME/PART_TIME także przy umowie na stałe; bez deklaracji nadal nic (#842).
  it('#811: zadeklarowany wymiar pracy → employmentType (także przy umowie na stałe)', () => {
    expect(buildJobPostingJsonLd(job({ contractType: 'permanent', workTime: 'part_time' }), 'u', labels).employmentType)
      .toBe('PART_TIME');
    expect(buildJobPostingJsonLd(job({ contractType: 'permanent', workTime: 'both' }), 'u', labels).employmentType)
      .toEqual(['FULL_TIME', 'PART_TIME']);
    expect(buildJobPostingJsonLd(job({ contractType: 'temporary', workTime: 'full_time' }), 'u', labels).employmentType)
      .toEqual(['FULL_TIME', 'TEMPORARY']);
    // Kontrola ujemna: opis godzin bez deklaracji niczego nie ustawia.
    expect(buildJobPostingJsonLd(job({ contractType: 'permanent', workingHours: 'Full-time' }), 'u', labels))
      .not.toHaveProperty('employmentType');
  });

  it('#842 kontrola ujemna: rodzaje umowy o znanej kategorii nadal emitują employmentType', () => {
    expect(buildJobPostingJsonLd(job({ contractType: 'temporary' }), 'u', labels).employmentType).toBe(
      'TEMPORARY',
    );
    expect(buildJobPostingJsonLd(job({ contractType: 'interim' }), 'u', labels).employmentType).toBe(
      'TEMPORARY',
    );
    expect(buildJobPostingJsonLd(job({ contractType: 'freelance' }), 'u', labels).employmentType).toBe(
      'CONTRACTOR',
    );
    expect(buildJobPostingJsonLd(job({ contractType: 'internship' }), 'u', labels).employmentType).toBe(
      'INTERN',
    );
    expect(buildJobPostingJsonLd(job({ contractType: 'seasonal' }), 'u', labels).employmentType).toBe(
      'TEMPORARY',
    );
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

describe('JobPosting hiringOrganization sameAs/logo (0114)', () => {
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
