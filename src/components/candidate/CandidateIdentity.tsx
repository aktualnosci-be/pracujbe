import { BriefcaseBusiness, MapPin, UserRound } from "lucide-react";

import type {
  CandidatePassport,
  CandidateProfileSummary,
} from "@/lib/data/candidate";

interface CandidateIdentityProps {
  profile: CandidateProfileSummary;
  passport: CandidatePassport;
  labels: {
    eyebrow: string;
    emptyName: string;
    emptyIdentity: string;
    loadError: string;
    availability: string | null;
  };
}

/** Wyróżnia wyłącznie informacje zapisane przez właściciela profilu. */
export function CandidateIdentity({
  profile,
  passport,
  labels,
}: CandidateIdentityProps) {
  const loadFailed = profile.loadFailed || passport.loadFailed;
  const firstName = profile.firstName?.trim();
  const occupation = passport.occupations[0]?.trim();
  const city = passport.city?.trim();
  const hasIdentity = Boolean(
    firstName || occupation || city || labels.availability,
  );

  return (
    <section
      aria-labelledby={loadFailed ? undefined : "candidate-identity-heading"}
      aria-label={loadFailed ? labels.eyebrow : undefined}
      data-testid="candidate-identity"
      className="min-w-0 overflow-hidden rounded-[1.75rem] border border-border bg-card p-5 sm:p-7"
    >
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-accent">
        {labels.eyebrow}
      </p>
      {loadFailed ? (
        <p role="alert" className="mt-4 text-sm text-error">
          {labels.loadError}
        </p>
      ) : (
        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-4 sm:gap-6">
          <span
            aria-hidden="true"
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[1.25rem] bg-soft text-foreground"
          >
            <UserRound className="h-8 w-8" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="candidate-identity-heading"
              className="[overflow-wrap:anywhere] text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
            >
              {firstName || labels.emptyName}
            </h2>
            {hasIdentity ? (
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground sm:text-base">
                {occupation ? (
                  <span className="inline-flex min-w-0 items-center gap-2 [overflow-wrap:anywhere]">
                    <BriefcaseBusiness
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-accent"
                    />
                    {occupation}
                  </span>
                ) : null}
                {city ? (
                  <span className="inline-flex min-w-0 items-center gap-2 [overflow-wrap:anywhere]">
                    <MapPin
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-accent"
                    />
                    {city}
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                {labels.emptyIdentity}
              </p>
            )}
          </div>
          {labels.availability ? (
            <span className="max-w-full break-words rounded-full border border-border bg-soft px-4 py-2 text-sm font-semibold text-foreground">
              {labels.availability}
            </span>
          ) : null}
        </div>
      )}
    </section>
  );
}
