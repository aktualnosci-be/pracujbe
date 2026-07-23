'use client';

import * as React from 'react';
import { ArrowRight, Calendar, Check, CheckCircle2, ExternalLink, MapPin, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

/**
 * OnboardingWizard — kreator profilu kandydata, krok 1 „Dane podstawowe" (makieta 06).
 *
 * Zawiera: nagłówek + zamykany znacznik „Zapisano", Stepper 6 kroków, kolumnę boczną
 * (kompletność + checklista + karta pomocy) oraz główny formularz (dane podstawowe +
 * informacje dodatkowe z pigułkami prawa jazdy, przełącznikiem własnego samochodu i polem
 * wynagrodzenia w STANIE BŁĘDU). Stopka: autozapis + Anuluj / Zapisz i wyjdź / Dalej.
 *
 * Komponent kliencki (interakcje: wybór pigułek, przełącznik, walidacja pola, zamykanie
 * znacznika). Dane są DEMO, a zapis/przejścia kroków są niepodpięte — TODO(data).
 */

type License = 'none' | 'b' | 'c' | 'ce';

export function OnboardingWizard(): React.JSX.Element {
  const t = useTranslations('onboarding');
  const tn = useTranslations('nav');

  const [savedOpen, setSavedOpen] = React.useState(true);
  const [license, setLicense] = React.useState<License>('b');
  const [ownCar, setOwnCar] = React.useState<boolean>(true);
  const [salary, setSalary] = React.useState('2 500');
  // Prezentacja stanu błędu z makiety: pokazany na starcie, znika po edycji na wartość niepustą.
  const [salaryError, setSalaryError] = React.useState(true);

  const steps = [
    { title: t('step1Title'), desc: t('step1Sub') },
    { title: t('step2Title'), desc: t('step2Sub') },
    { title: t('step3Title'), desc: t('step3Sub') },
    { title: t('step4Title'), desc: t('step4Sub') },
    { title: t('step5Title'), desc: t('step5Sub') },
    { title: t('step6Title'), desc: t('step6Sub') },
  ];

  const checklist = [
    { label: t('step1Title'), done: true },
    { label: t('step2Title'), hint: t('none') },
    { label: t('step3Title'), hint: t('none') },
    { label: t('step4Title'), hint: t('none') },
    { label: t('step5Title'), hint: t('none') },
    { label: t('step6Title'), hint: t('none') },
  ];

  const licenseOptions: { value: License; label: string }[] = [
    { value: 'none', label: t('noLicense') },
    { value: 'b', label: t('catB') },
    { value: 'c', label: t('catC') },
    { value: 'ce', label: t('catCE') },
  ];

  return (
    <div className="space-y-6">
      {/* Nagłówek + znacznik zapisu */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">{t('subtitle')}</p>
        </div>
        {savedOpen ? (
          <div className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg border border-success/30 bg-success/5 px-3 py-2">
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
            <span className="text-sm font-medium text-foreground">{t('saved')}</span>
            <button
              type="button"
              onClick={() => setSavedOpen(false)}
              aria-label={tn('close')}
              className="-mr-1 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>

      {/* Stepper */}
      <Stepper steps={steps} current={0} className="rounded-lg border border-border bg-card p-4 sm:p-6" />

      {/* Kolumny: boczna + formularz */}
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        {/* Kolumna boczna */}
        <aside className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
            <h2 className="text-base font-semibold text-foreground">{t('completeness')}</h2>
            <ProfileCompleteness className="mt-4" value={45} hint={t('completenessHint')} size={64} />
            <ProfileChecklist className="mt-5" items={checklist} />
          </section>

          <section className="rounded-lg border border-border bg-soft p-4 sm:p-5">
            <h2 className="text-base font-semibold text-foreground">{t('needHelp')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('helpText')}</p>
            <Button asChild variant="outline" size="sm" className="mt-4 w-full bg-background">
              {/* TODO(data): link do właściwego poradnika. */}
              <Link href="/poradniki">
                {t('seeGuide')}
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </section>
        </aside>

        {/* Formularz kroku 1 */}
        <section className="rounded-lg border border-border bg-card p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-foreground">{t('step1Title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('step1Sub')}</p>

          {/* Dane podstawowe */}
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">{t('firstName')}</Label>
              <Input id="firstName" defaultValue="Jan" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">{t('lastName')}</Label>
              <Input id="lastName" defaultValue="Kowalski" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="city">{t('city')}</Label>
              <div className="relative">
                <Input id="city" className="pr-10" defaultValue="Antwerpia, Belgia" />
                <MapPin
                  className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">{t('phone')}</Label>
              <Input id="phone" type="tel" defaultValue="+32 470 12 34 56" />
              <p className="text-xs text-muted-foreground">{t('phoneHint')}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">{t('email')}</Label>
              <Input id="email" type="email" defaultValue="jan.kowalski@email.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="birthDate">{t('birthDate')}</Label>
              <div className="relative">
                <Input id="birthDate" className="pr-10" defaultValue="15.04.1990" />
                <Calendar
                  className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nationality">{t('nationality')}</Label>
              <Select name="nationality" defaultValue="pl">
                <SelectTrigger id="nationality">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* TODO(data): słownik krajów z backendu. */}
                  <SelectItem value="pl">Polska</SelectItem>
                  <SelectItem value="be">Belgia</SelectItem>
                  <SelectItem value="ua">Ukraina</SelectItem>
                  <SelectItem value="ro">Rumunia</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="workPermit">{t('workPermit')}</Label>
              <Select name="workPermit" defaultValue="yes">
                <SelectTrigger id="workPermit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">{t('workPermitYes')}</SelectItem>
                  <SelectItem value="no">{t('no')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Informacje dodatkowe */}
          <div className="mt-6 border-t border-border pt-6">
            <h3 className="text-base font-semibold text-foreground">{t('additionalInfo')}</h3>

            <div className="mt-4 space-y-4">
              <div>
                <Label>{t('drivingLicense')}</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {licenseOptions.map((option) => {
                    const active = license === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setLicense(option.value)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                          active
                            ? 'border-accent bg-accent/10 text-accent'
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

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>{t('ownCar')}</Label>
                  <div
                    className="mt-2 inline-flex rounded-md border border-input p-1"
                    role="group"
                    aria-label={t('ownCar')}
                  >
                    <button
                      type="button"
                      aria-pressed={!ownCar}
                      onClick={() => setOwnCar(false)}
                      className={cn(
                        'rounded px-5 py-1.5 text-sm font-medium transition-colors',
                        !ownCar ? 'bg-accent/10 text-accent' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {t('no')}
                    </button>
                    <button
                      type="button"
                      aria-pressed={ownCar}
                      onClick={() => setOwnCar(true)}
                      className={cn(
                        'rounded px-5 py-1.5 text-sm font-medium transition-colors',
                        ownCar ? 'bg-accent/10 text-accent' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {t('yes')}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="relocation">{t('relocation')}</Label>
                  <Select name="relocation" defaultValue="yes">
                    <SelectTrigger id="relocation">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">{t('relocationYes')}</SelectItem>
                      <SelectItem value="no">{t('no')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="salary">{t('expectedSalary')}</Label>
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <Input
                      id="salary"
                      inputMode="numeric"
                      value={salary}
                      aria-invalid={salaryError}
                      aria-describedby={salaryError ? 'salary-error' : undefined}
                      onChange={(event) => {
                        setSalary(event.target.value);
                        setSalaryError(event.target.value.trim() === '');
                      }}
                      className={cn(
                        salaryError && 'border-error focus-visible:ring-error',
                      )}
                    />
                  </div>
                  <div className="w-24 shrink-0">
                    <Select name="currency" defaultValue="EUR">
                      <SelectTrigger aria-label="EUR">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="PLN">PLN</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {salaryError ? (
                  <p id="salary-error" className="text-sm text-error">
                    {t('salaryError')}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Stopka */}
      <div className="flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
          {t('autosave')}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          {/* TODO(data): anulowanie / zapis powiązać z akcją serwerową. */}
          <Button asChild variant="ghost">
            <Link href="/candidate">{t('cancel')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/candidate">{t('saveExit')}</Link>
          </Button>
          {/* TODO(data): przejście do kroku 2 „Preferencje pracy". */}
          <Button type="button">
            {t('next')}: {t('step2Title')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
