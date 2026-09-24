import type { ProfileChecklistItem } from '@/components/candidate/ProfileChecklist';
import { PROFILE_SECTIONS, profileSectionStep, type ProfileChecklistState } from '@/lib/profile-completeness';

type StepTitleKey = 'step1Title' | 'step2Title' | 'step3Title' | 'step4Title' | 'step5Title' | 'step6Title';

/**
 * Pozycje checklisty kompletności profilu — wspólne dla pulpitu i profilu kandydata.
 *
 * Każda pozycja to krok kreatora (#315): etykieta = tytuł kroku (`onboarding.stepNTitle`),
 * „Dodaj" prowadzi do tego kroku (#317). Teksty przekazuje ekran.
 */
export function profileChecklistItems(
  checklist: ProfileChecklistState,
  add: string,
  stepTitle: (key: StepTitleKey) => string,
): ProfileChecklistItem[] {
  return PROFILE_SECTIONS.map((section) => {
    const step = profileSectionStep(section);
    return {
      label: stepTitle(`step${step}Title` as StepTitleKey),
      done: checklist[section],
      action: add,
      href: `/candidate/onboarding?step=${step}`,
    };
  });
}
