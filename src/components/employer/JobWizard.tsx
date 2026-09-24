'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { useLocale, useTranslations } from 'next-intl';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Plus,
  Send,
  X,
} from 'lucide-react';

import { Link, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Stepper } from '@/components/ui/stepper';
import {
  CATEGORY_KEYS,
  CONTRACT_TYPES,
  LANGUAGE_LEVELS,
} from '@/lib/validation/candidate';
import {
  SALARY_PERIODS,
  step1Schema,
  step2Schema,
  step3Schema,
  step4Schema,
  step5Schema,
  step6Schema,
  step7Schema,
  step8Schema,
  step9DraftSchema,
  step9Schema,
  JOB_ITEM_LIMITS,
} from '@/lib/validation/job';
import type { CategoryKey, ContractType } from '@/lib/jobs';
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import {
  createJobDraft,
  publishJob,
  updateJobDraft,
  updatePublishedJob,
} from '@/lib/actions/jobs';

/**
 * JobWizard — kreator oferty pracy (Etap 5), 9 kroków z REALNYM zapisem wersji roboczej.
 *
 * Krok N jest walidowany `stepNSchema` (Zod — to samo źródło co po stronie serwera) i zapisywany
 * przez Server Action `updateJobDraft`. Szkic (`createJobDraft`) tworzony jest LENIWIE — dopiero
 * przy pierwszym udanym zapisie (brak śmieciowych szkiców z samego wejścia na stronę). „Dalej"
 * przechodzi po udanym zapisie; ostatni krok publikuje ofertę (`publishJob`).
 *
 * Invariant #11: blokada przycisków w trakcie zapisu, zachowanie danych po błędzie, błędy przy
 * polach, przewijanie do pierwszego błędu, jasny wskaźnik stanu (idle/saving/saved/error).
 * Publikacja wymaga firmy `verified` — `COMPANY_NOT_VERIFIED` pokazujemy jako czytelną informację
 * (szkic zostaje zapisany). Tryb DEMO (brak env): zapis nie trafia do DB, ale przepływ działa.
 *
 * Tryb edycji opublikowanej oferty (#325, prop `published`): kroki NIE zapisują się pojedynczo
 * (publiczna oferta byłaby mieszanką starej i nowej treści) — „Dalej" tylko waliduje krok, a
 * „Zapisz zmiany" waliduje wszystkie kroki i wysyła całość jednym wywołaniem
 * `updatePublishedJob` (transakcyjne RPC). Status oferty i zgłoszenia się nie zmieniają.
 */

const TOTAL_STEPS = 9;
type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

type LanguageLevel = (typeof LANGUAGE_LEVELS)[number];
type SalaryPeriod = (typeof SALARY_PERIODS)[number];
type Currency = 'EUR' | 'PLN';
const CURRENCIES: readonly Currency[] = ['EUR', 'PLN'];

interface LanguageEntry {
  language: string;
  level: LanguageLevel;
}

