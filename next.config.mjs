import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // WebP/AVIF automatycznie; ogranicz rozmiary do sensownych breakpointów (wydajność).
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      // Supabase Storage (publiczne assety firm/ofert) — uzupełnij host projektu.
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
  experimental: {
    // Ograniczenie JS na stronach publicznych: optymalizacja importów ikon.
    optimizePackageImports: ['lucide-react'],
  },
  // Uwaga: przekierowanie "/" → "/{locale}" obsługuje middleware next-intl
  // (z wykrywaniem Accept-Language i fallbackiem na 'pl'). Nie dubluj go tutaj.

  async headers() {
    const isProd = process.env.VERCEL_ENV === 'production';
    const isDev = process.env.NODE_ENV !== 'production';

    // --- Content-Security-Policy (P2-01) -------------------------------------
    // Świadomie BEZ nonce/strict-dynamic: strony renderują dane strukturalne JSON-LD
    // (SEO) oraz — PO zgodzie — inline'owe skrypty GA/Meta Pixel; strict-dynamic bez
    // pełnego wpięcia nonce do każdego <script> zablokowałby je i popsuł produkt.
    // 'unsafe-inline' dla script-src jest słabsze niż nonce, ale NIE łamie działania;
    // twarda migracja do nonce wymaga testów przeglądarkowych (E2E) — patrz roadmapa.
    // Poza tym pełne, restrykcyjne dyrektywy: object/base/frame-ancestors/form-action
    // oraz zawężone connect/img/font (Supabase, Sentry, GA/Meta tylko tam, gdzie trzeba).
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      // Skrypty: własne + inline (JSON-LD, gtag/fbq po zgodzie) + hosty trackerów.
      // Dev dokłada 'unsafe-eval' (React Refresh/HMR Next dev).
      `script-src 'self' 'unsafe-inline' ${isDev ? "'unsafe-eval' " : ''}https://www.googletagmanager.com https://connect.facebook.net`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      // XHR/fetch/WS: API własne, Supabase (REST/Realtime), Sentry ingest, GA/Meta.
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://www.google-analytics.com https://*.google-analytics.com https://connect.facebook.net${isDev ? ' ws: http://localhost:*' : ''}`,
      // Ramki: Meta Pixel (fallback), reszta zablokowana.
      "frame-src 'self' https://www.facebook.com",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
    ];
    if (isProd) csp.push('upgrade-insecure-requests');

    const security = [
      { key: 'Content-Security-Policy', value: csp.join('; ') },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ];
    if (isProd) {
      security.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      });
    } else {
      // Staging/preview: twardy noindex na poziomie nagłówka (obok robots.ts i pustego sitemap).
      security.push({ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' });
    }
    return [{ source: '/:path*', headers: security }];
  },
};

export default withNextIntl(nextConfig);
