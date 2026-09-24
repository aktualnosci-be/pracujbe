import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AuthForm } from '@/components/auth/AuthForm';
import { ErrorCodes, type ErrorCode } from '@/lib/errors';
import { safeNextPath } from '@/lib/auth/next-path';

/**
 * Logowanie (email + hasło). Formularz kliencki (AuthForm) wywołuje server action `signIn`,
 * które po sukcesie przekierowuje do bezpiecznego `?next=` (np. oferty) albo do panelu wg roli. Parametr `?error=<CODE>` (np. z callbacku
 * e-maila) jest pokazywany jako komunikat nad formularzem.
 */

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'auth' });
  return {
    title: t('loginTitle'),
    description: t('loginSubtitle'),
  };
}

function parseErrorCode(value: string | string[] | undefined): ErrorCode | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first !== undefined && Object.prototype.hasOwnProperty.call(ErrorCodes, first)
    ? (first as ErrorCode)
    : null;
}

export default async function LoginPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const sp = await searchParams;
  const initialError = parseErrorCode(sp['error']);
  // Bezpieczny cel powrotu (np. oferta, z której kandydat przyszedł); przenosimy go też do rejestracji.
  const next = safeNextPath(sp['next']);

  const t = await getTranslations('auth');

  return (
    <div className="container flex min-h-[calc(100vh-8rem)] items-center justify-center py-12">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader className="space-y-2 text-center">
            <CardTitle as="h1" className="text-2xl">{t('loginTitle')}</CardTitle>
            <CardDescription>{t('loginSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <AuthForm variant="login" initialError={initialError} next={next} />

            <div className="space-y-3 text-center text-sm">
              <Link
                href="/reset-hasla"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('forgotPassword')}
              </Link>
              <p className="text-muted-foreground">
                {t('noAccount')}{' '}
                <Link
                  href={next ? { pathname: '/rejestracja', query: { next } } : '/rejestracja'}
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t('submitRegister')}
                </Link>
              </p>
              <p>
                <Link
                  href="/rejestracja-pracodawca"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t('registerAsEmployer')}
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