interface FormValues {
  // krok 1 — stanowisko
  title: string;
  category: '' | CategoryKey;
  occupation: string;
  // krok 2 — umowa i grafik
  contractType: '' | ContractType;
  workingHours: string;
  shifts: string;
  startImmediately: boolean;
  startDate: string;
  // krok 3 — lokalizacja
  city: string;
  region: string;
  address: string;
  remote: boolean;
  // krok 4 — wynagrodzenie
  salaryMin: string;
  salaryMax: string;
  currency: Currency;
  salaryPeriod: SalaryPeriod;
  // krok 5 — opis i obowiązki
  description: string;
  responsibilities: string[];
  // krok 6 — wymagania
  requirementsMandatory: string[];
  mandatorySkills: string[];
  minExperienceYears: string;
  // krok 7 — dodatkowe / języki
  requirementsOptional: string[];
  skills: string[];
  languages: LanguageEntry[];
  requiredCertificates: string[];
  requiresDrivingLicense: boolean;
  noLanguageRequired: boolean;
  // krok 8 — warunki i benefity
  conditions: string[];
  benefits: string[];
  accommodation: boolean;
  transport: boolean;
  // krok 9 — firma i publikacja
  companyDescription: string;
  contactEmail: string;
  agreePublish: boolean;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const DEFAULT_VALUES: FormValues = {
  title: '',
  category: '',
  occupation: '',
  contractType: '',
  workingHours: '',
  shifts: '',
  startImmediately: false,
  startDate: '',
  city: '',
  region: '',
  address: '',
  remote: false,
  salaryMin: '',
  salaryMax: '',
  currency: 'EUR',
  salaryPeriod: 'month',
  description: '',
  responsibilities: [],
  requirementsMandatory: [],
  mandatorySkills: [],
  minExperienceYears: '',
  requirementsOptional: [],
  skills: [],
  languages: [],
  requiredCertificates: [],
  requiresDrivingLicense: false,
  noLanguageRequired: false,
  conditions: [],
  benefits: [],
  accommodation: false,
  transport: false,
  companyDescription: '',
  contactEmail: '',
  agreePublish: false,
};

/** Pola należące do kroku (kolejność = kolejność przewijania do pierwszego błędu). */
const STEP_FIELDS: Record<WizardStep, (keyof FormValues)[]> = {
  1: ['title', 'category', 'occupation'],
  2: ['contractType', 'workingHours', 'shifts', 'startDate'],
  3: ['city', 'region', 'address'],
  4: ['salaryMin', 'salaryMax', 'currency', 'salaryPeriod'],
  5: ['description', 'responsibilities'],
  6: ['requirementsMandatory', 'mandatorySkills', 'minExperienceYears'],
  7: ['requirementsOptional', 'skills', 'languages', 'requiredCertificates'],
  8: ['conditions', 'benefits'],
  9: ['companyDescription', 'contactEmail', 'agreePublish'],
};

const SCHEMAS = {
  1: step1Schema,
  2: step2Schema,
  3: step3Schema,
  4: step4Schema,
  5: step5Schema,
  6: step6Schema,
  7: step7Schema,
  8: step8Schema,
  9: step9Schema,
} as const;

/** Pola list (ChipInput) → maksymalna długość jednej pozycji (#364, zgodna z walidacją Zod). */
type ChipField =
  | 'responsibilities'
  | 'requirementsMandatory'
  | 'mandatorySkills'
  | 'requirementsOptional'
  | 'skills'
  | 'requiredCertificates'
  | 'conditions'
  | 'benefits';
const ITEM_MAX: Record<ChipField, number> = {
  responsibilities: JOB_ITEM_LIMITS.line,
  requirementsMandatory: JOB_ITEM_LIMITS.requirement,
  mandatorySkills: JOB_ITEM_LIMITS.skill,
  requirementsOptional: JOB_ITEM_LIMITS.requirement,
  skills: JOB_ITEM_LIMITS.skill,
  requiredCertificates: JOB_ITEM_LIMITS.certificate,
  conditions: JOB_ITEM_LIMITS.line,
  benefits: JOB_ITEM_LIMITS.line,
};

function domId(field: keyof FormValues): string {
  return `job-${field}`;
}

/** '' → undefined (pole opcjonalne / z wartością domyślną w schemacie). */
function toOptionalNumber(value: string): number | undefined {
  return value.trim() === '' ? undefined : Number(value);
}

/** '' → undefined (pole tekstowe opcjonalne). */
function toOptionalText(value: string): string | undefined {
  return value.trim() === '' ? undefined : value;
}

/** Buduje obiekt danych kroku zgodny z odpowiednim `stepNSchema`. */
function buildStepData(step: WizardStep, v: FormValues): unknown {
  switch (step) {
    case 1:
      return { title: v.title, category: v.category, occupation: v.occupation };
    case 2:
      return {
        contractType: v.contractType,
        workingHours: v.workingHours,
        shifts: toOptionalText(v.shifts),
        startImmediately: v.startImmediately,
        startDate: toOptionalText(v.startDate),
      };
    case 3:
      return { city: v.city, region: v.region, address: toOptionalText(v.address), remote: v.remote };
    case 4:
      return {
        salaryMin: toOptionalNumber(v.salaryMin),
        salaryMax: toOptionalNumber(v.salaryMax),
        currency: v.currency,
        salaryPeriod: v.salaryPeriod,
      };
    case 5:
      return { description: v.description, responsibilities: v.responsibilities };
    case 6:
      return {
        requirementsMandatory: v.requirementsMandatory,
        mandatorySkills: v.mandatorySkills,
        minExperienceYears: toOptionalNumber(v.minExperienceYears),
      };
    case 7:
      return {
        requirementsOptional: v.requirementsOptional,
        skills: v.skills,
        languages: v.languages,
        requiredCertificates: v.requiredCertificates,
        requiresDrivingLicense: v.requiresDrivingLicense,
        noLanguageRequired: v.noLanguageRequired,
      };
    case 8:
      return {
        conditions: v.conditions,
        benefits: v.benefits,
        accommodation: v.accommodation,
        transport: v.transport,
      };
    case 9:
      return {
        companyDescription: v.companyDescription,
        contactEmail: toOptionalText(v.contactEmail),
        agreePublish: v.agreePublish,
      };
  }
}

/** Zamienia komunikat błędu z Zod na klucz i18n (fallback dla domyślnych komunikatów enum). */
function toErrorKey(field: string, message: string): string {
  if (message.startsWith('job.error.')) return message;
  if (field === 'category') return 'job.error.categoryRequired';
  if (field === 'contractType') return 'job.error.contractTypeRequired';
  if (field === 'agreePublish') return 'job.error.publishAgreementRequired';
  return 'job.error.invalid';
}

/**
 * Wartości wejściowe wznawianego szkicu (P1-04). Pola enumeryczne przyjmujemy jako `string`
 * (surowe z DB) i ZAWĘŻAMY tutaj wg tych samych allow-list, których używa walidacja kroków —
 * kreator jest właścicielem tych unii, więc konwersja DB→UI ma jedno miejsce.
 */
export interface JobWizardInitialValues
  extends Omit<
    Partial<FormValues>,
    'category' | 'contractType' | 'currency' | 'salaryPeriod' | 'languages'
  > {
  category?: string;
  contractType?: string;
  currency?: string;
  salaryPeriod?: string;
  languages?: { language: string; level: string }[];
}

export interface JobWizardProps {
  /**
   * P1-04: wznowienie ISTNIEJĄCEGO szkicu — id oferty i zapisane wartości z DB. Bez nich kreator
   * tworzy nowy szkic przy pierwszym zapisie (dotychczasowe zachowanie „nowa oferta").
   */
  initialJobId?: string;
  initialValues?: JobWizardInitialValues;
  /**
   * #325: oferta już opublikowana (aktywna/wstrzymana) — kreator w trybie edycji. `updatedAt`
   * = wczytana wersja (ochrona przed cichym nadpisaniem równoległej poprawki).
   */
  published?: { status: 'active' | 'paused'; slug: string; updatedAt: string };
}

/** Zawężenie surowych wartości z DB do unii formularza (nieznane wartości → domyślne/puste). */
function narrowInitialValues(raw?: JobWizardInitialValues): Partial<FormValues> {
  if (!raw) return {};
  const { category, contractType, currency, salaryPeriod, languages, ...rest } = raw;
  const narrowed: Partial<FormValues> = { ...rest };
  if (category && (CATEGORY_KEYS as readonly string[]).includes(category)) {
    narrowed.category = category as CategoryKey;
  }
  if (contractType && (CONTRACT_TYPES as readonly string[]).includes(contractType)) {
    narrowed.contractType = contractType as ContractType;
  }
  if (currency === 'EUR' || currency === 'PLN') narrowed.currency = currency;
  if (salaryPeriod && (SALARY_PERIODS as readonly string[]).includes(salaryPeriod)) {
    narrowed.salaryPeriod = salaryPeriod as SalaryPeriod;
  }
  if (languages) {
    narrowed.languages = languages
      .filter((l) => l.language.trim() !== '')
      .map((l) => ({
        language: l.language,
        level: ((LANGUAGE_LEVELS as readonly string[]).includes(l.level)
          ? l.level
          : 'basic') as LanguageLevel,
      }));
  }
  return narrowed;
}

export function JobWizard({
  initialJobId,
  initialValues,
  published,
}: JobWizardProps = {}): React.JSX.Element {
  const t = useTranslations('jobWizard');
  const tRoot = useTranslations();
  const tn = useTranslations('nav');
  const tCat = useTranslations('categories');
  const tContract = useTranslations('contractTypes');
  const locale = useLocale();
  const router = useRouter();

  const {
    register,
    watch,
    getValues,
    setValue,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<FormValues>({
    // Wznowienie szkicu: zapisane wartości nadpisują domyślne (pola nieuzupełnione zostają puste).
    defaultValues: { ...DEFAULT_VALUES, ...narrowInitialValues(initialValues) },
    mode: 'onSubmit',
  });

  const values = watch();

  const [step, setStep] = React.useState<WizardStep>(1);
  const [jobId, setJobId] = React.useState<string | null>(initialJobId ?? null);
  const [saveState, setSaveState] = React.useState<SaveState>('idle');
  // #363: kod błędu z serwera → własny komunikat (zamiast zawsze „Nie udało się zapisać”).
  const [saveError, setSaveError] = React.useState<ErrorCode | null>(null);
  // #402: po zmianie kroku fokus na nagłówku nowego kroku + komunikat dla czytnika ekranu
  // (ten sam wzorzec co onboarding kandydata, #323).
  const stepHeadingRef = React.useRef<HTMLHeadingElement>(null);
  const isFirstRenderRef = React.useRef(true);
  const [stepAnnouncement, setStepAnnouncement] = React.useState('');
  const [demo, setDemo] = React.useState(false);
  const [badgeVisible, setBadgeVisible] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const [publishError, setPublishError] = React.useState<ErrorCode | null>(null);
  // #325: tryb edycji opublikowanej oferty.
  const isEdit = Boolean(published && initialJobId);
  const [editVersion, setEditVersion] = React.useState<string | null>(published?.updatedAt || null);
  const [publicSlug, setPublicSlug] = React.useState(published?.slug ?? '');
  // Krok z błędami wykryty przy „Zapisz zmiany" (komunikat nad formularzem).
  const [editInvalidStep, setEditInvalidStep] = React.useState<WizardStep | null>(null);
  const pendingErrorsRef = React.useRef<Set<string> | null>(null);
  // Tryb edycji: po zapisie każda kolejna zmiana pola znów jest niezapisana — komunikat
  // „Zmiany zapisane" nie może wisieć nad nową, niewysłaną treścią.
  React.useEffect(() => {
    if (!isEdit || saveState !== 'saved') return;
    const sub = watch(() => setSaveState('idle'));
    return () => sub.unsubscribe();
  }, [isEdit, saveState, watch]);
  const showViewLink =
    isEdit && published?.status === 'active' && publicSlug !== '' && !publicSlug.startsWith('draft-');

  // Roboczy wiersz dodawania języka (relacja — nieutrwalana w tej iteracji, TODO(data)).
  const [langDraft, setLangDraft] = React.useState('');
  const [levelDraft, setLevelDraft] = React.useState<LanguageLevel>('basic');
  const [langError, setLangError] = React.useState(false);

  const LEVEL_LABEL: Record<LanguageLevel, string> = {
    basic: t('levelBasic'),
    intermediate: t('levelIntermediate'),
    fluent: t('levelFluent'),
    native: t('levelNative'),
  };
  const PERIOD_LABEL: Record<SalaryPeriod, string> = {
    hour: t('periodHour'),
    month: t('periodMonth'),
    year: t('periodYear'),
  };

  const steps = [
    { title: t('step1Title'), desc: t('step1Sub') },
    { title: t('step2Title'), desc: t('step2Sub') },
    { title: t('step3Title'), desc: t('step3Sub') },
    { title: t('step4Title'), desc: t('step4Sub') },
    { title: t('step5Title'), desc: t('step5Sub') },
    { title: t('step6Title'), desc: t('step6Sub') },
    { title: t('step7Title'), desc: t('step7Sub') },
    { title: t('step8Title'), desc: t('step8Sub') },
    { title: t('step9Title'), desc: t('step9Sub') },
  ];

  const busy = saveState === 'saving' || publishing;

  React.useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    // Przejście do kroku z błędami po „Zapisz zmiany": fokus na pierwszym błędnym polu.
    const pending = pendingErrorsRef.current;
    pendingErrorsRef.current = null;
    if (pending) scrollToFirstError(step, pending);
    else stepHeadingRef.current?.focus();
    setStepAnnouncement(
      t('stepAnnounce', { current: step, total: steps.length, title: steps[step - 1]?.title ?? '' }),
    );
    // Reaguje wyłącznie na zmianę kroku; tytuły kroków są stałe w obrębie locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function scrollToFirstError(current: WizardStep, erroredFields: Set<string>): void {
    const first = STEP_FIELDS[current].find((f) => erroredFields.has(f));
    if (!first) return;
    const container = document.getElementById(domId(first));
    const el = container?.matches('input, textarea, button, [role="combobox"], [role="checkbox"]')
      ? container
      : container?.querySelector<HTMLElement>(
          'input, textarea, [role="combobox"], [role="checkbox"]',
        );
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (el as HTMLElement).focus();
    }
  }

