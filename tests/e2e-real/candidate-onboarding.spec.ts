import { expect, test } from '@playwright/test';
import { flags, loadWizard, saveStep, type WizardValues } from './support/onboarding';
import { createStack, expectDomainError, rows, rpc, rpcRows, type Actor, type Stack } from './support/stack';

/**
 * Onboarding kandydata (#66) na PRAWDZIWYM PostgreSQL 16 pod sesją Better Auth:
 * sześć kroków zapisywanych osobno, pełne przeładowanie po każdym, wznowienie po przerwaniu
 * bez utraty relacji (umiejętności/języki/certyfikaty), kompletność liczona w bazie
 * (`finish_onboarding`), wyszukiwalność tylko dla kompletnego profilu. Kontrole ujemne:
 * nieudany zapis nie kasuje danych, podwójne kliknięcie nie dubluje relacji, walidacja pól
 * (schematy kroków z produkcji) i baza odrzucają złe dane bez zmiany stanu.
 *
 * Zapis/odczyt: `saveStep`/`loadWizard` (support/onboarding.ts) — kontrakt akcji
 * `saveOnboardingStep` i loadera strony kreatora na ścieżce sesji z cookie + RLS.
 */

const run = Math.random().toString(36).slice(2, 8);

let stack: Stack;
let candidate: Actor; // nl — pełny przepływ
let incomplete: Actor; // en — profil bez lokalizacji
let employer: Actor; // firma zweryfikowana — widok wyszukiwania
let candidateProfileId: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  stack = await createStack();
  candidate = await stack.signUpCandidate(`onb-candidate-${run}@e2e.invalid`, 'nl', ['Sanne', 'Janssens']);
  incomplete = await stack.signUpCandidate(`onb-incomplete-${run}@e2e.invalid`, 'en', ['Tom', 'Evans']);
  employer = await stack.signUpEmployer(`onb-employer-${run}@e2e.invalid`, 'fr', ['Luc', 'Martin'], 'Onboarding SA');
  const admin = await stack.signUpCandidate(`onb-admin-${run}@e2e.invalid`, 'en', ['Ada', 'Admin']);
  await stack.admin.query("UPDATE public.profiles SET role = 'admin' WHERE id = (SELECT id FROM auth.users WHERE email = $1)",
    [admin.email]);
  const [company] = await employer.request((tx) => rpcRows<{ company_id: string }>(tx, 'create_first_company', {
    p_name: 'Onboarding SA', p_slug: `onboarding-sa-${run}` }));
  await admin.request((tx) => rpc(tx, 'admin_set_company_status', { p_company_id: company!.company_id, p_status: 'verified' }));
});

test.afterAll(async () => {
  await stack?.close();
});

const STEP1 = { firstName: 'Sanne', lastName: 'Janssens', phone: '+32 470 11 22 33' };
const STEP2 = { occupations: ['Heftruckchauffeur', 'Orderpicker'], categories: ['warehouse', 'logistics'] };
const STEP3 = { experienceYears: 6, skills: ['Reachtruck', 'Scanner', 'WMS'] };
const STEP4 = { city: 'Gent', region: 'Oost-Vlaanderen', radiusKm: 40, hasDrivingLicense: true, hasCar: true };
const STEP5 = {
  languages: [{ language: 'nl', level: 'native' }, { language: 'fr', level: 'intermediate' }],
  certificates: ['Heftruckattest', 'VCA Basis'],
  certificateExpiry: { 'VCA Basis': '2029-03-31' },
};
const STEP6 = { availability: 'within_month', preferredContractTypes: ['permanent', 'interim'], bio: 'Ervaren in nachtploegen.' };

/** Wszystko, co kreator ma odtworzyć po przeładowaniu po krokach 1–5. */
const AFTER_STEP5: WizardValues = {
  ...STEP1,
  ...STEP2,
  experienceYears: 6,
  skills: ['Reachtruck', 'Scanner', 'WMS'],
  ...STEP4,
  languages: [{ language: 'fr', level: 'intermediate' }, { language: 'nl', level: 'native' }],
  certificates: ['Heftruckattest', 'VCA Basis'],
  certificateExpiry: { 'VCA Basis': '2029-03-31' },
};

/** Czy pracodawca zweryfikowanej firmy widzi profil w wyszukiwaniu (RLS). */
const employerSees = async () => rows(await employer.request((tx) => tx.query(
  'SELECT id FROM public.candidate_profiles WHERE id = $1', [candidateProfileId]))).length;

