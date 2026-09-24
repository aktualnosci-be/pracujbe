// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUTH_EMAIL_TYPES, GUEST_EMAIL_TYPES, QUEUED_EMAIL_TYPES } from '@/emails/wiring';
import { ACTIVITIES, TABLE_CLASSIFICATION } from '@/lib/privacy/data-map';
import { PROCESSORS, TO_CONFIRM } from '@/lib/privacy/processors';

import { OUTPUT, buildDataMap, checkClassification } from '../../scripts/privacy/data-map.mjs';
import { extractEmailPayloads } from '../../scripts/privacy/email-payloads.mjs';
import { loadMigrationFiles, parseSchema } from '../../scripts/privacy/schema.mjs';

/**
 * Mapa danych osobowych (#485, #488, #503, #504): każda tabela z migracji ma klasyfikację,
 * kolumny wyglądające na dane osobowe nie przechodzą bez wpisu, a wygenerowany dokument
 * odpowiada kodowi. Kontrole ujemne dopisują do prawdziwych migracji syntetyczny SQL.
 */

const ROOT = resolve(__dirname, '../..');
const files = loadMigrationFiles(ROOT);
const EMAIL_TYPES = [...QUEUED_EMAIL_TYPES, ...GUEST_EMAIL_TYPES];

function withExtra(sql: string) {
  return parseSchema([...files, { path: 'supabase/migrations/9999_test.sql', sql }]);
}

describe('mapa danych — klasyfikacja schematu', () => {
  it('parser widzi tabele z danymi osobowymi ze wszystkich katalogów migracji', () => {
    const tables = parseSchema(files);
    for (const name of ['auth.users', 'auth.sessions', 'public.profiles', 'public.applications', 'public.guest_application_requests', 'public.messages']) {
      expect(tables.has(name), name).toBe(true);
    }
    // Kolumny dodane przez `alter table … add column` (0095) też są w schemacie.
    expect(tables.get('public.applications')?.columns.has('guest_email')).toBe(true);
  });

  it('każda tabela jest sklasyfikowana, a kolumny wyglądające na dane osobowe mają wpis', () => {
    expect(checkClassification(parseSchema(files))).toEqual([]);
  });

  it('kontrola ujemna: nowa kolumna email bez klasyfikacji → błąd', () => {
    const errors = checkClassification(withExtra('alter table public.system_events add column email text;'));
    expect(errors.filter((e) => e.includes('public.system_events.email'))).toHaveLength(1);
  });

  it('kontrola ujemna: nowa kolumna w create table i wieloczłonowym alter table → błąd', () => {
    const errors = checkClassification(
      withExtra(`alter table public.jobs
        add column if not exists recruiter_phone text,
        add constraint jobs_x check (true);`),
    );
    expect(errors.join('\n')).toContain('public.jobs.recruiter_phone');
  });

  it('kontrola ujemna: nowa tabela bez klasyfikacji → błąd z listą podejrzanych kolumn', () => {
    const errors = checkClassification(
      withExtra('create table if not exists public.candidate_notes (id uuid primary key, candidate_id uuid, note text);'),
    );
    expect(errors.some((e) => /public\.candidate_notes.*candidate_id, note/.test(e))).toBe(true);
  });

  it('kontrola ujemna: wpis wskazujący nieistniejącą kolumnę lub tabelę → błąd', () => {
    const profiles = TABLE_CLASSIFICATION['public.profiles']!;
    const errors = checkClassification(parseSchema(files), {
      ...TABLE_CLASSIFICATION,
      'public.profiles': { ...profiles, columns: { ...profiles.columns, nickname: 'identity' } },
      'public.ghost': { activities: [], subjects: [], columns: {} },
    });
    expect(errors).toContain('Klasyfikacja wskazuje nieistniejącą kolumnę public.profiles.nickname.');
    expect(errors).toContain('Klasyfikacja wskazuje tabelę public.ghost, której nie ma w migracjach.');
  });

  it('pomija tabele w ciałach funkcji, komentarzach i literałach', () => {
    const tables = withExtra(`
      -- create table public.commented (email text);
      /* create table public.block_commented (email text); */
      create or replace function public.f() returns void language plpgsql as $$
      begin create temp table scratch (email text); end $$;
      select 'create table public.in_literal (email text)';`);
    for (const name of ['public.commented', 'public.block_commented', 'public.scratch', 'public.in_literal']) {
      expect(tables.has(name), name).toBe(false);
    }
  });
});