  /**
   * Waliduje i zapisuje bieżący krok (tworzy szkic przy pierwszym zapisie). Zwraca true.
   * `intent='publish'` dokłada w kroku 9 wymóg zgody na publikację; zwykły zapis szkicu
   * („Zapisz i wyjdź") jej nie wymaga (#193).
   */
  /**
   * Waliduje krok i oznacza błędy przy polach. Zwraca dane kroku albo zbiór błędnych pól
   * (przewijanie do pierwszego błędu robi wywołujący — krok może nie być wyrenderowany).
   */
  function validateStep(
    current: WizardStep,
    intent: 'draft' | 'publish',
  ): { ok: true; data: unknown } | { ok: false; erroredFields: Set<string> } {
    clearErrors(STEP_FIELDS[current]);
    const data = buildStepData(current, getValues());
    const schema = current === 9 && intent === 'draft' ? step9DraftSchema : SCHEMAS[current];
    const result = schema.safeParse(data);

    if (!result.success) {
      const erroredFields = new Set<string>();
      for (const issue of result.error.issues) {
        const field = String(issue.path[0] ?? '');
        // Zod zgłasza wszystkie niespełnione reguły pola (np. „wymagane" i „za krótkie" dla ''),
        // a pierwsza jest najtrafniejsza — kolejne nie mogą jej nadpisać (#367).
        if (!field || erroredFields.has(field)) continue;
        erroredFields.add(field);
        if ((STEP_FIELDS[current] as string[]).includes(field)) {
          setError(field as keyof FormValues, {
            type: 'validate',
            message: toErrorKey(field, issue.message),
          });
        }
      }
      return { ok: false, erroredFields };
    }
    return { ok: true, data };
  }

  async function persistStep(
    current: WizardStep,
    intent: 'draft' | 'publish' = 'draft',
  ): Promise<boolean> {
    const checked = validateStep(current, intent);
    if (!checked.ok) {
      setSaveState('idle');
      scrollToFirstError(current, checked.erroredFields);
      return false;
    }
    const data = checked.data;

    setSaveError(null);
    setSaveState('saving');
    try {
      let id = jobId;
      if (!id) {
        const created = await createJobDraft(locale);
        if (!created.ok) {
          setSaveError(created.error);
          setSaveState('error');
          return false;
        }
        id = created.id;
        setJobId(id);
        if (created.demo) setDemo(true);
      }

      const res = await updateJobDraft(id, current, data);
      if (!res.ok) {
        setSaveError(res.error);
        setSaveState('error');
        return false;
      }
      if (res.demo) setDemo(true);
      setSaveState('saved');
      setBadgeVisible(true);
      return true;
    } catch {
      setSaveError('INTERNAL');
      setSaveState('error');
      return false;
    }
  }