test('kroki 1–5: każdy zapis osobno, stan po przeładowaniu z bazy; profil jeszcze niekompletny', async () => {
  // Świeże konto: nie da się włączyć wyszukiwalności ani ukończyć profilu bez danych.
  expect(await candidate.request((tx) => rpc<boolean>(tx, 'finish_onboarding'))).toBe(false);
  await expectDomainError(candidate.request((tx) => rpc(tx, 'set_candidate_searchable', { p_searchable: true })),
    'VALIDATION_FAILED');

  expect(await saveStep(candidate, 1, STEP1)).toEqual({ ok: true });
  expect(await loadWizard(candidate)).toMatchObject(STEP1);
  expect(await saveStep(candidate, 2, STEP2)).toEqual({ ok: true });
  expect(await loadWizard(candidate)).toMatchObject({ ...STEP1, ...STEP2 });
  expect(await saveStep(candidate, 3, STEP3)).toEqual({ ok: true });
  expect(await loadWizard(candidate)).toMatchObject({ ...STEP2, ...STEP3 });
  expect(await saveStep(candidate, 4, STEP4)).toEqual({ ok: true });
  expect(await saveStep(candidate, 5, STEP5)).toEqual({ ok: true });
  expect(await loadWizard(candidate)).toMatchObject(AFTER_STEP5);

  expect(await flags(candidate)).toEqual({ profile_completed: false, is_searchable: false });
  candidateProfileId = rows<{ id: string }>(await stack.admin.query(
    'SELECT cp.id FROM public.candidate_profiles cp JOIN auth.users u ON u.id = cp.profile_id WHERE u.email = $1',
    [candidate.email]))[0]!.id;
  expect(await employerSees()).toBe(0);
});

test('wznowienie po przerwaniu: kreator z bazy, „Dalej” przez kroki 1–5 nie gubi relacji', async () => {
  // Przerwanie = nowa sesja przeglądarki i pełne przeładowanie; kreator dostaje dane z bazy
  // i przy „Dalej” wysyła je z powrotem (kroki 3 i 5 to replace-all — P1-08).
  const resumed = await loadWizard(candidate);
  const pick = <K extends keyof WizardValues>(...keys: K[]) =>
    Object.fromEntries(keys.map((k) => [k, resumed[k]])) as Pick<WizardValues, K>;
  expect(await saveStep(candidate, 1, pick('firstName', 'lastName', 'phone'))).toEqual({ ok: true });
  expect(await saveStep(candidate, 2, pick('occupations', 'categories'))).toEqual({ ok: true });
  expect(await saveStep(candidate, 3, pick('experienceYears', 'skills'))).toEqual({ ok: true });
  expect(await saveStep(candidate, 4, pick('city', 'region', 'radiusKm', 'hasDrivingLicense', 'hasCar'))).toEqual({ ok: true });
  expect(await saveStep(candidate, 5, pick('languages', 'certificates', 'certificateExpiry'))).toEqual({ ok: true });
  expect(await loadWizard(candidate)).toEqual(resumed);
  expect(resumed).toMatchObject(AFTER_STEP5);

  // Edycja po wznowieniu: usunięta pozycja naprawdę znika (replace-all, nie dopisywanie).
  expect(await saveStep(candidate, 3, { experienceYears: 7, skills: ['Reachtruck', 'WMS', 'Heftruck'] })).toEqual({ ok: true });
  expect(await loadWizard(candidate)).toMatchObject({ experienceYears: 7, skills: ['Heftruck', 'Reachtruck', 'WMS'] });
  expect(await saveStep(candidate, 3, { experienceYears: 6, skills: STEP3.skills })).toEqual({ ok: true });
  expect(await loadWizard(candidate)).toEqual(resumed);
});

