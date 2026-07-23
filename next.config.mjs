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
    const security = [
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
