import * as React from "react";

import { cn } from "@/lib/utils";
import { EYEBROW } from "@/components/dashboard/panel-styles";

export interface StepperStep {
  title: string;
  desc?: string;
}

export interface StepperProps {
  steps: StepperStep[];
  current: number;
  progressLabel: string;
  className?: string;
}

/**
 * Wspólny, nieinteraktywny wskaźnik postępu obu kreatorów. Prototyp (#5) nie ma steppera —
 * złożony z jego prymitywów: `.eyebrow` (etykieta postępu), `.job h3` (tytuł kroku) i paska
 * `.progress` (6 px, promień 4 px) podzielonego na segmenty kroków.
 */
export function Stepper({
  steps,
  current,
  progressLabel,
  className,
}: StepperProps): React.JSX.Element {
  const activeStep = steps[current];

  return (
    <nav aria-label={progressLabel} className={cn("min-w-0", className)}>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className={EYEBROW}>
            {progressLabel}
          </p>
          {activeStep ? (
            <>
              <p className="mt-2 break-words text-[15px] font-semibold tracking-[-0.03em] text-foreground">
                {activeStep.title}
              </p>
              {activeStep.desc ? (
                <p className="mt-1 break-words text-xs leading-[18px] text-muted-foreground">
                  {activeStep.desc}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        <span
          aria-hidden="true"
          className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground"
        >
          {current + 1} / {steps.length}
        </span>
      </div>
      <ol className="mt-[18px] flex min-w-0 gap-1">
        {steps.map((step, index) => (
          <li
            key={index}
            aria-current={index === current ? "step" : undefined}
            className="min-w-0 flex-1"
          >
            <span className="sr-only">
              {index + 1}. {step.title}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "block h-1.5 w-full rounded-[4px]",
                index < current
                  ? "bg-foreground"
                  : index === current
                    ? "bg-primary"
                    : "bg-border",
              )}
            />
          </li>
        ))}
      </ol>
    </nav>
  );
}
