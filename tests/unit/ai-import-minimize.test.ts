// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildUserContent, FixtureJobExtractor, type ExtractionInput, type JobExtractor } from '@/lib/ai-import/extract';
import { listingSourceLabel, minimizeJobPostingJsonLd } from '@/lib/ai-import/minimize';
import { runJobImport } from '@/lib/ai-import/run-import';
import { htmlToText } from '@/lib/ai-import/safe-fetch';

/**
 * #500/#495 — minimalizacja materiału importu PRZED wysłaniem do dostawcy i walidacja wyjścia.
 * Ekstraktor to atrapa, która zapisuje dokładny payload (bloki wiadomości), więc test sprawdza
 * to, co naprawdę wyszłoby do API. Dane są syntetyczne.
 */

const TOKEN_URL = 'https://jobs.example.be/offer/42?token=SECRET-TOKEN-123&utm=x#apply';

const LISTING_HTML = `<!doctype html><html><head><title>Orderpicker magazijn</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting",
  "title":"Orderpicker","description":"<p>Je verzamelt bestellingen met een handscanner.</p>",
  "url":"https://jobs.example.be/offer/42?token=SECRET-TOKEN-123","identifier":{"@type":"PropertyValue","value":"REF-SECRET"},
  "applicationContact":{"@type":"ContactPoint","email":"hr.lisa@example.be","telephone":"+32 3 123 45 67"},
  "hiringOrganization":{"@type":"Organization","name":"Logistiek NV","email":"ceo.private@example.be","sameAs":"https://x"},
  "jobLocation":{"@type":"Place","address":{"@type":"PostalAddress","addressLocality":"Antwerpen","addressRegion":"Vlaanderen"}},
  "baseSalary":{"@type":"MonetaryAmount","currency":"EUR","value":{"@type":"QuantitativeValue","minValue":15,"maxValue":17.5,"unitText":"HOUR"}}}</script>
<script type="application/ld+json">{"@type":"Organization","name":"Portal","contactPoint":{"email":"privacy.officer@example.be"}}</script>
</head><body>
<nav>Home · Vacatures · Inloggen als jan.nav@example.be</nav>
<main>
  <h1>Orderpicker magazijn (m/v/x)</h1>
  <p>Voor een logistiek centrum in Antwerpen zoeken we orderpickers. Loon 15–17,50 EUR per uur, 38 u/week.</p>
  <ul><li>Bestellingen verzamelen</li><li>Goederen verpakken</li></ul>
  <p>Vragen? Mail naar lisa.peeters@example.be of bel 0471 23 45 67.</p>
</main>
<aside>Gerelateerd: bel onze CEO op +32 470 99 88 77</aside>
<footer>© Portal · Contact: footer.private@example.be · Kerkstraat 1, 2000 Antwerpen</footer>
</body></html>`;

class CapturingExtractor implements JobExtractor {
  inputs: ExtractionInput[] = [];
  constructor(private readonly response?: unknown) {}
  async extract(input: ExtractionInput): Promise<unknown> {
    this.inputs.push(input);
    return this.response ?? new FixtureJobExtractor().extract(input);
  }
}

