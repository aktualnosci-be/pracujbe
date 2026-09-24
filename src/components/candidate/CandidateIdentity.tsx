import { BriefcaseBusiness, MapPin, UserRound } from "lucide-react";

import type {
  CandidatePassport,
  CandidateProfileSummary,
} from "@/lib/data/candidate";
import { EYEBROW, PROFILE_AVATAR, STATUS_GOOD } from "@/components/dashboard/panel-styles";
import { PROFILE_BANNER } from "@/components/candidate/candidate-styles";
import { cn } from "@/lib/utils";

interface CandidateIdentityProps {
  profile: CandidateProfileSummary;
  passport: CandidatePassport;
  labels: {
    eyebrow: string;
    emptyName: string;
    emptyIdentity: string;
    loadError: string;
    /** Nazwa pola dla czytnika ekranu przed odznaką dostępności. */
    availabilityLabel: string;
    availability: string | null;
  };
}

/**
 * Paszport tożsamości (#172, `profile-banner` z prototypu people-passport): wyłącznie
 * informacje zapisane przez właściciela profilu. Bez zdjęcia i bez inicjałów — kafelek
 * z neutralną ikoną; odznaka dostępności tylko dla znanej wartości i nigdy po błędzie odczytu.
 */
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
      className={cn(PROFILE_BANNER, "block")}
    >
      <p className={EYEBROW}>
        {labels.eyebrow}
      </p>
      {loadFailed ? (
        <p role="alert" className="mt-4 text-[15px] text-error">
          {labels.loadError}
        </p>
      ) : (
        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-5 max-[600px]:gap-3.5">
          <span
            aria-hidden="true"
            className={PROFILE_AVATAR}
          >
            <UserRound className="h-8 w-8" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="candidate-identity-heading"
              className="m-0 text-[23px] font-bold leading-[1.3] tracking-[-0.025em] text-foreground [overflow-wrap:anywhere] max-[600px]:text-[21px]"
            >
              {firstName || labels.emptyName}
            </h2>
            {hasIdentity ? (
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 text-[15px] leading-[1.7] text-muted-foreground">
                {occupation ? (
                  <span className="inline-flex min-w-0 items-center gap-2 [overflow-wrap:anywhere]">
                    <BriefcaseBusiness
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-primary"
                    />
                    {occupation}
                  </span>
                ) : null}
                {city ? (
                  <span className="inline-flex min-w-0 items-center gap-2 [overflow-wrap:anywhere]">
                    <MapPin
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-primary"
                    />
                    {city}
                  </span>
                ) : null}
              </div>
            ) : (
              <p className="mt-1.5 text-[15px] leading-[1.7] text-muted-foreground">
                {labels.emptyIdentity}
              </p>
            )}
          </div>
          {labels.availability ? (
            <span
              data-testid="candidate-identity-availability"
              className={cn(STATUS_GOOD, "ml-auto max-[950px]:ml-0")}
            >
              <span className="sr-only">{labels.availabilityLabel} </span>
              {labels.availability}
            </span>
          ) : null}
        </div>
      )}
    </section>
  );
}
