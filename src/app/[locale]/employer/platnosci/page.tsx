import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';

/**
 * Bezpłatny MVP nie udostępnia rozliczeń ani pakietów. Zachowujemy dawny adres wyłącznie
 * jako bezpieczne przekierowanie dla starych zakładek i linków.
 */
export default async function EmployerBillingPage({ params }: { params: Promise<{ locale: Locale }> }): Promise<void> {
  const { locale } = await params;
  redirect({ href: '/employer', locale });
}