test('nieudany zapis nie kasuje danych: walidacja pól i odrzucenie w bazie bez zmiany stanu', async () => {
  const before = await loadWizard(candidate);

  // Walidacja pól (schematy kroków z produkcji): błąd przy polu, zero zapisu.
  const invalid: [1 | 2 | 3 | 4 | 5 | 6, unknown, string][] = [
    [1, { ...STEP1, firstName: '' }, 'candidate.error.firstNameRequired'],
    [1, { ...STEP1, phone: 'abc' }, 'candidate.error.phoneInvalid'],
    [2, { ...STEP2, occupations: [] }, 'candidate.error.occupationsRequired'],
    [3, { ...STEP3, experienceYears: 61 }, 'candidate.error.experienceInvalid'],
    [3, { ...STEP3, skills: ['x'.repeat(121)] }, 'candidate.error.itemTooLong'],
    [4, { ...STEP4, city: 'G' }, 'candidate.error.cityRequired'],
    [5, { ...STEP5, certificateExpiry: { 'VCA Basis': '2029-02-30' } }, 'candidate.error.certificateExpiryInvalid'],
    [6, { ...STEP6, bio: 'x'.repeat(2001) }, 'candidate.error.bioTooLong'],
  ];
  for (const [step, data, issue] of invalid) {
    const result = await saveStep(candidate, step, data);
    expect(result, `krok ${step}: ${issue}`).toMatchObject({ ok: false, error: 'VALIDATION_FAILED' });
    expect(result.ok ? [] : result.issues).toContain(issue);
  }
  // „Zakończ” bez zgody na regulamin — odrzucone przed zapisem (dostępność nie trafia do bazy).
  expect(await saveStep(candidate, 6, STEP6, { finish: true }))
    .toMatchObject({ ok: false, issues: ['candidate.error.termsRequired', 'candidate.error.privacyNoticeRequired'] });
  expect(await loadWizard(candidate)).toEqual(before);

  // Obejście walidacji klienta — baza sama odrzuca i cofa CAŁY krok (jedna transakcja, #142).
  await expectDomainError(candidate.request((tx) => rpc(tx, 'save_candidate_onboarding_step3', {
    p_experience_years: -1, p_skills: ['Nowa umiejętność'] })), 'VALIDATION_FAILED');
  await expectDomainError(candidate.request((tx) => rpc(tx, 'save_candidate_onboarding_step5', {
    p_languages: JSON.stringify([{ language: 'en', level: 'fluent' }]),
    p_certificates: JSON.stringify([{ label: 'Nowy certyfikat', expires_at: 'jutro' }]) })),
  /invalid input syntax|VALIDATION_FAILED/);
  await expectDomainError(candidate.request((tx) => rpc(tx, 'save_candidate_onboarding_step5', {
    p_languages: JSON.stringify([{ language: 'en', level: 'expert' }]), p_certificates: '[]' })),
  /invalid input value|VALIDATION_FAILED/);
  // Relacje piszą wyłącznie RPC (0028): bezpośredni DML odrzucony, niczego nie usuwa.
  await expectDomainError(candidate.request((tx) => tx.query(
    'DELETE FROM public.candidate_skills WHERE candidate_profile_id = $1', [candidateProfileId])), /permission denied/);
  await expectDomainError(candidate.request((tx) => tx.query(
    "INSERT INTO public.candidate_languages (candidate_profile_id, language_label, level) VALUES ($1, 'de', 'basic')",
    [candidateProfileId])), /permission denied/);
  // Konto pracodawcy nie zapisze kroków kandydata (P1-04).
  expect(await saveStep(employer, 3, STEP3)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });

  // „Reload” po wszystkich nieudanych próbach: stan identyczny jak przed nimi.
  expect(await loadWizard(candidate)).toEqual(before);
  // Inny kandydat nie widzi relacji tego profilu (RLS).
  expect(rows(await incomplete.request((tx) => tx.query(
    'SELECT skill_label FROM public.candidate_skills WHERE candidate_profile_id = $1', [candidateProfileId])))).toEqual([]);
});

test('podwójne kliknięcie „Dalej”: równoległe zapisy kroków 3 i 5 bez duplikatów i bez błędu', async () => {
  const before = await loadWizard(candidate);
  const step3 = { experienceYears: 6, skills: STEP3.skills };
  const results = await Promise.all([
    saveStep(candidate, 3, step3), saveStep(candidate, 3, step3),
    saveStep(candidate, 5, STEP5), saveStep(candidate, 5, STEP5),
  ]);
  expect(results).toEqual(Array(4).fill({ ok: true }));
  expect(await loadWizard(candidate)).toEqual(before);
  const counts = rows<{ skills: number; languages: number; certificates: number }>(await stack.admin.query(
    `SELECT (SELECT count(*)::int FROM public.candidate_skills WHERE candidate_profile_id = $1) AS skills,
            (SELECT count(*)::int FROM public.candidate_languages WHERE candidate_profile_id = $1) AS languages,
            (SELECT count(*)::int FROM public.candidate_certificates WHERE candidate_profile_id = $1) AS certificates`,
    [candidateProfileId]))[0];
  expect(counts).toEqual({ skills: 3, languages: 2, certificates: 2 });
});