  async function handleNext(): Promise<void> {
    if (isEdit) {
      // Tryb edycji: krok tylko walidujemy — zapis całości przyciskiem „Zapisz zmiany".
      const checked = validateStep(step, 'draft');
      if (!checked.ok) {
        scrollToFirstError(step, checked.erroredFields);
        return;
      }
      if (editInvalidStep === step) setEditInvalidStep(null);
      if (step < TOTAL_STEPS) setStep((step + 1) as WizardStep);
      return;
    }
    const ok = await persistStep(step);
    if (ok && step < TOTAL_STEPS) setStep((step + 1) as WizardStep);
  }

  /** #325: waliduje wszystkie kroki i zapisuje całą treść opublikowanej oferty naraz. */
  async function handleSaveChanges(): Promise<void> {
    if (!initialJobId) return;
    setSaveError(null);
    setEditInvalidStep(null);
    const stepsData: unknown[] = [];
    for (let i = 1; i <= TOTAL_STEPS; i += 1) {
      const current = i as WizardStep;
      const checked = validateStep(current, 'draft');
      if (!checked.ok) {
        setSaveState('idle');
        setEditInvalidStep(current);
        if (current === step) {
          scrollToFirstError(current, checked.erroredFields);
        } else {
          pendingErrorsRef.current = checked.erroredFields;
          setStep(current);
        }
        return;
      }
      stepsData.push(checked.data);
    }

    setSaveState('saving');
    try {
      const res = await updatePublishedJob(initialJobId, stepsData, editVersion);
      if (!res.ok) {
        setSaveError(res.error);
        setSaveState('error');
        return;
      }
      if (res.demo) setDemo(true);
      if (res.updatedAt) setEditVersion(res.updatedAt);
      if (res.slug) setPublicSlug(res.slug);
      setSaveState('saved');
    } catch {
      setSaveError('INTERNAL');
      setSaveState('error');
    }
  }

  function handleBack(): void {
    if (step <= 1) return;
    clearErrors();
    setPublishError(null);
    setSaveError(null);
    setSaveState('idle');
    setStep((step - 1) as WizardStep);
  }

  async function handleSaveExit(): Promise<void> {
    const ok = await persistStep(step);
    if (ok) router.push('/employer');
  }

  async function handlePublish(): Promise<void> {
    setPublishError(null);
    const ok = await persistStep(9, 'publish');
    if (!ok) return;

    const id = jobId;
    if (!id) {
      setPublishError('INTERNAL');
      return;
    }

    setPublishing(true);
    try {
      const res = await publishJob(id);
      if (!res.ok) {
        setPublishError(res.error);
        return;
      }
      router.push('/employer');
    } catch {
      setPublishError('INTERNAL');
    } finally {
      setPublishing(false);
    }
  }

  function FieldError({ name }: { name: keyof FormValues }): React.JSX.Element | null {
    const message = errors[name]?.message;
    if (!message) return null;
    return (
      <p id={`${domId(name)}-error`} className="text-sm text-error">
        {tRoot(String(message))}
      </p>
    );
  }

