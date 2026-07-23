import * as React from 'react';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Stepper — wskaźnik kroków kreatora (onboarding kandydata, kreator oferty).
 *
 * Desktop: poziomy rząd numerowanych kółek z łącznikami + tytuł i opis pod każdym krokiem.
 * Mobile: kompaktowy rząd numerowanych kropek 1..N + tytuł/opis aktywnego kroku pod spodem.
 *
 * `current` to indeks aktywnego kroku (0-based). Kroki przed `current` = ukończone (✓),
 * `current` = aktywny (granat), kolejne = nadchodzące (wyszarzone).
 * Tytuły/opisy przekazuje ekran (już przetłumaczone) — komponent jest prezentacyjny (serwerowy).
 */

export interface StepperStep {
  title: string;
  desc?: string;
}

export interface StepperProps {
  steps: StepperStep[];
  current: number;
  className?: string;
}

type State = 'done' | 'active' | 'upcoming';

function stateOf(index: number, current: number): State {
  if (index < current) return 'done';
  if (index === current) return 'active';
  return 'upcoming';
}

const CIRCLE_CLASS: Record<State, string> = {
  done: 'bg-success text-white',
  active: 'bg-primary text-primary-foreground',
  upcoming: 'border border-border bg-background text-muted-foreground',
};

export function Stepper({ steps, current, className }: StepperProps): React.JSX.Element {
  const activeStep = steps[current];

  return (
    <div className={className}>
      {/* Desktop — poziomy stepper z łącznikami */}
      <ol className="hidden items-start md:flex">
        {steps.map((step, index) => {
          const state = stateOf(index, current);
          const isLast = index === steps.length - 1;
          return (
            <li key={step.title} className="flex flex-1 flex-col items-center text-center">
              <div className="flex w-full items-center">
                <span className={cn('h-px flex-1', index === 0 ? 'invisible' : index <= current ? 'bg-primary' : 'bg-border')} />
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                    CIRCLE_CLASS[state],
                  )}
                  aria-current={state === 'active' ? 'step' : undefined}
                >
                  {state === 'done' ? <Check className="h-4 w-4" aria-hidden="true" /> : index + 1}
                </span>
                <span className={cn('h-px flex-1', isLast ? 'invisible' : index < current ? 'bg-primary' : 'bg-border')} />
              </div>
              <span
                className={cn(
                  'mt-2 text-sm font-medium',
                  state === 'upcoming' ? 'text-muted-foreground' : 'text-foreground',
                )}
              >
                {step.title}
              </span>
              {step.desc ? (
                <span className="mt-0.5 text-xs text-muted-foreground">{step.desc}</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* Mobile — numerowane kropki + tytuł/opis aktywnego kroku */}
      <div className="md:hidden">
        <ol className="flex items-center gap-2">
          {steps.map((step, index) => {
            const state = stateOf(index, current);
            return (
              <li key={step.title} className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    CIRCLE_CLASS[state],
                  )}
                  aria-current={state === 'active' ? 'step' : undefined}
                >
                  {state === 'done' ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
                </span>
                {index < steps.length - 1 ? (
                  <span className={cn('h-px w-4', index < current ? 'bg-primary' : 'bg-border')} />
                ) : null}
              </li>
            );
          })}
        </ol>
        {activeStep ? (
          <div className="mt-3">
            <p className="text-sm font-medium text-foreground">{activeStep.title}</p>
            {activeStep.desc ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{activeStep.desc}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
