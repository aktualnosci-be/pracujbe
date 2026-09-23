'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPin,
  Plus,
  X,
} from 'lucide-react';

import { Link, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
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
import { ProfileCompleteness } from '@/components/candidate/ProfileCompleteness';
import { ProfileChecklist } from '@/components/candidate/ProfileChecklist';
import {
  AVAILABILITY_VALUES,
  CATEGORY_KEYS,
  CONTRACT_TYPES,
  LANGUAGE_LEVELS,
  step1Schema,
  step2Schema,
  step3Schema,
  step4Schema,
  step5Schema,
  step6DraftSchema,
  step6Schema,
} from '@/lib/validation/candidate';
import type { CategoryKey, ContractType } from '@/lib/jobs';
import { saveOnboardingStep, type OnboardingStep } from '@/lib/actions/onboarding';

/**
 * OnboardingWizard — kreator profilu kandydata (makieta 06), 6 kroków z REALNYM zapisem.
 *
 * Pola są kontrolowane przez React Hook Form (bez `defaultValue`), a każdy krok jest
 * walidowany właściwym `stepNSchema` (Zod, to samo źródło co po stronie serwera) i zapisywany
 * przez server action `saveOnboardingStep`. „Dalej" przechodzi dalej dopiero po udanym zapisie;
 * „Zapisz i wyjdź" zapisuje i wraca do panelu; krok 6 („Zakończ") ustawia `profile_completed`.
 *
 * Invariant #11: blokada przycisku podczas zapisu, zachowanie danych po błędzie, błędy przy
 * polach, przewijanie do pierwszego błędu, jasny wskaźnik stanu zapisu (idle/saving/saved/error).
 * Tryb DEMO (brak env): zapis nie trafia do DB, ale przepływ działa i pokazuje „zapisano (demo)".
 *
 * TODO(data): relacje słownikowe (umiejętności/języki/certyfikaty) są zbierane i walidowane,
 * ale w tej iteracji nie są utrwalane — patrz `@/lib/actions/onboarding` (persistuje candidate_profiles).
 */

type Availability = (typeof AVAILABILITY_VALUES)[number];
type LanguageLevel = (typeof LANGUAGE_LEVELS)[number];
type Currency = 'EUR' | 'PLN';
type License = 'none' | 'b' | 'c' | 'ce';

interface LanguageEntry {
  language: string;
  level: LanguageLevel;
}

/** Dane wejściowe z profilu (gdy zalogowany); w trybie demo — puste. */
export interface OnboardingInitialValues {
  firstName?: string;
  lastName?: string;
  phone?: string;
  occupations?: string[];
  categories?: CategoryKey[];
  skills?: string[];
  experienceYears?: number | null;
  city?: string;
  region?: string;
  radiusKm?: number | null;
  hasDrivingLicense?: boolean;
  hasCar?: boolean;
  languages?: LanguageEntry[];
  certificates?: string[];
  availability?: Availability | null;
  preferredContractTypes?: ContractType[];
  expectedSalaryMin?: number | null;
  expectedSalaryCurrency?: string;
  bio?: string;
}

interface FormValues {
  firstName: string;
  lastName: string;
  phone: string;
  occupations: string[];
  categories: CategoryKey[];
  skills: string[];
  experienceYears: string;
  city: string;
  region: string;
  radiusKm: string;
  hasDrivingLicense: boolean;
  hasCar: boolean;
  languages: LanguageEntry[];
  certificates: string[];
  availability: '' | Availability;
  preferredContractTypes: ContractType[];
  expectedSalaryMin: string;
  expectedSalaryCurrency: Currency;
  bio: string;
  agreeTerms: boolean;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Pola należące do danego kroku (kolejność = kolejność przewijania do pierwszego błędu). */
const STEP_FIELDS: Record<OnboardingStep, (keyof FormValues)[]> = {
  1: ['firstName', 'lastName', 'phone'],
  2: ['occupations', 'categories'],
  3: ['experienceYears', 'skills'],
  4: ['city', 'region', 'radiusKm', 'hasDrivingLicense', 'hasCar'],
  5: ['languages', 'certificates'],
  6: ['availability', 'preferredContractTypes', 'expectedSalaryMin', 'bio', 'agreeTerms'],
};

const SCHEMAS = {
  1: step1Schema,
  2: step2Schema,
  3: step3Schema,
  4: step4Schema,
  5: step5Schema,
  6: step6Schema,
} as const;

function domId(field: keyof FormValues): string {
  return `onb-${field}`;
}

/** Id podpowiedzi pod polem (część `aria-describedby`, #320). */
function hintId(field: keyof FormValues): string {
  return `${domId(field)}-hint`;
}

/** Id komunikatu błędu pola — ten sam, który renderuje `FieldError`. */
function errorId(field: keyof FormValues): string {
  return `${domId(field)}-error`;
}

/** Pierwszy element, który może przyjąć fokus: sam element albo pierwszy kontrolka w grupie. */
function focusTarget(el: HTMLElement): HTMLElement | null {
  if (el.matches('input, textarea, button, select, [tabindex]')) return el;
  return el.querySelector<HTMLElement>('input, textarea, button, select, [tabindex]');
}

/** '' → NaN (wymagane pole: NaN da błąd typu z i18n), inaczej liczba. */
function toRequiredNumber(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value);
}

/** '' → undefined (pole opcjonalne / z wartością domyślną w schemacie). */
function toOptionalNumber(value: string): number | undefined {
  return value.trim() === '' ? undefined : Number(value);
}

/** Buduje obiekt danych kroku zgodny z odpowiednim `stepNSchema`. */
function buildStepData(step: OnboardingStep, v: FormValues): unknown {
  switch (step) {
    case 1:
      return { firstName: v.firstName, lastName: v.lastName, phone: v.phone };
    case 2:
      return { occupations: v.occupations, categories: v.categories };
    case 3:
      return { skills: v.skills, experienceYears: toRequiredNumber(v.experienceYears) };
    case 4:
      return {
        city: v.city,
        region: v.region.trim() === '' ? undefined : v.region,
        radiusKm: toOptionalNumber(v.radiusKm),
        hasDrivingLicense: v.hasDrivingLicense,
        hasCar: v.hasCar,
      };
    case 5:
      return { languages: v.languages, certificates: v.certificates };
    case 6:
      return {
        availability: v.availability,
        preferredContractTypes: v.preferredContractTypes,
        expectedSalaryMin: toOptionalNumber(v.expectedSalaryMin),
        bio: v.bio.trim() === '' ? undefined : v.bio,
        agreeTerms: v.agreeTerms,
        // Waluta nie jest częścią step6Schema — action czyta ją defensywnie z surowych danych.
        expectedSalaryCurrency: v.expectedSalaryCurrency,
      };
  }
}

function toFormValues(init?: OnboardingInitialValues): FormValues {
  return {
    firstName: init?.firstName ?? '',
    lastName: init?.lastName ?? '',
    phone: init?.phone ?? '',
    occupations: init?.occupations ?? [],
    categories: init?.categories ?? [],
    skills: init?.skills ?? [],
    experienceYears: init?.experienceYears != null ? String(init.experienceYears) : '',
    city: init?.city ?? '',
    region: init?.region ?? '',
    radiusKm: init?.radiusKm != null ? String(init.radiusKm) : '25',
    hasDrivingLicense: init?.hasDrivingLicense ?? false,
    hasCar: init?.hasCar ?? false,
    languages: init?.languages ?? [],
    certificates: init?.certificates ?? [],
    availability: init?.availability ?? '',
    preferredContractTypes: init?.preferredContractTypes ?? [],
    expectedSalaryMin: init?.expectedSalaryMin != null ? String(init.expectedSalaryMin) : '',
    expectedSalaryCurrency: init?.expectedSalaryCurrency === 'PLN' ? 'PLN' : 'EUR',
    bio: init?.bio ?? '',
    agreeTerms: false,
  };
}

/** Zamienia komunikat błędu z Zod na klucz i18n (fallback dla domyślnych komunikatów enum). */
function toErrorKey(field: string, message: string): string {
  if (message.startsWith('candidate.error.')) return message;
  if (field === 'availability') return 'candidate.error.availabilityRequired';
  return 'candidate.error.invalid';
}

export interface OnboardingWizardProps {
  initialValues?: OnboardingInitialValues;
}

export function OnboardingWizard({ initialValues }: OnboardingWizardProps): React.JSX.Element {
  const t = useTranslations('onboarding');
  const tRoot = useTranslations();
  const tn = useTranslations('nav');
  const tCat = useTranslations('categories');
  const tContract = useTranslations('contractTypes');
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
    defaultValues: toFormValues(initialValues),
    mode: 'onSubmit',
  });

  const values = watch();

  const [step, setStep] = React.useState<OnboardingStep>(1);
  const [saveState, setSaveState] = React.useState<SaveState>('idle');
  // Blokada ponownego wysłania bez czekania na render (podwójne kliknięcie / Enter, Invariant #11).
  const savingRef = React.useRef(false);
  // #323: po zmianie kroku fokus na nagłówku nowego kroku + komunikat dla czytnika ekranu.
  const stepHeadingRef = React.useRef<HTMLHeadingElement>(null);
  const isFirstRenderRef = React.useRef(true);
  const [stepAnnouncement, setStepAnnouncement] = React.useState('');
  const [demoSaved, setDemoSaved] = React.useState(false);
  const [badgeVisible, setBadgeVisible] = React.useState(false);

  // Lokalny stan pigułek prawa jazdy (kategoria) — schemat/DB przechowują tylko boolean
  // `hasDrivingLicense`; granularność kategorii to element wizualny makiety (TODO(data)).
  const [license, setLicense] = React.useState<License>(
    initialValues?.hasDrivingLicense ? 'b' : 'none',
  );

  // Roboczy wiersz dodawania języka (relacja — nieutrwalana w tej iteracji, TODO(data)).
  const [langDraft, setLangDraft] = React.useState('');
  const [levelDraft, setLevelDraft] = React.useState<LanguageLevel>('basic');
  const [langError, setLangError] = React.useState(false);

  const AVAIL_LABEL: Record<Availability, string> = {
    immediate: t('availImmediate'),
    within_month: t('availWithinMonth'),
    within_three_months: t('availWithinThreeMonths'),
    flexible: t('availFlexible'),
  };
  const LEVEL_LABEL: Record<LanguageLevel, string> = {
    basic: t('levelBasic'),
    intermediate: t('levelIntermediate'),
    fluent: t('levelFluent'),
    native: t('levelNative'),
  };

  const steps = [
    { title: t('step1Title'), desc: t('step1Sub') },
    { title: t('step2Title'), desc: t('step2Sub') },
    { title: t('step3Title'), desc: t('step3Sub') },
    { title: t('step4Title'), desc: t('step4Sub') },
    { title: t('step5Title'), desc: t('step5Sub') },
    { title: t('step6Title'), desc: t('step6Sub') },
  ];

  // Stan ukończenia kroków (heurystyka do wskaźnika kompletności i checklisty).
  const stepDone: boolean[] = [
    Boolean(values.firstName.trim() && values.lastName.trim()),
    values.occupations.length > 0 && values.categories.length > 0,
    values.experienceYears.trim() !== '',
    values.city.trim() !== '',
    values.languages.length > 0 || values.certificates.length > 0,
    Boolean(values.availability) && values.agreeTerms,
  ];
  const completeness = Math.round((stepDone.filter(Boolean).length / stepDone.length) * 100);
  const checklist = steps.map((s, i) => ({
    label: s.title,
    done: stepDone[i] ?? false,
    hint: stepDone[i] ? undefined : t('none'),
  }));

  React.useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    stepHeadingRef.current?.focus();
    setStepAnnouncement(
      t('stepAnnounce', { current: step, total: steps.length, title: steps[step - 1]?.title ?? '' }),
    );
    // Reaguje wyłącznie na zmianę kroku; tytuły kroków są stałe w obrębie locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  /** `aria-describedby` pola: podpowiedź (gdy jest) + komunikat błędu (gdy widoczny), #320. */
  function describedBy(field: keyof FormValues, withHint = false): string | undefined {
    const ids = [withHint ? hintId(field) : null, errors[field] ? errorId(field) : null].filter(
      Boolean,
    );
    return ids.length > 0 ? ids.join(' ') : undefined;
  }

  function scrollToFirstError(current: OnboardingStep, erroredFields: Set<string>): void {
    const first = STEP_FIELDS[current].find((f) => erroredFields.has(f));
    if (!first) return;
    const el = document.getElementById(domId(first));
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Grupy (branże, typy umów, zgoda, dostępność) → pierwsza kontrolka w grupie (#320).
      focusTarget(el)?.focus();
    }
  }

  /**
   * Waliduje i zapisuje bieżący krok. Zwraca true przy sukcesie. Krok 6 bez `finish`
   * („Zapisz i wyjdź”) nie wymaga zgody (#337) — zgoda blokuje tylko „Zakończ”.
   */
  async function persistStep(current: OnboardingStep, finish = false): Promise<boolean> {
    if (savingRef.current) return false;
    clearErrors(STEP_FIELDS[current]);
    const data = buildStepData(current, getValues());
    const schema = current === 6 && !finish ? step6DraftSchema : SCHEMAS[current];
    const result = schema.safeParse(data);

    if (!result.success) {
      const erroredFields = new Set<string>();
      for (const issue of result.error.issues) {
        const field = String(issue.path[0] ?? '');
        if (!field) continue;
        erroredFields.add(field);
        if ((STEP_FIELDS[current] as string[]).includes(field)) {
          setError(field as keyof FormValues, {
            type: 'validate',
            message: toErrorKey(field, issue.message),
          });
        }
      }
      setSaveState('idle');
      scrollToFirstError(current, erroredFields);
      return false;
    }

    savingRef.current = true;
    setSaveState('saving');
    try {
      const res = await saveOnboardingStep(current, data, { finish });
      if (!res.ok) {
        setSaveState('error');
        return false;
      }
      setDemoSaved(Boolean(res.demo));
      setSaveState('saved');
      setBadgeVisible(true);
      return true;
    } catch {
      setSaveState('error');
      return false;
    } finally {
      savingRef.current = false;
    }
  }

  async function handleNext(): Promise<void> {
    const ok = await persistStep(step);
    if (ok && step < 6) setStep((step + 1) as OnboardingStep);
  }

  function handleBack(): void {
    if (step <= 1 || savingRef.current) return;
    clearErrors();
    setSaveState('idle');
    setStep((step - 1) as OnboardingStep);
  }

  async function handleSaveExit(): Promise<void> {
    const ok = await persistStep(step);
    if (ok) router.push('/candidate');
  }

  async function handleFinish(): Promise<void> {
    const ok = await persistStep(6, true);
    if (ok) router.push('/candidate');
  }

  const busy = saveState === 'saving';
  const busyClass = busy ? 'cursor-not-allowed opacity-50' : undefined;

  function toggleInArray<T>(field: keyof FormValues, value: T): void {
    const current = getValues(field) as unknown as T[];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    setValue(field, next as FormValues[typeof field], { shouldDirty: true });
  }

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

  function FieldError({ name }: { name: keyof FormValues }): React.JSX.Element | null {
    const message = errors[name]?.message;
    if (!message) return null;
    return (
      <p id={errorId(name)} className="text-sm text-error">
        {tRoot(String(message))}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Nagłówek + znacznik zapisu */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">{t('subtitle')}</p>
        </div>
        {saveState === 'saved' && badgeVisible ? (
          <div
            role="status"
            className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg border border-success/30 bg-success/5 px-3 py-2"
          >
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
            <span className="text-sm font-medium text-foreground">
              {demoSaved ? t('savedDemo') : t('saved')}
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
        className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-7"
      />

      {/* Kolumny: boczna + formularz */}
      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        {/* Kolumna boczna */}
        <aside className="min-w-0 space-y-6">
          <section className="rounded-3xl border border-border bg-card p-5 shadow-sm">
            <h2 className="text-base font-semibold text-foreground">{t('completeness')}</h2>
            <ProfileCompleteness
              className="mt-4"
              value={completeness}
              hint={t('completenessHint')}
              size={64}
            />
            <ProfileChecklist className="mt-5" items={checklist} />
          </section>

          <section className="rounded-3xl border border-border bg-soft p-5">
            <h2 className="text-base font-semibold text-foreground">{t('needHelp')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('helpText')}</p>
            <Button asChild variant="outline" size="sm" className="mt-4 w-full bg-background">
              <Link href="/poradniki">
                {t('seeGuide')}
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </section>
        </aside>

        {/* Formularz bieżącego kroku */}
        <section className="min-w-0 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-7">
          <div className="mb-5 h-1 w-12 rounded-full bg-primary" aria-hidden="true" />
          <h2
            ref={stepHeadingRef}
            tabIndex={-1}
            className="text-xl font-semibold text-foreground focus:outline-none"
          >
            {steps[step - 1]?.title}
          </h2>
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {stepAnnouncement}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{steps[step - 1]?.desc}</p>

          <form
            className="mt-5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void handleNext();
            }}
          >
            {step === 1 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={domId('firstName')}>{t('firstName')}</Label>
                  <Input
                    id={domId('firstName')}
                    autoComplete="given-name"
                    aria-invalid={errors.firstName ? true : undefined}
                    aria-describedby={describedBy('firstName')}
                    {...register('firstName')}
                  />
                  <FieldError name="firstName" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={domId('lastName')}>{t('lastName')}</Label>
                  <Input
                    id={domId('lastName')}
                    autoComplete="family-name"
                    aria-invalid={errors.lastName ? true : undefined}
                    aria-describedby={describedBy('lastName')}
                    {...register('lastName')}
                  />
                  <FieldError name="lastName" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor={domId('phone')}>{t('phone')}</Label>
                  <Input
                    id={domId('phone')}
                    type="tel"
                    autoComplete="tel"
                    aria-invalid={errors.phone ? true : undefined}
                    aria-describedby={describedBy('phone', true)}
                    {...register('phone')}
                  />
                  <p id={hintId('phone')} className="text-xs text-muted-foreground">
                    {t('phoneHint')}
                  </p>
                  <FieldError name="phone" />
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-6">
                <div className="space-y-1.5">
                  <Label htmlFor={domId('occupations')}>{t('occupationsLabel')}</Label>
                  <ChipInput
                    id={domId('occupations')}
                    values={values.occupations}
                    onChange={(next) => setValue('occupations', next, { shouldDirty: true })}
                    placeholder={t('occupationsPlaceholder')}
                    addLabel={t('add')}
                    removeLabel={t('remove')}
                    invalid={Boolean(errors.occupations)}
                    describedBy={describedBy('occupations', true)}
                  />
                  <p id={hintId('occupations')} className="text-xs text-muted-foreground">
                    {t('occupationsHint')}
                  </p>
                  <FieldError name="occupations" />
                </div>

                <div
                  id={domId('categories')}
                  role="group"
                  aria-labelledby={`${domId('categories')}-label`}
                  aria-describedby={describedBy('categories', true)}
                  className="space-y-2"
                >
                  <Label id={`${domId('categories')}-label`}>{t('categoriesLabel')}</Label>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORY_KEYS.map((key) => {
                      const active = values.categories.includes(key);
                      return (
                        <TogglePill
                          key={key}
                          active={active}
                          label={tCat(key)}
                          onClick={() => toggleInArray('categories', key)}
                        />
                      );
                    })}
                  </div>
                  <p id={hintId('categories')} className="text-xs text-muted-foreground">
                    {t('categoriesHint')}
                  </p>
                  <FieldError name="categories" />
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="space-y-6">
                <div className="space-y-1.5 sm:max-w-xs">
                  <Label htmlFor={domId('experienceYears')}>{t('experienceLabel')}</Label>
                  <Input
                    id={domId('experienceYears')}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={60}
                    aria-invalid={errors.experienceYears ? true : undefined}
                    aria-describedby={describedBy('experienceYears', true)}
                    {...register('experienceYears')}
                  />
                  <p id={hintId('experienceYears')} className="text-xs text-muted-foreground">
                    {t('experienceHint')}
                  </p>
                  <FieldError name="experienceYears" />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={domId('skills')}>{t('skillsLabel')}</Label>
                  <ChipInput
                    id={domId('skills')}
                    values={values.skills}
                    onChange={(next) => setValue('skills', next, { shouldDirty: true })}
                    placeholder={t('skillsPlaceholder')}
                    addLabel={t('add')}
                    removeLabel={t('remove')}
                    invalid={Boolean(errors.skills)}
                    describedBy={describedBy('skills', true)}
                  />
                  <p id={hintId('skills')} className="text-xs text-muted-foreground">
                    {t('skillsHint')}
                  </p>
                  <FieldError name="skills" />
                </div>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={domId('city')}>{t('city')}</Label>
                    <div className="relative">
                      <Input
                        id={domId('city')}
                        className="pr-10"
                        autoComplete="address-level2"
                        aria-invalid={errors.city ? true : undefined}
                        aria-describedby={describedBy('city')}
                        {...register('city')}
                      />
                      <MapPin
                        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </div>
                    <FieldError name="city" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={domId('region')}>{t('regionLabel')}</Label>
                    <Input
                      id={domId('region')}
                      aria-invalid={errors.region ? true : undefined}
                      aria-describedby={describedBy('region')}
                      {...register('region')}
                    />
                    <FieldError name="region" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={domId('radiusKm')}>{t('radiusLabel')}</Label>
                    <Input
                      id={domId('radiusKm')}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={300}
                      aria-invalid={errors.radiusKm ? true : undefined}
                      aria-describedby={describedBy('radiusKm')}
                      {...register('radiusKm')}
                    />
                    <FieldError name="radiusKm" />
                  </div>
                </div>

                <div
                  id={domId('hasDrivingLicense')}
                  role="group"
                  aria-labelledby={`${domId('hasDrivingLicense')}-label`}
                >
                  <Label id={`${domId('hasDrivingLicense')}-label`}>{t('drivingLicense')}</Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(
                      [
                        { value: 'none', label: t('noLicense') },
                        { value: 'b', label: t('catB') },
                        { value: 'c', label: t('catC') },
                        { value: 'ce', label: t('catCE') },
                      ] as { value: License; label: string }[]
                    ).map((option) => {
                      const active = license === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            setLicense(option.value);
                            setValue('hasDrivingLicense', option.value !== 'none', {
                              shouldDirty: true,
                            });
                          }}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                            active
                              ? 'border-accent bg-accent/10 text-accent-dark'
                              : 'border-input text-foreground hover:bg-soft',
                          )}
                        >
                          {option.label}
                          {active ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div id={domId('hasCar')}>
                  <Label>{t('ownCar')}</Label>
                  <div
                    className="mt-2 inline-flex rounded-md border border-input p-1"
                    role="group"
                    aria-label={t('ownCar')}
                  >
                    <button
                      type="button"
                      aria-pressed={!values.hasCar}
                      onClick={() => setValue('hasCar', false, { shouldDirty: true })}
                      className={cn(
                        'rounded px-5 py-1.5 text-sm font-medium transition-colors',
                        !values.hasCar
                          ? 'bg-accent/10 text-accent-dark'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {t('no')}
                    </button>
                    <button
                      type="button"
                      aria-pressed={values.hasCar}
                      onClick={() => setValue('hasCar', true, { shouldDirty: true })}
                      className={cn(
                        'rounded px-5 py-1.5 text-sm font-medium transition-colors',
                        values.hasCar
                          ? 'bg-accent/10 text-accent-dark'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {t('yes')}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {step === 5 ? (
              <div className="space-y-6">
                <div id={domId('languages')} className="space-y-2">
                  <Label htmlFor="onb-language-draft">{t('languagesLabel')}</Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="onb-language-draft"
                      className="flex-1"
                      value={langDraft}
                      placeholder={t('languageNamePlaceholder')}
                      aria-invalid={langError || errors.languages ? true : undefined}
                      aria-describedby={
                        [langError ? 'onb-language-draft-error' : null, describedBy('languages')]
                          .filter(Boolean)
                          .join(' ') || undefined
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
                    <div className="w-full sm:w-40">
                      <Select
                        value={levelDraft}
                        onValueChange={(val) => setLevelDraft(val as LanguageLevel)}
                      >
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
                    <p id="onb-language-draft-error" className="text-sm text-error">
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
                  <Label htmlFor={domId('certificates')}>{t('certificatesLabel')}</Label>
                  <ChipInput
                    id={domId('certificates')}
                    values={values.certificates}
                    onChange={(next) => setValue('certificates', next, { shouldDirty: true })}
                    placeholder={t('certificatesPlaceholder')}
                    addLabel={t('add')}
                    removeLabel={t('remove')}
                    invalid={Boolean(errors.certificates)}
                    describedBy={describedBy('certificates')}
                  />
                  <FieldError name="certificates" />
                </div>
              </div>
            ) : null}

            {step === 6 ? (
              <div className="space-y-6">
                <div id={domId('availability')} className="space-y-1.5 sm:max-w-xs">
                  <Label htmlFor="onb-availability-trigger">{t('availabilityLabel')}</Label>
                  <Select
                    value={values.availability || undefined}
                    onValueChange={(val) =>
                      setValue('availability', val as Availability, { shouldDirty: true })
                    }
                  >
                    <SelectTrigger
                      id="onb-availability-trigger"
                      aria-invalid={errors.availability ? true : undefined}
                      aria-describedby={describedBy('availability')}
                    >
                      <SelectValue placeholder={t('availabilityLabel')} />
                    </SelectTrigger>
                    <SelectContent>
                      {AVAILABILITY_VALUES.map((a) => (
                        <SelectItem key={a} value={a}>
                          {AVAIL_LABEL[a]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError name="availability" />
                </div>

                <div
                  id={domId('preferredContractTypes')}
                  role="group"
                  aria-labelledby={`${domId('preferredContractTypes')}-label`}
                  aria-describedby={describedBy('preferredContractTypes')}
                  className="space-y-2"
                >
                  <Label id={`${domId('preferredContractTypes')}-label`}>
                    {t('contractTypesLabel')}
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {CONTRACT_TYPES.map((ct) => {
                      const active = values.preferredContractTypes.includes(ct);
                      return (
                        <TogglePill
                          key={ct}
                          active={active}
                          label={tContract(ct)}
                          onClick={() => toggleInArray('preferredContractTypes', ct)}
                        />
                      );
                    })}
                  </div>
                  <FieldError name="preferredContractTypes" />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={domId('expectedSalaryMin')}>{t('expectedSalary')}</Label>
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <Input
                        id={domId('expectedSalaryMin')}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        aria-invalid={errors.expectedSalaryMin ? true : undefined}
                        aria-describedby={describedBy('expectedSalaryMin')}
                        {...register('expectedSalaryMin')}
                      />
                    </div>
                    <div className="w-24 shrink-0">
                      <Select
                        value={values.expectedSalaryCurrency}
                        onValueChange={(val) =>
                          setValue('expectedSalaryCurrency', val as Currency, { shouldDirty: true })
                        }
                      >
                        <SelectTrigger aria-label={t('currencyLabel')}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="EUR">EUR</SelectItem>
                          <SelectItem value="PLN">PLN</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <FieldError name="expectedSalaryMin" />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={domId('bio')}>{t('bioLabel')}</Label>
                  <Textarea
                    id={domId('bio')}
                    rows={4}
                    placeholder={t('bioPlaceholder')}
                    aria-invalid={errors.bio ? true : undefined}
                    aria-describedby={describedBy('bio')}
                    {...register('bio')}
                  />
                  <FieldError name="bio" />
                </div>

                <div id={domId('agreeTerms')} className="space-y-1.5">
                  <div className="flex items-start gap-2.5">
                    <Checkbox
                      id="onb-agreeTerms-box"
                      checked={values.agreeTerms}
                      onCheckedChange={(checked) =>
                        setValue('agreeTerms', checked === true, { shouldDirty: true })
                      }
                      aria-invalid={errors.agreeTerms ? true : undefined}
                      aria-describedby={describedBy('agreeTerms')}
                      className="mt-0.5"
                    />
                    <Label
                      htmlFor="onb-agreeTerms-box"
                      className="text-sm font-normal leading-snug text-muted-foreground"
                    >
                      {t.rich('agreeTermsLinks', {
                        terms: (chunks) => (
                          <TermsLink href="/regulamin" newTabHint={t('opensInNewTab')}>
                            {chunks}
                          </TermsLink>
                        ),
                        privacy: (chunks) => (
                          <TermsLink href="/polityka-prywatnosci" newTabHint={t('opensInNewTab')}>
                            {chunks}
                          </TermsLink>
                        ),
                      })}
                    </Label>
                  </div>
                  <FieldError name="agreeTerms" />
                </div>
              </div>
            ) : null}
          </form>
        </section>
      </div>

      {/* Stopka: wskaźnik zapisu + nawigacja */}
      <div className="flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <SaveIndicator
          state={saveState}
          labels={{
            idle: t('saveHint'),
            saving: t('saving'),
            saved: demoSaved ? t('savedDemo') : t('saved'),
            error: t('saveError'),
          }}
        />
        <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap">
          <Button asChild variant="ghost" disabled={busy}>
            <Link href="/candidate">{t('cancel')}</Link>
          </Button>
          {/* #323: `aria-disabled` zamiast `disabled` — przycisk zachowuje fokus podczas zapisu;
              blokadę ponownego wysłania egzekwuje `savingRef` w handlerach (Invariant #11). */}
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleSaveExit()}
            aria-disabled={busy || undefined}
            className={busyClass}
          >
            {t('saveExit')}
          </Button>
          {step > 1 ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleBack}
              aria-disabled={busy || undefined}
              className={busyClass}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t('back')}
            </Button>
          ) : null}
          {step < 6 ? (
            <Button
              type="button"
              onClick={() => void handleNext()}
              aria-disabled={busy || undefined}
              className={busyClass}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              {t('next')}: {steps[step]?.title}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => void handleFinish()}
              aria-disabled={busy || undefined}
              className={busyClass}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {t('finish')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Link do dokumentu prawnego w etykiecie zgody (#337, wzorzec z rejestracji #229). Nowa karta,
 * żeby nie gubić wpisanych danych; klik w link nie przełącza checkboxa.
 */
function TermsLink({
  href,
  newTabHint,
  children,
}: {
  href: '/regulamin' | '/polityka-prywatnosci';
  newTabHint: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
    >
      {children}
      <span className="sr-only"> {newTabHint}</span>
    </Link>
  );
}

/** Wskaźnik stanu zapisu (idle/saving/saved/error) — zastępuje fałszywy „autozapis". */
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

/** Pigułka wielokrotnego wyboru (kategorie/rodzaje umów). */
function TogglePill({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-accent bg-accent/10 text-accent-dark'
          : 'border-input text-foreground hover:bg-soft',
      )}
    >
      {label}
      {active ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
    </button>
  );
}

/** Pole „chipów" — dodawanie/usuwanie krótkich wpisów (zawody/umiejętności/certyfikaty). */
function ChipInput({
  id,
  values,
  onChange,
  placeholder,
  addLabel,
  removeLabel,
  invalid,
  describedBy,
}: {
  id: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  addLabel: string;
  removeLabel: string;
  invalid?: boolean;
  describedBy?: string;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState('');

  function add(): void {
    const value = draft.trim();
    if (!value) return;
    if (!values.includes(value)) onChange([...values, value]);
    setDraft('');
  }

  return (
    <div>
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          placeholder={placeholder}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => setDraft(e.target.value)}
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
