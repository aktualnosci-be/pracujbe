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
};

export default withNextIntl(nextConfig);
