import * as React from "react";

import { cn } from "@/lib/utils";

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

/** Wspólny, nieinteraktywny wskaźnik postępu obu kreatorów. */
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
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">
            {progressLabel}
          </p>
          {activeStep ? (
            <>
              <p className="mt-2 break-words text-xl font-semibold leading-tight text-foreground sm:text-2xl">
                {activeStep.title}
              </p>
              {activeStep.desc ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {activeStep.desc}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        <span
          aria-hidden="true"
          className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground"
        >
          {current + 1} / {steps.length}
        </span>
      </div>
      <ol className="mt-5 flex min-w-0 gap-1.5 sm:gap-2">
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
                "block h-2.5 w-full rounded-full",
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
