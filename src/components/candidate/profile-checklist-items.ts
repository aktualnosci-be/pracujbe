import type { ProfileChecklistItem } from '@/components/candidate/ProfileChecklist';
import type { CandidateProfileSummary } from '@/lib/data/candidate';

/**
 * Pozycje checklisty kompletności profilu — wspólne dla pulpitu i profilu kandydata.
 *
 * „Dodaj" prowadzi do kroku kreatora, który uzupełnia sekcję (#317). Zdjęcia kreator nie
 * obsługuje, więc ta pozycja ma neutralny opis zamiast imitacji linku. Teksty przekazuje
 * ekran (namespace `dashboard` + `none` z `onboarding`).
 */
export function profileChecklistItems(
  checklist: CandidateProfileSummary['checklist'],
  t: (key: 'checkBasicInfo' | 'checkExperience' | 'checkEducation' | 'checkSkills' | 'checkLanguages' | 'checkPhoto' | 'add') => string,
  none: string,
): ProfileChecklistItem[] {
  const add = t('add');
  const step = (n: number) => `/candidate/onboarding?step=${n}`;
  return [
    { label: t('checkBasicInfo'), done: checklist.basicInfo, action: add, href: step(1) },
    { label: t('checkExperience'), done: checklist.experience, action: add, href: step(3) },
    { label: t('checkEducation'), done: checklist.education, action: add, href: step(2) },
    { label: t('checkSkills'), done: checklist.skills, action: add, href: step(3) },
    { label: t('checkLanguages'), done: checklist.languages, action: add, href: step(5) },
    { label: t('checkPhoto'), done: checklist.photo, hint: none },
  ];
}
