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
  CANDIDATE_ITEM_LIMITS,
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
import { toUserMessageKey, type ErrorCode } from '@/lib/errors';
import { saveOnboardingStep, type OnboardingStep } from '@/lib/actions/onboarding';
import { referenceDate } from '@/lib/matching/reference-date';
import {
  BTN_PRIMARY,
  BTN_RESET,
  BTN_SECONDARY,
  chipClass,
  EYEBROW,
  FORM_ERROR,
  FORM_FIELD,
  FORM_GRID,
  FORM_HINT,
  FORM_INPUT,
  FORM_LABEL_TEXT,
  FORM_SELECT,
  FORM_WIDE,
  H1_EXTENDED,
  H2_EXTENDED,
  P_EXTENDED,
  PANEL,
  PANEL_H2,
  PAPER,
  STATUS_GOOD,
} from '@/components/dashboard/panel-styles';

/** Pozycja listy „chipów” — `.p-tag` z prototypu (tło szarości, promień 7 px). */
const CHIP =
  'inline-flex max-w-full items-center gap-1.5 break-words rounded-[7px] bg-muted py-1 pl-2.5 pr-1 text-[13px] text-foreground';
/** Usuwanie chipa — cel 24 px (WCAG 2.5.8). */
const CHIP_REMOVE =
  'inline-flex min-h-6 min-w-6 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

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
  /** Data ważności certyfikatu po etykiecie ('YYYY-MM-DD', #96). */
  certificateExpiry?: Record<string, string>;
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
  certificateExpiry: Record<string, string>;
  availability: '' | Availability;
  preferredContractTypes: ContractType[];
  expectedSalaryMin: string;
  expectedSalaryCurrency: Currency;
  bio: string;
  agreeTerms: boolean;
  privacyNoticeAck: boolean;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Pola należące do danego kroku (kolejność = kolejność przewijania do pierwszego błędu). */
const STEP_FIELDS: Record<OnboardingStep, (keyof FormValues)[]> = {
  1: ['firstName', 'lastName', 'phone'],
  2: ['occupations', 'categories'],
  3: ['experienceYears', 'skills'],
  4: ['city', 'region', 'radiusKm', 'hasDrivingLicense', 'hasCar'],
  5: ['languages', 'certificates', 'certificateExpiry'],
  6: ['availability', 'preferredContractTypes', 'expectedSalaryMin', 'bio', 'agreeTerms', 'privacyNoticeAck'],
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
      return {
        languages: v.languages,
        certificates: v.certificates,
        // Tylko daty bieżących certyfikatów; puste pole = bezterminowy (#96).
        certificateExpiry: Object.fromEntries(
          v.certificates
            .map((label) => [label, v.certificateExpiry[label] ?? ''] as const)
            .filter(([, date]) => date !== ''),
        ),
      };
    case 6:
      return {
        availability: v.availability,
        preferredContractTypes: v.preferredContractTypes,
        expectedSalaryMin: toOptionalNumber(v.expectedSalaryMin),
        bio: v.bio.trim() === '' ? undefined : v.bio,
        agreeTerms: v.agreeTerms,
        privacyNoticeAck: v.privacyNoticeAck,
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
    certificateExpiry: init?.certificateExpiry ?? {},
    availability: init?.availability ?? '',
    preferredContractTypes: init?.preferredContractTypes ?? [],
    expectedSalaryMin: init?.expectedSalaryMin != null ? String(init.expectedSalaryMin) : '',
    expectedSalaryCurrency: init?.expectedSalaryCurrency === 'PLN' ? 'PLN' : 'EUR',
    bio: init?.bio ?? '',
    // #493: dwa osobne pola, żadne nie jest domyślnie zaznaczone.
    agreeTerms: false,
    privacyNoticeAck: false,
  };
}

/** Zamienia komunikat błędu z Zod na klucz i18n (fallback dla domyślnych komunikatów enum). */
function toErrorKey(field: string, message: string): string {
  if (message.startsWith('candidate.error.')) return message;
  if (field === 'availability') return 'candidate.error.availabilityRequired';
  return 'candidate.error.invalid';
}

export type OnboardingStepNumber = OnboardingStep;

export interface OnboardingWizardProps {
  initialValues?: OnboardingInitialValues;
  /** Krok startowy (np. z `?step=3` — link „Dodaj" z checklisty profilu). Domyślnie 1. */
  initialStep?: OnboardingStep;
}

