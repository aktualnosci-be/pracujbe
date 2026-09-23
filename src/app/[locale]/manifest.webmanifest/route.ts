import { getTranslations } from 'next-intl/server';
import { routing, type Locale } from '@/i18n/routing';
import { createManifest } from '@/lib/pwa/manifest';

type Context = { params: Promise<{ locale: string }> };

export async function GET(_request: Request, { params }: Context): Promise<Response> {
  const { locale } = await params;
  if (!(routing.locales as readonly string[]).includes(locale)) {
    return new Response(null, { status: 404 });
  }

  const [tCommon, tMetadata] = await Promise.all([
    getTranslations({ locale, namespace: 'common' }),
    getTranslations({ locale, namespace: 'metadata' }),
  ]);
  const manifest = createManifest(
    locale as Locale,
    tCommon('appName'),
    tMetadata('homeDescription'),
  );

  return Response.json(manifest, {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  });
}