  function errorDescription(name: keyof FormValues): string | undefined {
    return errors[name] ? `${domId(name)}-error` : undefined;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-8 sm:space-y-6">
      {/* Nagłówek + znacznik zapisu */}
      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between sm:pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {isEdit ? t('editTitle') : t('title')}
          </h1>
          <p className="mt-2 max-w-2xl text-base leading-relaxed text-muted-foreground">
            {isEdit
              ? published?.status === 'paused'
                ? t('editSubtitlePaused')
                : t('editSubtitleActive')
              : t('subtitle')}
          </p>
          {showViewLink ? (
            <Link
              href={`/oferty-pracy/${publicSlug}`}
              className="mt-3 inline-flex text-sm font-medium text-foreground underline underline-offset-2 hover:text-primary"
            >
              {t('viewOffer')}
            </Link>
          ) : null}
        </div>
        {/* Bez `role="status"`: stan zapisu ogłasza jeden region — SaveIndicator w stopce (#402). */}
        {!isEdit && saveState === 'saved' && badgeVisible ? (
          <div
            className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg border border-success/30 bg-success/5 px-3 py-2"
          >
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
            <span className="text-sm font-medium text-foreground">
              {demo ? t('savedDemo') : t('saved')}
            </span>
            <button
              type="button"
              onClick={() => setBadgeVisible(false)}
              aria-label={tn('close')}
              className="-mr-1 inline-flex min-h-6 min-w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>

      {/* Stepper */}
      <Stepper
        steps={steps}
        current={step - 1}
        progressLabel={t('stepProgress', { current: step, total: steps.length })}
        className="rounded-[1.75rem] border border-border bg-card p-5 shadow-sm sm:p-7"
      />

      {isEdit && editInvalidStep !== null ? (
        <p
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-error/40 bg-error/5 p-3 text-sm font-medium text-foreground"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-error" aria-hidden="true" />
          {t('editFixStep', { step: editInvalidStep, title: steps[editInvalidStep - 1]?.title ?? '' })}
        </p>
      ) : null}

      {/* Formularz bieżącego kroku */}
      <section className="min-w-0 rounded-[1.75rem] border border-border border-t-4 border-t-primary bg-card p-5 shadow-sm sm:p-8">
        <h2
          ref={stepHeadingRef}
          tabIndex={-1}
          className="text-xl font-semibold tracking-tight text-foreground focus:outline-none sm:text-2xl"
        >
          {steps[step - 1]?.title}
        </h2>
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {stepAnnouncement}
        </p>
        <p className="mt-1 text-base leading-relaxed text-muted-foreground">{steps[step - 1]?.desc}</p>

        <form
          className="mt-6 [&_input]:min-h-12 [&_textarea]:text-base [&_[role=combobox]]:min-h-12"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (step < TOTAL_STEPS) void handleNext();
          }}
        >
          {step === 1 ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor={domId('title')}>{t('titleLabel')}</Label>
                <Input
                  id={domId('title')}
                  placeholder={t('titlePlaceholder')}
                  aria-invalid={errors.title ? true : undefined}
                  aria-describedby={errorDescription('title')}
                  {...register('title')}
                />
                <FieldError name="title" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div id={domId('category')} className="space-y-1.5">
                  <Label htmlFor="job-category-trigger">{t('categoryLabel')}</Label>
                  <Select
                    value={values.category || undefined}
                    onValueChange={(val) => setValue('category', val as CategoryKey, { shouldDirty: true })}
                  >
                    <SelectTrigger
                      id="job-category-trigger"
                      aria-invalid={errors.category ? true : undefined}
                      aria-describedby={errorDescription('category')}
                    >
                      <SelectValue placeholder={t('categoryPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORY_KEYS.map((key) => (
                        <SelectItem key={key} value={key}>
                          {tCat(key)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError name="category" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={domId('occupation')}>{t('occupationLabel')}</Label>
                  <Input
                    id={domId('occupation')}
                    placeholder={t('occupationPlaceholder')}
                    aria-invalid={errors.occupation ? true : undefined}
                    aria-describedby={errorDescription('occupation')}
                    {...register('occupation')}
                  />
                  <FieldError name="occupation" />
                </div>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div id={domId('contractType')} className="space-y-1.5">
                  <Label htmlFor="job-contract-trigger">{t('contractTypeLabel')}</Label>
                  <Select
                    value={values.contractType || undefined}
                    onValueChange={(val) =>
                      setValue('contractType', val as ContractType, { shouldDirty: true })
                    }
                  >
                    <SelectTrigger
                      id="job-contract-trigger"
                      aria-invalid={errors.contractType ? true : undefined}
                      aria-describedby={errorDescription('contractType')}
                    >
                      <SelectValue placeholder={t('contractTypePlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTRACT_TYPES.map((ct) => (
                        <SelectItem key={ct} value={ct}>
                          {tContract(ct)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError name="contractType" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={domId('workingHours')}>{t('workingHoursLabel')}</Label>
                  <Input
                    id={domId('workingHours')}
                    placeholder={t('workingHoursPlaceholder')}
                    aria-invalid={errors.workingHours ? true : undefined}
                    aria-describedby={errorDescription('workingHours')}
                    {...register('workingHours')}
                  />
                  <FieldError name="workingHours" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={domId('shifts')}>{t('shiftsLabel')}</Label>
                  <Input
                    id={domId('shifts')}
                    placeholder={t('shiftsPlaceholder')}
                    aria-invalid={errors.shifts ? true : undefined}
                    aria-describedby={errorDescription('shifts')}
                    {...register('shifts')}
                  />
                  <FieldError name="shifts" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={domId('startDate')}>{t('startDateLabel')}</Label>
                  <Input
                    id={domId('startDate')}
                    type="date"
                    aria-invalid={errors.startDate ? true : undefined}
                    aria-describedby={errorDescription('startDate')}
                    {...register('startDate')}
                  />
                  <FieldError name="startDate" />
                </div>
              </div>
              <CheckboxField
                id={domId('startImmediately')}
                label={t('startImmediately')}
                checked={values.startImmediately}
                onChange={(c) => setValue('startImmediately', c, { shouldDirty: true })}
              />
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={domId('city')}>{t('cityLabel')}</Label>
                  <Input
                    id={domId('city')}
                    placeholder={t('cityPlaceholder')}
                    autoComplete="address-level2"
                    aria-invalid={errors.city ? true : undefined}
                    aria-describedby={errorDescription('city')}
                    {...register('city')}
                  />
                  <FieldError name="city" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={domId('region')}>{t('regionLabel')}</Label>
                  <Input
                    id={domId('region')}
                    placeholder={t('regionPlaceholder')}
                    aria-invalid={errors.region ? true : undefined}
                    aria-describedby={errorDescription('region')}
                    {...register('region')}
                  />
                  <FieldError name="region" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={domId('address')}>{t('addressLabel')}</Label>
                  <Input
                    id={domId('address')}
                    placeholder={t('addressPlaceholder')}
                    aria-invalid={errors.address ? true : undefined}
                    aria-describedby={errorDescription('address')}
                    {...register('address')}
                  />
                  <FieldError name="address" />
                </div>
              </div>
              <CheckboxField
                id={domId('remote')}
                label={t('remote')}
                checked={values.remote}
                onChange={(c) => setValue('remote', c, { shouldDirty: true })}
              />
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={domId('salaryMin')}>{t('salaryMinLabel')}</Label>
                  <Input
                    id={domId('salaryMin')}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    aria-invalid={errors.salaryMin ? true : undefined}
                    aria-describedby={errorDescription('salaryMin')}
                    {...register('salaryMin')}
                  />
                  <FieldError name="salaryMin" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={domId('salaryMax')}>{t('salaryMaxLabel')}</Label>
                  <Input
                    id={domId('salaryMax')}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    aria-invalid={errors.salaryMax ? true : undefined}
                    aria-describedby={errorDescription('salaryMax')}
                    {...register('salaryMax')}
                  />
                  <FieldError name="salaryMax" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="job-currency-trigger">{t('currencyLabel')}</Label>
                  <Select
                    value={values.currency}
                    onValueChange={(val) => setValue('currency', val as Currency, { shouldDirty: true })}
                  >
                    <SelectTrigger id="job-currency-trigger">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="job-period-trigger">{t('salaryPeriodLabel')}</Label>
                  <Select
                    value={values.salaryPeriod}
                    onValueChange={(val) =>
                      setValue('salaryPeriod', val as SalaryPeriod, { shouldDirty: true })
                    }
                  >
                    <SelectTrigger id="job-period-trigger">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SALARY_PERIODS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {PERIOD_LABEL[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t('salaryHint')}</p>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="space-y-6">
              <div className="space-y-1.5">
                <Label htmlFor={domId('description')}>{t('descriptionLabel')}</Label>
                <Textarea
                  id={domId('description')}
                  rows={6}
                  placeholder={t('descriptionPlaceholder')}
                  aria-invalid={errors.description ? true : undefined}
                  aria-describedby={errorDescription('description')}
                  {...register('description')}
                />
                <FieldError name="description" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={domId('responsibilities')}>{t('responsibilitiesLabel')}</Label>
                <ChipInput
                  id={domId('responsibilities')}
                  maxItemLength={ITEM_MAX.responsibilities}
                  tooLongLabel={t('itemTooLongMax', { max: ITEM_MAX.responsibilities })}
                  values={values.responsibilities}
                  onChange={(next) => setValue('responsibilities', next, { shouldDirty: true })}
                  placeholder={t('responsibilitiesPlaceholder')}
                  addLabel={t('add')}
                  removeLabel={t('remove')}
                  invalid={Boolean(errors.responsibilities)}
                  errorDescription={errorDescription('responsibilities')}
                />
                <p className="text-xs text-muted-foreground">{t('responsibilitiesHint')}</p>
                <FieldError name="responsibilities" />
              </div>
            </div>
          ) : null}

          {step === 6 ? (
            <div className="space-y-6">
              <div className="space-y-1.5">
                <Label htmlFor={domId('requirementsMandatory')}>
                  {t('requirementsMandatoryLabel')}
                </Label>
                <ChipInput
                  id={domId('requirementsMandatory')}
                  maxItemLength={ITEM_MAX.requirementsMandatory}
                  tooLongLabel={t('itemTooLongMax', { max: ITEM_MAX.requirementsMandatory })}
                  values={values.requirementsMandatory}
                  onChange={(next) => setValue('requirementsMandatory', next, { shouldDirty: true })}
                  placeholder={t('requirementsMandatoryPlaceholder')}
                  addLabel={t('add')}
                  removeLabel={t('remove')}
                  invalid={Boolean(errors.requirementsMandatory)}
                  errorDescription={errorDescription('requirementsMandatory')}
                />
                <FieldError name="requirementsMandatory" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={domId('mandatorySkills')}>{t('mandatorySkillsLabel')}</Label>
                <ChipInput
                  id={domId('mandatorySkills')}
                  maxItemLength={ITEM_MAX.mandatorySkills}
                  tooLongLabel={t('itemTooLongMax', { max: ITEM_MAX.mandatorySkills })}
                  values={values.mandatorySkills}
                  onChange={(next) => setValue('mandatorySkills', next, { shouldDirty: true })}
                  placeholder={t('mandatorySkillsPlaceholder')}
                  addLabel={t('add')}
                  removeLabel={t('remove')}
                  invalid={Boolean(errors.mandatorySkills)}
                  errorDescription={errorDescription('mandatorySkills')}
                />
                <FieldError name="mandatorySkills" />
              </div>
              <div className="space-y-1.5 sm:max-w-xs">
                <Label htmlFor={domId('minExperienceYears')}>{t('minExperienceLabel')}</Label>
                <Input
                  id={domId('minExperienceYears')}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={60}
                  aria-invalid={errors.minExperienceYears ? true : undefined}
                  aria-describedby={errorDescription('minExperienceYears')}
                  {...register('minExperienceYears')}
                />
                <p className="text-xs text-muted-foreground">{t('minExperienceHint')}</p>
                <FieldError name="minExperienceYears" />
              </div>
            </div>
          ) : null}

          {step === 7 ? (
            <div className="space-y-6">
              <div className="space-y-1.5">
                <Label htmlFor={domId('requirementsOptional')}>
                  {t('requirementsOptionalLabel')}
                </Label>
                <ChipInput
                  id={domId('requirementsOptional')}
                  maxItemLength={ITEM_MAX.requirementsOptional}
                  tooLongLabel={t('itemTooLongMax', { max: ITEM_MAX.requirementsOptional })}
                  values={values.requirementsOptional}
                  onChange={(next) => setValue('requirementsOptional', next, { shouldDirty: true })}
                  placeholder={t('requirementsOptionalPlaceholder')}
                  addLabel={t('add')}
                  removeLabel={t('remove')}
                  invalid={Boolean(errors.requirementsOptional)}
                  errorDescription={errorDescription('requirementsOptional')}
                />
                <FieldError name="requirementsOptional" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={domId('skills')}>{t('skillsLabel')}</Label>
                <ChipInput
                  id={domId('skills')}
                  maxItemLength={ITEM_MAX.skills}
                  tooLongLabel={t('itemTooLongMax', { max: ITEM_MAX.skills })}
                  values={values.skills}
                  onChange={(next) => setValue('skills', next, { shouldDirty: true })}
                  placeholder={t('skillsPlaceholder')}
                  addLabel={t('add')}
                  removeLabel={t('remove')}
                  invalid={Boolean(errors.skills)}
                  errorDescription={errorDescription('skills')}
                />
                <FieldError name="skills" />
              </div>

              <div id={domId('languages')} className="space-y-2">
                <Label htmlFor="job-language-draft">{t('languagesLabel')}</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="job-language-draft"
                    className="flex-1"
                    value={langDraft}
                    placeholder={t('languageNamePlaceholder')}
                    aria-invalid={langError || errors.languages ? true : undefined}
                    aria-describedby={
                      langError ? 'job-language-draft-error' : errorDescription('languages')
                    }
                    onChange={(e) => {
                      setLangDraft(e.target.value);
                      if (langError) setLangError(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addLanguage();
                      }
                    }}
                  />
                  <div className="w-full sm:w-48">
                    <Select value={levelDraft} onValueChange={(val) => setLevelDraft(val as LanguageLevel)}>
                      <SelectTrigger aria-label={LEVEL_LABEL[levelDraft]}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LANGUAGE_LEVELS.map((lvl) => (
                          <SelectItem key={lvl} value={lvl}>
                            {LEVEL_LABEL[lvl]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="button" variant="outline" onClick={addLanguage}>
                    {t('addLanguage')}
                  </Button>
                </div>
                {langError ? (
                  <p id="job-language-draft-error" className="text-sm text-error">
                    {tRoot('candidate.error.languageInvalid')}
                  </p>
                ) : null}
                {values.languages.length > 0 ? (
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {values.languages.map((entry) => (
                      <li
                        key={entry.language}
                        className="inline-flex items-center gap-1.5 rounded-md border border-input bg-soft px-2.5 py-1 text-sm text-foreground"
                      >
                        {entry.language} · {LEVEL_LABEL[entry.level]}
                        <button
                          type="button"
                          aria-label={`${t('remove')}: ${entry.language}`}
                          onClick={() =>
                            setValue(
                              'languages',
                              values.languages.filter((l) => l.language !== entry.language),
                              { shouldDirty: true },
                            )
                          }
                          className="inline-flex min-h-6 min-w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <FieldError name="languages" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={domId('requiredCertificates')}>{t('certificatesLabel')}</Label>
                <ChipInput
                  id={domId('requiredCertificates')}
                  maxItemLength={ITEM_MAX.requiredCertificates}
                  tooLongLabel={t('itemTooLongMax', { max: ITEM_MAX.requiredCertificates })}
                  values={values.requiredCertificates}
                  onChange={(next) => setValue('requiredCertificates', next, { shouldDirty: true })}
                  placeholder={t('certificatesPlaceholder')}
                  addLabel={t('add')}
                  removeLabel={t('remove')}
                  invalid={Boolean(errors.requiredCertificates)}
                  errorDescription={errorDescription('requiredCertificates')}
                />
                <FieldError name="requiredCertificates" />
              </div>

              <div className="space-y-3">
                <CheckboxField
                  id={domId('requiresDrivingLicense')}
                  label={t('requiresDrivingLicense')}
                  checked={values.requiresDrivingLicense}
                  onChange={(c) => setValue('requiresDrivingLicense', c, { shouldDirty: true })}
                />
                <CheckboxField
                  id={domId('noLanguageRequired')}
                  label={t('noLanguageRequired')}
                  checked={values.noLanguageRequired}
                  onChange={(c) => setValue('noLanguageRequired', c, { shouldDirty: true })}
                />
              </div>
            </div>
          ) : null}

          {step === 8 ? (
            <div className="space-y-6">
              <div className="space-y-1.5">
                <Label htmlFor={domId('conditions')}>{t('conditionsLabel')}</Label>
                <ChipInput
                  id={domId('conditions')}
                  maxItemLength={ITEM_MAX.conditions}
                  tooLongLabel={t('itemTooLongMax', { max: ITEM_MAX.conditions })}
                  values={values.conditions}
                  onChange={(next) => setValue('conditions', next, { shouldDirty: true })}
                  placeholder={t('conditionsPlaceholder')}
                  addLabel={t('add')}
                  removeLabel={t('remove')}
                  invalid={Boolean(errors.conditions)}
                  errorDescription={errorDescription('conditions')}
                />
                <FieldError name="conditions" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={domId('benefits')}>{t('benefitsLabel')}</Label>
                <ChipInput
                  id={domId('benefits')}
                  maxItemLength={ITEM_MAX.benefits}
                  tooLongLabel={t('itemTooLongMax', { max: ITEM_MAX.benefits })}
                  values={values.benefits}
                  onChange={(next) => setValue('benefits', next, { shouldDirty: true })}
                  placeholder={t('benefitsPlaceholder')}
                  addLabel={t('add')}
                  removeLabel={t('remove')}
                  invalid={Boolean(errors.benefits)}
                  errorDescription={errorDescription('benefits')}
                />
                <FieldError name="benefits" />
              </div>
              <div className="space-y-3">
                <CheckboxField
                  id={domId('accommodation')}
                  label={t('accommodation')}
                  checked={values.accommodation}
                  onChange={(c) => setValue('accommodation', c, { shouldDirty: true })}
                />
                <CheckboxField
                  id={domId('transport')}
                  label={t('transport')}
                  checked={values.transport}
                  onChange={(c) => setValue('transport', c, { shouldDirty: true })}
                />
              </div>
            </div>
          ) : null}

          {step === 9 ? (
            <div className="space-y-6">
              <div className="space-y-1.5">
                <Label htmlFor={domId('companyDescription')}>{t('companyDescriptionLabel')}</Label>
                <Textarea
                  id={domId('companyDescription')}
                  rows={5}
                  placeholder={t('companyDescriptionPlaceholder')}
                  aria-invalid={errors.companyDescription ? true : undefined}
                  aria-describedby={errorDescription('companyDescription')}
                  {...register('companyDescription')}
                />
                <FieldError name="companyDescription" />
              </div>
              <div className="space-y-1.5 sm:max-w-md">
                <Label htmlFor={domId('contactEmail')}>{t('contactEmailLabel')}</Label>
                <Input
                  id={domId('contactEmail')}
                  type="email"
                  placeholder={t('contactEmailPlaceholder')}
                  aria-invalid={errors.contactEmail ? true : undefined}
                  aria-describedby={errorDescription('contactEmail')}
                  {...register('contactEmail')}
                />
                <FieldError name="contactEmail" />
              </div>

              {/* Podgląd oferty */}
              <div className="rounded-2xl border border-border bg-soft p-5 sm:p-6">
                <h3 className="text-base font-semibold text-foreground">{t('previewTitle')}</h3>
                <p className="mt-0.5 text-sm text-muted-foreground">{t('previewNote')}</p>
                <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  <PreviewRow label={t('titleLabel')} value={values.title} empty={t('previewNothing')} />
                  <PreviewRow
                    label={t('categoryLabel')}
                    value={values.category ? tCat(values.category) : ''}
                    empty={t('previewNothing')}
                  />
                  <PreviewRow
                    label={t('occupationLabel')}
                    value={values.occupation}
                    empty={t('previewNothing')}
                  />
                  <PreviewRow
                    label={t('contractTypeLabel')}
                    value={values.contractType ? tContract(values.contractType) : ''}
                    empty={t('previewNothing')}
                  />
                  <PreviewRow
                    label={t('cityLabel')}
                    value={[values.city, values.region].filter(Boolean).join(', ')}
                    empty={t('previewNothing')}
                  />
                  <PreviewRow
                    label={t('salaryPeriodLabel')}
                    value={
                      values.salaryMin || values.salaryMax
                        ? `${[values.salaryMin, values.salaryMax].filter(Boolean).join(' – ')} ${values.currency} / ${PERIOD_LABEL[values.salaryPeriod]}`
                        : t('previewSalaryNotProvided')
                    }
                    empty={t('previewSalaryNotProvided')}
                  />
                </dl>
                {values.responsibilities.length > 0 ? (
                  <PreviewList label={t('responsibilitiesLabel')} items={values.responsibilities} />
                ) : null}
                {values.requirementsMandatory.length > 0 ? (
                  <PreviewList
                    label={t('requirementsMandatoryLabel')}
                    items={values.requirementsMandatory}
                  />
                ) : null}
                {values.benefits.length > 0 ? (
                  <PreviewList label={t('benefitsLabel')} items={values.benefits} />
                ) : null}
              </div>

              {isEdit ? null : (
              <div id={domId('agreePublish')} className="space-y-1.5">
                <div className="flex items-start gap-2.5">
                  <Checkbox
                    id="job-agreePublish-box"
                    checked={values.agreePublish}
                    onCheckedChange={(checked) =>
                      setValue('agreePublish', checked === true, { shouldDirty: true })
                    }
                    aria-invalid={errors.agreePublish ? true : undefined}
                    aria-describedby={errorDescription('agreePublish')}
                    className="mt-0.5"
                  />
                  <Label
                    htmlFor="job-agreePublish-box"
                    className="text-sm font-normal leading-snug text-muted-foreground"
                  >
                    {t('agreePublish')}
                  </Label>
                </div>
                <FieldError name="agreePublish" />
              </div>
              )}

              {publishError ? (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/5 p-3"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  <div className="text-sm">
                    <p className="font-medium text-foreground">
                      {tRoot(toUserMessageKey(publishError))}
                    </p>
                    {publishError === 'COMPANY_NOT_VERIFIED' ? (
                      <p className="mt-0.5 text-muted-foreground">{t('notVerifiedNote')}</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </form>
      </section>

      {/* Stopka: wskaźnik zapisu + nawigacja */}
      <div className="flex flex-col gap-4 rounded-[1.75rem] border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="space-y-1">
          <SaveIndicator
            state={saveState}
            labels={{
              idle: isEdit ? t('editSaveHint') : t('saveHint'),
              saving: t('saving'),
              saved: isEdit ? (demo ? t('editSavedDemo') : t('editSaved')) : demo ? t('savedDemo') : t('saved'),
              // Kod z serwera ma własny komunikat; brak kodu (np. zerwane połączenie) → ogólny.
              error: saveError ? tRoot(toUserMessageKey(saveError)) : t('saveError'),
            }}
          />
          {/* Oferta już nie jest szkicem (np. opublikowana w innej karcie) — ponawianie nic nie
              da, więc prowadzimy do listy ofert (#363). */}
          {saveState === 'error' &&
          (saveError === 'JOB_NOT_DRAFT' ||
            saveError === 'JOB_NOT_EDITABLE' ||
            saveError === 'JOB_EDIT_CONFLICT') ? (
            <Link
              href="/employer/oferty"
              className="text-sm font-medium text-foreground underline underline-offset-2 hover:text-primary"
            >
              {t('goToOffers')}
            </Link>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end [&_button]:min-h-12">
          <Button asChild variant="ghost" disabled={busy}>
            <Link href={isEdit ? '/employer/oferty' : '/employer'}>{t('cancel')}</Link>
          </Button>
          {isEdit ? null : (
            <Button type="button" variant="outline" onClick={() => void handleSaveExit()} disabled={busy}>
              {t('saveExit')}
            </Button>
          )}
          {step > 1 ? (
            <Button type="button" variant="outline" onClick={handleBack} disabled={busy}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t('back')}
            </Button>
          ) : null}
          {isEdit ? (
            <>
              {step < TOTAL_STEPS ? (
                <Button type="button" variant="outline" onClick={() => void handleNext()} disabled={busy}>
                  {t('next')}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : null}
              <Button type="button" onClick={() => void handleSaveChanges()} disabled={busy}>
                {saveState === 'saving' ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                )}
                {saveState === 'saving' ? t('saving') : t('saveChanges')}
              </Button>
            </>
          ) : step < TOTAL_STEPS ? (
            <Button type="button" onClick={() => void handleNext()} disabled={busy}>
              {saveState === 'saving' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              {t('next')}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button type="button" onClick={() => void handlePublish()} disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
              {publishing ? t('publishing') : t('publish')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  function addLanguage(): void {
    const name = langDraft.trim();
    if (name.length < 2) {
      setLangError(true);
      return;
    }
    const exists = values.languages.some((l) => l.language.toLowerCase() === name.toLowerCase());
    if (!exists) {
      setValue('languages', [...values.languages, { language: name, level: levelDraft }], {
        shouldDirty: true,
      });
    }
    setLangDraft('');
    setLangError(false);
  }
}

/** Wskaźnik stanu zapisu (idle/saving/saved/error). */
function SaveIndicator({
  state,
  labels,
}: {
  state: SaveState;
  labels: Record<SaveState, string>;
}): React.JSX.Element {
  if (state === 'saving') {
    return (
      <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {labels.saving}
      </p>
    );
  }
  if (state === 'saved') {
    return (
      <p role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
        {labels.saved}
      </p>
    );
  }
  if (state === 'error') {
    return (
      <p role="alert" className="inline-flex items-center gap-2 text-sm text-error">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        {labels.error}
      </p>
    );
  }
  return <p className="text-sm text-muted-foreground">{labels.idle}</p>;
}

/** Pole logiczne (checkbox z etykietą) — flagi oferty. */
function CheckboxField({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <div id={id} className="flex items-start gap-2.5">
      <Checkbox
        id={`${id}-box`}
        checked={checked}
        onCheckedChange={(c) => onChange(c === true)}
        className="mt-0.5"
      />
      <Label htmlFor={`${id}-box`} className="text-sm font-normal leading-snug text-foreground">
        {label}
      </Label>
    </div>
  );
}

/** Wiersz podglądu (etykieta + wartość / placeholder). */
function PreviewRow({
  label,
  value,
  empty,
}: {
  label: string;
  value: string;
  empty: string;
}): React.JSX.Element {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{value.trim() ? value : empty}</dd>
    </div>
  );
}

/** Lista podglądu (etykieta + pozycje). */
function PreviewList({ label, items }: { label: string; items: string[] }): React.JSX.Element {
  return (
    <div className="mt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/** Pole „chipów" — dodawanie/usuwanie krótkich wpisów (obowiązki/wymagania/umiejętności). */
function ChipInput({
  id,
  values,
  onChange,
  placeholder,
  addLabel,
  removeLabel,
  invalid,
  errorDescription,
  maxItemLength,
  tooLongLabel,
}: {
  id: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  addLabel: string;
  removeLabel: string;
  invalid?: boolean;
  errorDescription?: string;
  maxItemLength: number;
  tooLongLabel: string;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState('');
  const [tooLong, setTooLong] = React.useState(false);
  const draftErrorId = `${id}-draft-error`;

  function add(): void {
    const value = draft.trim();
    if (!value) return;
    // Za długa pozycja nie trafia na listę (baza by ją po cichu obcięła — #364). Wpis zostaje
    // w polu do skrócenia; bez twardego `maxLength`, który obcinałby wklejony tekst bez komunikatu.
    if (value.length > maxItemLength) {
      setTooLong(true);
      return;
    }
    if (!values.includes(value)) onChange([...values, value]);
    setDraft('');
    setTooLong(false);
  }

  return (
    <div>
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          placeholder={placeholder}
          aria-invalid={invalid || tooLong ? true : undefined}
          aria-describedby={
            [tooLong ? draftErrorId : undefined, errorDescription].filter(Boolean).join(' ') ||
            undefined
          }
          onChange={(e) => {
            setDraft(e.target.value);
            if (tooLong) setTooLong(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={add}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {addLabel}
        </Button>
      </div>
      {tooLong ? (
        <p id={draftErrorId} className="mt-1.5 text-sm text-error">
          {tooLongLabel}
        </p>
      ) : null}
      {values.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {values.map((value) => (
            <li
              key={value}
              className="inline-flex items-center gap-1.5 rounded-md border border-input bg-soft px-2.5 py-1 text-sm text-foreground"
            >
              {value}
              <button
                type="button"
                aria-label={`${removeLabel}: ${value}`}
                onClick={() => onChange(values.filter((v) => v !== value))}
                className="inline-flex min-h-6 min-w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