export function OnboardingWizard({
  initialValues,
  initialStep = 1,
}: OnboardingWizardProps): React.JSX.Element {
  const t = useTranslations('onboarding');
  // Ta sama granica dnia co w matchingu: certyfikat ważny jeszcze w dniu wygaśnięcia (#96).
  const [today] = React.useState(() => referenceDate());
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

  const [step, setStep] = React.useState<OnboardingStep>(initialStep);
  const [saveState, setSaveState] = React.useState<SaveState>('idle');
  // #363: kod błędu z serwera → własny komunikat (zamiast zawsze „Nie udało się zapisać”).
  const [saveError, setSaveError] = React.useState<ErrorCode | null>(null);
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
    Boolean(values.availability) && values.agreeTerms && values.privacyNoticeAck,
  ];
  // Kroki z polami, których wymaga `finish_onboarding` (0029): imię, zawody+branże, miasto,
  // dostępność. Przy ONBOARDING_INCOMPLETE prowadzimy kandydata do pierwszego brakującego (#363).
  const requiredDone: Partial<Record<OnboardingStep, boolean>> = {
    1: Boolean(values.firstName.trim() && values.lastName.trim()),
    2: values.occupations.length > 0 && values.categories.length > 0,
    4: values.city.trim() !== '',
    6: Boolean(values.availability),
  };
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
        // Pierwsza niespełniona reguła pola jest najtrafniejsza („wymagane” przed „za krótkie”,
        // #367) — kolejne nie mogą jej nadpisać.
        if (!field || erroredFields.has(field)) continue;
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
    setSaveError(null);
    setSaveState('saving');
    try {
      const res = await saveOnboardingStep(current, data, { finish });
      if (!res.ok) {
        setSaveError(res.error);
        setSaveState('error');
        if (res.error === 'ONBOARDING_INCOMPLETE') {
          const missing = (Object.keys(requiredDone).map(Number) as OnboardingStep[]).find(
            (s) => !requiredDone[s],
          );
          if (missing && missing !== current) setStep(missing);
        }
        return false;
      }
      setDemoSaved(Boolean(res.demo));
      setSaveState('saved');
      setBadgeVisible(true);
      return true;
    } catch {
      setSaveError('INTERNAL');
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
    setSaveError(null);
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
    <div className="min-w-0">
      {/* Nagłówek + znacznik zapisu (prototyp: `.eyebrow` + `.extended h1` + `.dash-intro`) */}
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className={EYEBROW}>{t('eyebrow')}</p>
          <h1 className={H1_EXTENDED}>{t('title')}</h1>
          <p className={cn(P_EXTENDED, 'max-w-2xl')}>{t('subtitle')}</p>
        </div>
        {/* Bez `role="status"`: stan zapisu ogłasza jeden region — SaveIndicator w stopce (#402). */}
        {saveState === 'saved' && badgeVisible ? (
          <div className={cn(STATUS_GOOD, 'inline-flex shrink-0 items-center gap-2 self-start py-0 pr-0')}>
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            <span className="font-semibold">
              {demoSaved ? t('savedDemo') : t('saved')}
            </span>
            <button
              type="button"
              onClick={() => setBadgeVisible(false)}
              aria-label={tn('close')}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[8px] text-success-text transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        className="mt-6 border-b border-border pb-6"
      />

      {/* Kolumny: boczna + formularz */}
      <div className="mt-5 grid min-w-0 gap-x-[19px] xl:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        {/* Kolumna boczna: `.panel` kompletności + `.p-profile-note` pomocy */}
        <aside className="min-w-0 xl:my-5">
          <section className={PANEL}>
            <h2 className={PANEL_H2}>{t('completeness')}</h2>
            <ProfileCompleteness
              className="mt-2"
              value={completeness}
              hint={t('completenessHint')}
              size={64}
            />
            <ProfileChecklist items={checklist} />
          </section>

          <section className="mt-[19px] min-w-0 rounded-[19px] border border-primary/20 bg-primary/5 p-[26px] max-[600px]:p-[22px]">
            <h2 className="break-words text-[19px] font-bold leading-[1.15] tracking-[-0.025em] text-foreground">{t('needHelp')}</h2>
            <p className="mt-2 break-words text-sm leading-[1.6] text-muted-foreground">{t('helpText')}</p>
            <Button asChild variant="outline" className={cn(BTN_SECONDARY, BTN_RESET, 'mt-4 w-full')}>
              <Link href="/poradniki">
                {t('seeGuide')}
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </section>
        </aside>

        {/* Formularz bieżącego kroku */}
        {/* Prototyp: `.paper.demo-form`, nagłówek sekcji `01 / …` (numer dekoracyjny). */}
        <section className={PAPER}>
          <h2
            ref={stepHeadingRef}
            tabIndex={-1}
            className={`${H2_EXTENDED} focus:outline-none`}
          >
            <span aria-hidden="true">{String(step).padStart(2, '0')} / </span>
            {steps[step - 1]?.title}
          </h2>
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {stepAnnouncement}
          </p>
          <p className={cn(P_EXTENDED, 'mt-2')}>{steps[step - 1]?.desc}</p>

          <form
            className="mt-[22px] min-w-0"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void handleNext();
            }}
          >
            {step === 1 ? (
              <div className={FORM_GRID}>
                <div className={FORM_FIELD}>
                  <Label htmlFor={domId('firstName')} className={FORM_LABEL_TEXT}>{t('firstName')}</Label>
                  <Input
                    className={FORM_INPUT}
                    id={domId('firstName')}
                    autoComplete="given-name"
                    aria-invalid={errors.firstName ? true : undefined}
                    aria-describedby={describedBy('firstName')}
                    {...register('firstName')}
                  />
                  <FieldError name="firstName" />
                </div>
                <div className={FORM_FIELD}>
                  <Label htmlFor={domId('lastName')} className={FORM_LABEL_TEXT}>{t('lastName')}</Label>
                  <Input
                    className={FORM_INPUT}
                    id={domId('lastName')}
                    autoComplete="family-name"
                    aria-invalid={errors.lastName ? true : undefined}
                    aria-describedby={describedBy('lastName')}
                    {...register('lastName')}
                  />
                  <FieldError name="lastName" />
                </div>
                <div className={`${FORM_FIELD} ${FORM_WIDE}`}>
                  <Label htmlFor={domId('phone')} className={FORM_LABEL_TEXT}>{t('phone')}</Label>
                  <Input
                    className={FORM_INPUT}
                    id={domId('phone')}
                    type="tel"
                    autoComplete="tel"
                    aria-invalid={errors.phone ? true : undefined}
                    aria-describedby={describedBy('phone', true)}
                    {...register('phone')}
                  />
                  <p id={hintId('phone')} className={FORM_HINT}>
                    {t('phoneHint')}
                  </p>
                  <FieldError name="phone" />
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-6">
                <div className={FORM_FIELD}>
                  <Label htmlFor={domId('occupations')} className={FORM_LABEL_TEXT}>{t('occupationsLabel')}</Label>
                  <ChipInput
                    id={domId('occupations')}
                    values={values.occupations}
                    onChange={(next) => setValue('occupations', next, { shouldDirty: true })}
                    placeholder={t('occupationsPlaceholder')}
                    addLabel={t('add')}
                    removeLabel={t('remove')}
                    invalid={Boolean(errors.occupations)}
                    maxItemLength={CANDIDATE_ITEM_LIMITS.occupation}
                    tooLongLabel={t('itemTooLongMax', { max: CANDIDATE_ITEM_LIMITS.occupation })}
                    describedBy={describedBy('occupations', true)}
                  />
                  <p id={hintId('occupations')} className={FORM_HINT}>
                    {t('occupationsHint')}
                  </p>
                  <FieldError name="occupations" />
                </div>

                <div
                  id={domId('categories')}
                  role="group"
                  aria-labelledby={`${domId('categories')}-label`}
                  aria-describedby={describedBy('categories', true)}
                  className={FORM_FIELD}
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
                  <p id={hintId('categories')} className={FORM_HINT}>
                    {t('categoriesHint')}
                  </p>
                  <FieldError name="categories" />
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="space-y-6">
                <div className={cn(FORM_FIELD, 'sm:max-w-xs')}>
                  <Label htmlFor={domId('experienceYears')} className={FORM_LABEL_TEXT}>{t('experienceLabel')}</Label>
                  <Input
                    className={FORM_INPUT}
                    id={domId('experienceYears')}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={60}
                    aria-invalid={errors.experienceYears ? true : undefined}
                    aria-describedby={describedBy('experienceYears', true)}
                    {...register('experienceYears')}
                  />
                  <p id={hintId('experienceYears')} className={FORM_HINT}>
                    {t('experienceHint')}
                  </p>
                  <FieldError name="experienceYears" />
                </div>

                <div className={FORM_FIELD}>
                  <Label htmlFor={domId('skills')} className={FORM_LABEL_TEXT}>{t('skillsLabel')}</Label>
                  <ChipInput
                    id={domId('skills')}
                    values={values.skills}
                    onChange={(next) => setValue('skills', next, { shouldDirty: true })}
                    placeholder={t('skillsPlaceholder')}
                    addLabel={t('add')}
                    removeLabel={t('remove')}
                    invalid={Boolean(errors.skills)}
                    maxItemLength={CANDIDATE_ITEM_LIMITS.skill}
                    tooLongLabel={t('itemTooLongMax', { max: CANDIDATE_ITEM_LIMITS.skill })}
                    describedBy={describedBy('skills', true)}
                  />
                  <p id={hintId('skills')} className={FORM_HINT}>
                    {t('skillsHint')}
                  </p>
                  <FieldError name="skills" />
                </div>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="space-y-4">
                <div className={FORM_GRID}>
                  <div className={FORM_FIELD}>
                    <Label htmlFor={domId('city')} className={FORM_LABEL_TEXT}>{t('city')}</Label>
                    <div className="relative">
                      <Input
                        id={domId('city')}
                        className={cn(FORM_INPUT, 'pr-10')}
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
                  <div className={FORM_FIELD}>
                    <Label htmlFor={domId('region')} className={FORM_LABEL_TEXT}>{t('regionLabel')}</Label>
                    <Input
                      className={FORM_INPUT}
                      id={domId('region')}
                      aria-invalid={errors.region ? true : undefined}
                      aria-describedby={describedBy('region')}
                      {...register('region')}
                    />
                    <FieldError name="region" />
                  </div>
                  <div className={FORM_FIELD}>
                    <Label htmlFor={domId('radiusKm')} className={FORM_LABEL_TEXT}>{t('radiusLabel')}</Label>
                    <Input
                      className={FORM_INPUT}
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
                  <div className="mt-[9px] flex flex-wrap gap-2">
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
                          className={cn(chipClass(active), 'gap-1.5')}
                        >
                          {option.label}
                          {active ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div id={domId('hasCar')}>
                  <Label className={FORM_LABEL_TEXT}>{t('ownCar')}</Label>
                  <div
                    className="mt-[9px] inline-flex rounded-[11px] border border-input p-1"
                    role="group"
                    aria-label={t('ownCar')}
                  >
                    <button
                      type="button"
                      aria-pressed={!values.hasCar}
                      onClick={() => setValue('hasCar', false, { shouldDirty: true })}
                      className={cn(
                        'min-h-10 rounded-[8px] px-5 py-1.5 text-[13px] font-semibold transition-colors',
                        !values.hasCar
                          ? 'bg-primary/10 text-primary-dark'
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
                        'min-h-10 rounded-[8px] px-5 py-1.5 text-[13px] font-semibold transition-colors',
                        values.hasCar
                          ? 'bg-primary/10 text-primary-dark'
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
                <div id={domId('languages')} className={FORM_FIELD}>
                  <Label htmlFor="onb-language-draft" className={FORM_LABEL_TEXT}>{t('languagesLabel')}</Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="onb-language-draft"
                      className={cn(FORM_INPUT, 'flex-1')}
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
                        <SelectTrigger className={FORM_SELECT} aria-label={LEVEL_LABEL[levelDraft]}>
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
                    <Button type="button" variant="outline" onClick={addLanguage} className={cn(BTN_SECONDARY, BTN_RESET)}>
                      {t('addLanguage')}
                    </Button>
                  </div>
                  {langError ? (
                    <p id="onb-language-draft-error" className={FORM_ERROR}>
                      {tRoot('candidate.error.languageInvalid')}
                    </p>
                  ) : null}
                  {values.languages.length > 0 ? (
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {values.languages.map((entry) => (
                        <li
                          key={entry.language}
                          className={CHIP}
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
                            className={CHIP_REMOVE}
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <FieldError name="languages" />
                </div>

                <div className={FORM_FIELD}>
                  <Label htmlFor={domId('certificates')} className={FORM_LABEL_TEXT}>{t('certificatesLabel')}</Label>
                  <ChipInput
                    id={domId('certificates')}
                    values={values.certificates}
                    onChange={(next) => setValue('certificates', next, { shouldDirty: true })}
                    placeholder={t('certificatesPlaceholder')}
                    addLabel={t('add')}
                    removeLabel={t('remove')}
                    invalid={Boolean(errors.certificates)}
                    maxItemLength={CANDIDATE_ITEM_LIMITS.certificate}
                    tooLongLabel={t('itemTooLongMax', { max: CANDIDATE_ITEM_LIMITS.certificate })}
                    describedBy={describedBy('certificates')}
                  />
                  <FieldError name="certificates" />
                  {values.certificates.length > 0 ? (
                    <ul id={domId('certificateExpiry')} className="mt-2 space-y-2">
                      {values.certificates.map((label, index) => {
                        const inputId = `onb-certificate-expiry-${index}`;
                        const statusId = `${inputId}-status`;
                        const date = values.certificateExpiry[label] ?? '';
                        const expired = date !== '' && date < today;
                        return (
                          <li
                            key={label}
                            className="flex min-w-0 flex-col gap-[9px] rounded-[11px] border border-border p-3.5 sm:flex-row sm:items-center sm:gap-3"
                          >
                            <Label htmlFor={inputId} className={cn(FORM_LABEL_TEXT, 'min-w-0 flex-1 break-words')}>
                              {t('certificateExpiryLabel', { certificate: label })}
                            </Label>
                            <Input
                              id={inputId}
                              type="date"
                              className={cn(FORM_INPUT, 'sm:w-44')}
                              value={date}
                              aria-invalid={expired || errors.certificateExpiry ? true : undefined}
                              aria-describedby={
                                [expired ? statusId : null, describedBy('certificateExpiry')]
                                  .filter(Boolean)
                                  .join(' ') || undefined
                              }
                              onChange={(e) =>
                                setValue(
                                  'certificateExpiry',
                                  { ...values.certificateExpiry, [label]: e.target.value },
                                  { shouldDirty: true },
                                )
                              }
                            />
                            {expired ? (
                              <p id={statusId} className={cn(FORM_ERROR, 'font-semibold')}>
                                {t('certificateExpired')}
                              </p>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                  <p className={FORM_HINT}>{t('certificateExpiryHint')}</p>
                  <FieldError name="certificateExpiry" />
                </div>
              </div>
            ) : null}

            {step === 6 ? (
              <div className="space-y-6">
                <div id={domId('availability')} className={cn(FORM_FIELD, 'sm:max-w-xs')}>
                  <Label htmlFor="onb-availability-trigger" className={FORM_LABEL_TEXT}>{t('availabilityLabel')}</Label>
                  <Select
                    value={values.availability || undefined}
                    onValueChange={(val) =>
                      setValue('availability', val as Availability, { shouldDirty: true })
                    }
                  >
                    <SelectTrigger
                      className={FORM_SELECT}
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
                  className={FORM_FIELD}
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

                <div className={FORM_FIELD}>
                  <Label htmlFor={domId('expectedSalaryMin')} className={FORM_LABEL_TEXT}>{t('expectedSalary')}</Label>
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <Input
                        className={FORM_INPUT}
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
                        <SelectTrigger className={FORM_SELECT} aria-label={t('currencyLabel')}>
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

                <div className={FORM_FIELD}>
                  <Label htmlFor={domId('bio')} className={FORM_LABEL_TEXT}>{t('bioLabel')}</Label>
                  <Textarea
                    className={FORM_INPUT}
                    id={domId('bio')}
                    rows={4}
                    placeholder={t('bioPlaceholder')}
                    aria-invalid={errors.bio ? true : undefined}
                    aria-describedby={describedBy('bio')}
                    {...register('bio')}
                  />
                  <FieldError name="bio" />
                </div>

                <div id={domId('agreeTerms')} className={FORM_FIELD}>
                  <div className="flex items-start gap-2.5">
                    <Checkbox
                      id="onb-agreeTerms-box"
                      checked={values.agreeTerms}
                      onCheckedChange={(checked) =>
                        setValue('agreeTerms', checked === true, { shouldDirty: true })
                      }
                      aria-required="true"
                      aria-invalid={errors.agreeTerms ? true : undefined}
                      aria-describedby={describedBy('agreeTerms')}
                      className="mt-0.5"
                    />
                    <Label
                      htmlFor="onb-agreeTerms-box"
                      className="text-[13px] font-normal leading-[1.5] text-foreground"
                    >
                      {t.rich('termsAcceptLinks', {
                        terms: (chunks) => (
                          <TermsLink href="/regulamin" newTabHint={t('opensInNewTab')}>
                            {chunks}
                          </TermsLink>
                        ),
                      })}
                    </Label>
                  </div>
                  <FieldError name="agreeTerms" />
                </div>

                <div id={domId('privacyNoticeAck')} className={FORM_FIELD}>
                  <div className="flex items-start gap-2.5">
                    <Checkbox
                      id="onb-privacyNoticeAck-box"
                      checked={values.privacyNoticeAck}
                      onCheckedChange={(checked) =>
                        setValue('privacyNoticeAck', checked === true, { shouldDirty: true })
                      }
                      aria-required="true"
                      aria-invalid={errors.privacyNoticeAck ? true : undefined}
                      aria-describedby={describedBy('privacyNoticeAck')}
                      className="mt-0.5"
                    />
                    <Label
                      htmlFor="onb-privacyNoticeAck-box"
                      className="text-[13px] font-normal leading-[1.5] text-foreground"
                    >
                      {t.rich('privacyNoticeAckLinks', {
                        privacy: (chunks) => (
                          <TermsLink href="/polityka-prywatnosci" newTabHint={t('opensInNewTab')}>
                            {chunks}
                          </TermsLink>
                        ),
                      })}
                    </Label>
                  </div>
                  <FieldError name="privacyNoticeAck" />
                </div>
              </div>
            ) : null}
          </form>
        </section>
      </div>

      {/* Stopka: wskaźnik zapisu + nawigacja */}
      <div className="flex min-w-0 flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <SaveIndicator
          state={saveState}
          labels={{
            idle: t('saveHint'),
            saving: t('saving'),
            saved: demoSaved ? t('savedDemo') : t('saved'),
            // Kod z serwera ma własny komunikat; brak kodu (np. zerwane połączenie) → ogólny.
            error: saveError ? tRoot(toUserMessageKey(saveError)) : t('saveError'),
          }}
        />
        <div className="flex min-w-0 flex-col gap-[13px] lg:flex-row lg:flex-wrap">
          <Button asChild variant="ghost" disabled={busy} className={cn(BTN_RESET, 'min-h-[49px] rounded-[11px] px-[19px] text-sm font-[650]')}>
            <Link href="/candidate">{t('cancel')}</Link>
          </Button>
          {/* #323: `aria-disabled` zamiast `disabled` — przycisk zachowuje fokus podczas zapisu;
              blokadę ponownego wysłania egzekwuje `savingRef` w handlerach (Invariant #11). */}
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleSaveExit()}
            aria-disabled={busy || undefined}
            className={cn(BTN_SECONDARY, BTN_RESET, busyClass)}
          >
            {t('saveExit')}
          </Button>
          {step > 1 ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleBack}
              aria-disabled={busy || undefined}
              className={cn(BTN_SECONDARY, BTN_RESET, busyClass)}
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
              className={cn(BTN_PRIMARY, BTN_RESET, busyClass)}
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
              className={cn(BTN_PRIMARY, BTN_RESET, busyClass)}
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
      className="font-semibold text-foreground underline underline-offset-2 hover:text-primary"
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
      <p className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {labels.saving}
      </p>
    );
  }
  if (state === 'saved') {
    return (
      <p role="status" className="inline-flex items-center gap-2 text-[13px] text-success-text">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        {labels.saved}
      </p>
    );
  }
  if (state === 'error') {
    return (
      <p role="alert" className="inline-flex items-center gap-2 text-[13px] text-error">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        {labels.error}
      </p>
    );
  }
  return <p className="text-[13px] text-muted-foreground">{labels.idle}</p>;
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
      className={cn(chipClass(active), 'gap-1.5')}
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
  describedBy?: string;
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
          className={FORM_INPUT}
          id={id}
          value={draft}
          placeholder={placeholder}
          aria-invalid={invalid || tooLong ? true : undefined}
          aria-describedby={
            [tooLong ? draftErrorId : undefined, describedBy].filter(Boolean).join(' ') ||
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
        <Button type="button" variant="outline" onClick={add} className={cn(BTN_SECONDARY, BTN_RESET, 'shrink-0')}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {addLabel}
        </Button>
      </div>
      {tooLong ? (
        <p id={draftErrorId} className={cn(FORM_ERROR, 'mt-1.5')}>
          {tooLongLabel}
        </p>
      ) : null}
      {values.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {values.map((value) => (
            <li
              key={value}
              className={CHIP}
            >
              {value}
              <button
                type="button"
                aria-label={`${removeLabel}: ${value}`}
                onClick={() => onChange(values.filter((v) => v !== value))}
                className={CHIP_REMOVE}
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