test('krok 6: „Zapisz i wyjdź” zapisuje bez zgody, „Zakończ” → finish_onboarding liczy kompletność w bazie', async () => {
  // Zapis szkicu kroku 6 (bez zgody) — dane w bazie, profil nadal niekompletny.
  expect(await saveStep(candidate, 6, STEP6)).toEqual({ ok: true });
  expect(await loadWizard(candidate)).toMatchObject({ ...AFTER_STEP5, ...STEP6 });
  expect(await flags(candidate)).toEqual({ profile_completed: false, is_searchable: false });

  // Klient nie ustawi flag sam (guard 0029) — ani ukończenia, ani wyszukiwalności.
  for (const column of ['profile_completed', 'is_searchable']) {
    await expectDomainError(candidate.request((tx) => tx.query(
      `UPDATE public.candidate_profiles SET ${column} = true WHERE profile_id = auth.uid()`)), 'PERMISSION_DENIED');
  }
  await expectDomainError(candidate.request((tx) => rpc(tx, 'set_candidate_searchable', { p_searchable: true })),
    'VALIDATION_FAILED');
  expect(await flags(candidate)).toEqual({ profile_completed: false, is_searchable: false });

  // „Zakończ” klikane dwa razy naraz — oba żądania kończą się sukcesem, stan jeden.
  const finish = { ...STEP6, agreeTerms: true, privacyNoticeAck: true };
  expect(await Promise.all([saveStep(candidate, 6, finish, { finish: true }), saveStep(candidate, 6, finish, { finish: true })]))
    .toEqual([{ ok: true }, { ok: true }]);
  // Ukończenie nie włącza wyszukiwalności samo — to świadomy opt-in.
  expect(await flags(candidate)).toEqual({ profile_completed: true, is_searchable: false });
  expect(await loadWizard(candidate)).toMatchObject({ ...AFTER_STEP5, ...STEP6 });
  expect(await employerSees()).toBe(0);
});

test('wyszukiwalność: tylko kompletny profil; pracodawca widzi go dopiero po opt-in', async () => {
  expect(await candidate.request((tx) => rpc<boolean>(tx, 'set_candidate_searchable', { p_searchable: true }))).toBe(true);
  expect(await flags(candidate)).toEqual({ profile_completed: true, is_searchable: true });
  expect(await employerSees()).toBe(1);
  // Inny kandydat nie przegląda profili (to widok firm zweryfikowanych).
  expect(rows(await incomplete.request((tx) => tx.query(
    'SELECT id FROM public.candidate_profiles WHERE id = $1', [candidateProfileId])))).toEqual([]);

  expect(await candidate.request((tx) => rpc<boolean>(tx, 'set_candidate_searchable', { p_searchable: false }))).toBe(false);
  expect(await employerSees()).toBe(0);
});

test('niekompletny profil: „Zakończ” → ONBOARDING_INCOMPLETE, dane kroku zostają, brak wyszukiwalności', async () => {
  expect(await saveStep(incomplete, 1, { firstName: 'Tom', lastName: 'Evans' })).toEqual({ ok: true });
  expect(await saveStep(incomplete, 2, { occupations: ['Cleaner'], categories: ['cleaning'] })).toEqual({ ok: true });
  // Krok 4 (miasto) pominięty — kompletność liczy baza, nie klient.
  expect(await saveStep(incomplete, 6, { availability: 'immediate', agreeTerms: true, privacyNoticeAck: true }, { finish: true }))
    .toEqual({ ok: false, error: 'ONBOARDING_INCOMPLETE' });
  expect(await loadWizard(incomplete)).toMatchObject({ occupations: ['Cleaner'], availability: 'immediate' });
  expect(await flags(incomplete)).toEqual({ profile_completed: false, is_searchable: false });
  await expectDomainError(incomplete.request((tx) => rpc(tx, 'set_candidate_searchable', { p_searchable: true })),
    'VALIDATION_FAILED');

  // Uzupełnienie brakującego kroku i ponowne „Zakończ” — teraz ukończony.
  expect(await saveStep(incomplete, 4, { city: 'Brussel', radiusKm: 10 })).toEqual({ ok: true });
  expect(await saveStep(incomplete, 6, { availability: 'immediate', agreeTerms: true, privacyNoticeAck: true }, { finish: true }))
    .toEqual({ ok: true });
  expect(await flags(incomplete)).toEqual({ profile_completed: true, is_searchable: false });
});