describe('import z linku — payload dostawcy bez danych osób trzecich', () => {
  it('stopka, e-maile, telefony i URL z tokenem nie trafiają do payloadu; oferta nadal wypełnia szkic', async () => {
    const extractor = new CapturingExtractor();
    const result = await runJobImport(
      { kind: 'url', url: TOKEN_URL },
      { extractor, fetchListing: async () => ({ kind: 'text', url: TOKEN_URL, text: htmlToText(LISTING_HTML) }) },
    );

    expect(extractor.inputs).toHaveLength(1);
    // Dokładnie ten tekst trafia do wiadomości `user` w Responses API (`src/lib/ai/openai.ts`).
    const payload = buildUserContent(extractor.inputs[0]!)
      .map((block) => (block.kind === 'text' ? block.text : JSON.stringify(block)))
      .join('\n');
    for (const leaked of [
      'SECRET-TOKEN-123',
      'token=',
      '/offer/42',
      '#apply',
      'REF-SECRET',
      'lisa.peeters@example.be',
      'hr.lisa@example.be',
      'ceo.private@example.be',
      'privacy.officer@example.be',
      'footer.private@example.be',
      'jan.nav@example.be',
      '0471 23 45 67',
      '+32 470 99 88 77',
      '+32 3 123 45 67',
      'Kerkstraat',
    ]) {
      expect(payload, leaked).not.toContain(leaked);
    }
    // Treść oferty zostaje.
    expect(payload).toContain('<listing source="jobs.example.be">');
    expect(payload).toContain('Voor een logistiek centrum in Antwerpen zoeken we orderpickers');
    expect(payload).toContain('Bestellingen verzamelen');
    expect(payload).toContain('"addressLocality":"Antwerpen"');
    expect(payload).toContain('"minValue":15');
    expect(payload).toContain('Logistiek NV');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mapped.values.title).toBeTruthy();
    expect(result.mapped.values).not.toHaveProperty('contactEmail');
    expect(result.mapped.validSteps.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.mapped)).not.toContain('recruiter.jan@example.be');
  });

  it('kontrola ujemna: bez minimalizacji (surowy HTML) e-mail ze stopki byłby w materiale', () => {
    expect(LISTING_HTML).toContain('footer.private@example.be');
    expect(htmlToText(LISTING_HTML)).not.toContain('footer.private@example.be');
    // Treść <main> (z e-mailem) jest w tekście — usuwa ją dopiero redakcja w runJobImport.
    expect(htmlToText(LISTING_HTML)).toContain('lisa.peeters@example.be');
  });

  it('NISS w treści strony jest usuwany przed wysłaniem', async () => {
    const extractor = new CapturingExtractor();
    await runJobImport(
      { kind: 'url', url: 'https://jobs.example.be/x' },
      {
        extractor,
        fetchListing: async () => ({
          kind: 'text',
          url: 'https://jobs.example.be/x',
          text: 'Magazijnmedewerker in Gent, 38 uur per week. Voorbeeldkandidaat INSZ 85.07.30-033.28 werkte hier.',
        }),
      },
    );
    const payload = JSON.stringify(buildUserContent(extractor.inputs[0]!));
    expect(payload).not.toContain('85.07.30-033.28');
    expect(payload).toContain('[identifier removed]');
  });
});

describe('import ze zrzutu — walidacja wyjścia modelu', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  it('numer identyfikacyjny w odpowiedzi → bezpieczna odmowa (nic do formularza)', async () => {
    const fixture = (await new FixtureJobExtractor().extract({ kind: 'text', text: 'x', source: 'x' })) as Record<string, unknown>;
    const extractor = new CapturingExtractor({ ...fixture, conditions: ['Paspoortnummer EH123456 van de vorige kandidaat'] });
    const result = await runJobImport({ kind: 'image', bytes: PNG, declaredType: 'image/png' }, { extractor });
    expect(result).toEqual({ ok: false, error: 'JOB_IMPORT_SENSITIVE_DATA' });
  });

  it('dane kontaktowe niezwiązanej osoby w odpowiedzi są usuwane z formularza', async () => {
    const fixture = (await new FixtureJobExtractor().extract({ kind: 'text', text: 'x', source: 'x' })) as Record<string, unknown>;
    const extractor = new CapturingExtractor({
      ...fixture,
      benefits: ['Maaltijdcheques', 'Bel Tom (privé) op 0470 11 22 33'],
      companyDescription: 'Mail tom.janssens@example.be voor meer info.',
    });
    const result = await runJobImport({ kind: 'image', bytes: PNG, declaredType: 'image/png' }, { extractor });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mapped.values.benefits).toEqual(['Maaltijdcheques']);
    expect(result.mapped.values.companyDescription).toBeUndefined();
    expect(result.mapped.review).toEqual(expect.arrayContaining(['benefits', 'companyDescription']));
    expect(JSON.stringify(result.mapped)).not.toMatch(/tom\.janssens|0470 11 22 33/);
  });
});

describe('minimizeJobPostingJsonLd / listingSourceLabel', () => {
  it('bez JobPosting albo z niepoprawnym JSON → null', () => {
    expect(minimizeJobPostingJsonLd('{"@type":"Organization","email":"a@b.be"}')).toBeNull();
    expect(minimizeJobPostingJsonLd('{nie json')).toBeNull();
  });

  it('JobPosting w @graph, tylko dozwolone pola', () => {
    const out = minimizeJobPostingJsonLd(
      JSON.stringify({ '@graph': [{ '@type': 'WebPage' }, { '@type': 'JobPosting', title: 'Chauffeur C', url: 'https://x/?t=1' }] }),
    );
    expect(out).toBe('{"@type":"JobPosting","title":"Chauffeur C"}');
  });

  it('źródło = sam host', () => {
    expect(listingSourceLabel(TOKEN_URL)).toBe('jobs.example.be');
    expect(listingSourceLabel('nie url')).toBe('');
  });
});