describe('mapa danych — dokument i dostawcy', () => {
  it('docs/legal-drafts/data-map.generated.md jest aktualny (node scripts/privacy/data-map.mjs)', () => {
    const { markdown } = buildDataMap(ROOT);
    expect(readFileSync(resolve(ROOT, OUTPUT), 'utf8')).toBe(markdown);
    expect(markdown).toContain('PROJEKT — do weryfikacji prawnika, nieopublikowany');
  });

  it('pola prawne dostawców nie są zgadywane — zostają „DO UZUPEŁNIENIA”', () => {
    const ids = PROCESSORS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PROCESSORS) {
      expect([p.role, p.region, p.transferBasis, p.contract, p.providerRetention]).toEqual(Array(5).fill(TO_CONFIRM));
      expect(p.codeRefs.length).toBeGreaterThan(0);
    }
    const used = new Set(Object.values(ACTIVITIES).flatMap((a) => a.processors));
    expect(ids.filter((id) => !used.has(id))).toEqual([]);
  });

  it('odnośniki do kodu u dostawców wskazują istniejące pliki', () => {
    for (const p of PROCESSORS) {
      for (const ref of p.codeRefs) expect(statSync(resolve(ROOT, ref)), `${p.id}: ${ref}`).toBeTruthy();
    }
  });

  it('mapa danych i rejestr dostawców nie są importowane przez UI', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(tsx?|mjs)$/.test(entry.name) && /lib\/privacy\/(data-map|processors)/.test(readFileSync(path, 'utf8'))) offenders.push(path);
      }
    };
    walk(resolve(ROOT, 'src/app'));
    walk(resolve(ROOT, 'src/components'));
    expect(offenders).toEqual([]);
  });
});

describe('mapa danych — zakres danych w e-mailach (#503)', () => {
  // Treść, której nie wolno wysyłać do dostawcy poczty bez osobnej oceny.
  const FORBIDDEN = /cv|resume|file|answer|screening|body|messagetext|phone|niss|birth|health/i;

  it('każdy kolejkowany szablon ma wykryty payload w aktualnych funkcjach SQL', () => {
    const payloads = extractEmailPayloads(files, EMAIL_TYPES);
    expect(EMAIL_TYPES.filter((t) => !payloads.has(t))).toEqual([]);
    expect(payloads.get('newApplication')).toEqual({
      keys: ['candidateName', 'jobTitle'],
      functions: ['apply_to_job', 'confirm_guest_application'],
    });
    expect(AUTH_EMAIL_TYPES.length).toBeGreaterThan(0);
  });

  it('payloady nie zawierają CV, odpowiedzi screeningowych, treści wiadomości ani telefonu', () => {
    const payloads = extractEmailPayloads(files, EMAIL_TYPES);
    const leaks = [...payloads].flatMap(([t, { keys }]) => keys.filter((k) => FORBIDDEN.test(k)).map((k) => `${t}.${k}`));
    expect(leaks).toEqual([]);
  });

  it('kontrola ujemna: nowsza definicja funkcji dodająca odpowiedzi do payloadu → wykryta', () => {
    const payloads = extractEmailPayloads(
      [
        ...files,
        {
          path: 'supabase/migrations/9999_test.sql',
          sql: `create or replace function public.apply_to_job(p uuid) returns uuid language plpgsql as $$
            begin
              perform public.enqueue_email(v_owner, 'newApplication', 'application', v_id, 'k',
                jsonb_build_object('candidateName', v_name, 'screeningAnswers', v_answers));
            end $$;`,
        },
      ],
      EMAIL_TYPES,
    );
    expect(payloads.get('newApplication')?.keys).toContain('screeningAnswers');
    expect(payloads.get('newApplication')?.keys.filter((k) => FORBIDDEN.test(k))).toEqual(['screeningAnswers']);
  });
});
