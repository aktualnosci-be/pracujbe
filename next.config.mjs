import createNextIntlPlugin from 'next-intl/plugin';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { createReleaseAwareBuildMetadata } from './scripts/build-version.mjs';
import { buildConsentBootScript } from './src/lib/security/csp-inline-scripts.mjs';

// #585: próba i ustalenie, empirycznie zweryfikowane przeciwko realnie zbudowanej stronie
// (`next build`+`next start`, Chromium) — patrz też ADR niżej. Next.js App Router (RSC)
// wstrzykuje WŁASNE inline `<script>` z danymi strumieniowanymi (`self.__next_f.push(...)`)
// na KAŻDEJ stronie; ich treść jest inherentnie dynamiczna (różna treść/rozmiar per strona i
// per rewalidacja ISR), więc nie da się ich objąć stałą listą hashy w `next.config.mjs`
// (funkcja jest wywoływana raz na proces, nie per żądanie). Usunięcie 'unsafe-inline' bez
// nonce blokuje te skrypty i psuje hydrację KAŻDEJ strony (potwierdzone: `getByRole('main')`
// znika z żywego DOM, mimo że jest w surowym HTML — React nie kończy hydracji). Next.js
// oficjalnie wspiera tylko wariant z noncem per-request przez middleware, ale jego własna
// dokumentacja wprost mówi: "nonces are generated for each request, [so] Incremental Static
// Regeneration (ISR) is not supported when adding nonces" — a strony publiczne w tym repo
// są ISR (#298, budżety wydajności, cacheHandler) — to świadoma, udokumentowana decyzja
// architektury tego projektu, więc migracja na nonce oznaczałaby utratę ISR na WSZYSTKICH
// stronach publicznych, nie tylko lokalną zmianę CSP.
//
// Dlatego enforced `script-src` w produkcji ZOSTAJE z 'unsafe-inline' (bez regresji). Zamiast
// tego dokładamy DRUGI, RÓWNOLEGŁY nagłówek `Content-Security-Policy-Report-Only` z tym samym
// script-src, ale WYŁĄCZNIE hashami (bez 'unsafe-inline') dla skryptów, które kontrolujemy
// (baner zgód w <head>; beacon Cloudflare Web Analytics po zgodzie to skrypt zewnętrzny z hosta
// w script-src, bez treści inline — #570) — jedno źródło treści z komponentami:
// src/lib/security/csp-inline-scripts.mjs. Report-Only nic nie blokuje, ale raportuje na
// /api/csp-report każdy przypadek, który złamałby ściślejszą politykę (włącznie z własnymi
// skryptami Next.js — oczekiwany szum, patrz komentarz przy nagłówku) — to obserwowalny,
// bezpieczny krok w stronę #585, a NIE twierdzenie, że 'unsafe-inline' zniknęło z enforced
// polityki. Pełne zamknięcie #585 wymaga decyzji właściciela: nonce + rezygnacja z ISR na
// stronach publicznych (regres wydajności) ALBO inny mechanizm, którego Next 15 dziś nie ma.
// JSON-LD (`type="application/ld+json"`) i tak nie jest egzekwowany przez script-src (nie jest
// wykonywalnym typem skryptu), więc nie potrzebuje hasha w żadnym wariancie.
function sha256(text) {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

// Te same stałe co src/lib/consent.ts / src/lib/consent-boot.ts (literały, nie logika —
// zgodność pilnuje tests/unit/csp-inline-scripts.test.ts).
const CONSENT_COOKIE_NAME = 'pracujbe_consent';
const CONSENT_BOOT_ATTRIBUTE = 'data-consent';

function scriptHashes() {
  return [
    sha256(
      buildConsentBootScript({
        cookieName: CONSENT_COOKIE_NAME,
        // Odczyt WEWNĄTRZ headers(), nie na starcie modułu: musi widzieć env procesu w
        // czasie żądania (zgodnie z resztą tej funkcji), tak samo jak `consent.ts` na starcie.
        policyVersion: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? '2.0',
        attribute: CONSENT_BOOT_ATTRIBUTE,
      }),
    ),
  ];
}

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// #47: odbiorca raportów CSP (ścieżka względna — ten sam origin co strona).
const CSP_REPORT_PATH = '/api/csp-report';
const CSP_REPORT_GROUP = 'csp-endpoint';
// #103: wersja 1.0.0 tylko po jawnym PRACUJBE_RELEASE_VERSION=1.0.0; błędna wartość przerywa build.
const BUILD = createReleaseAwareBuildMetadata(
  new Date(),
  process.env.PRACUJBE_RELEASE_VERSION,
  process.env.RAILWAY_GIT_COMMIT_SHA,
  process.env.GITHUB_SHA,
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Wartości wbudowane w artefakt: odświeżenie strony nie zmienia daty wydania.
  env: {
    NEXT_PUBLIC_APP_VERSION: BUILD.version,
    NEXT_PUBLIC_BUILD_TIME: BUILD.buildTime,
  },
  reactStrictMode: true,
  // #298: własny cache ISR — LRU w pamięci, limit dysku, 404 losowych slugów tylko krótko
  // w pamięci. Cache obrazów działa bez zmian (isrFlushToDisk zostaje domyślny).
  cacheHandler: fileURLToPath(new URL('./src/lib/cache/isr-cache-handler.mjs', import.meta.url)),
  poweredByHeader: false,
  images: {
    // WebP/AVIF automatycznie; ogranicz rozmiary do sensownych breakpointów (wydajność).
    formats: ['image/avif', 'image/webp'],
    // #394: wynik optymalizacji trzymany 31 dni (domyślnie 60 s → MISS/STALE i ponowna praca
    // `sharp` przy obrazie LCP). Pliki z public/ zmieniają się tylko z deployem — przy zmianie
    // obrazu zmień nazwę pliku (np. team-v2.webp).
    minimumCacheTTL: 2678400,
    // #27: bez zdalnych hostów — obrazy wyłącznie z własnego origin (Supabase Storage usunięte).
    remotePatterns: [],
  },
  experimental: {
    // Ograniczenie JS na stronach publicznych: optymalizacja importów ikon.
    optimizePackageImports: ['lucide-react'],
    // Plik CV ma limit 5 MB; multipart potrzebuje dodatkowego miejsca.
    serverActions: { bodySizeLimit: '6mb' },
  },
  // Uwaga: przekierowanie "/" → "/{locale}" obsługuje middleware next-intl
  // (z wykrywaniem Accept-Language i fallbackiem na 'pl'). Nie dubluj go tutaj.

  async headers() {
    // P1-19: JEDNO źródło prawdy o środowisku wdrożenia — MUSI być spójne z
    // `isProductionDeployment()` w src/lib/env.ts (build-time nie importuje TS, stąd powielenie).
    // „Publiczna produkcja" = tryb produkcyjny (APP_MODE) ORAZ realny publiczny URL.
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const isProdMode = process.env.APP_MODE === 'production';
    const isProd = isProdMode && !/localhost|127\.0\.0\.1|0\.0\.0\.0|staging|preview/i.test(siteUrl);
    const isDev = process.env.NODE_ENV !== 'production';

    // --- Content-Security-Policy (P2-01, #585) -------------------------------
    // Enforced policy: bez zmiany zachowania (patrz ADR wyżej) — 'unsafe-inline' zostaje w
    // script-src w KAŻDYM środowisku (Next.js App Router wstrzykuje własne inline skrypty
    // strumieniowania RSC na każdej stronie; ich treść jest dynamiczna, więc nie da się ich
    // objąć stałą listą hashy tutaj, a nonce wymagałby rezygnacji z ISR na stronach publicznych).
    // Reszta dyrektyw pozostaje restrykcyjna: object/base/frame-ancestors/form-action oraz
    // zawężone connect/img/font.
    // #570: Cloudflare Web Analytics (beacon, PO zgodzie w kategorii analytics) zamiast
    // Google Analytics i Meta Pixel — usunięte. Bez tokenu beacon się nie ładuje
    // (`Analytics.tsx`), więc CSP nie dopuszcza wtedy hostów Cloudflare Insights.
    const cfAnalytics = Boolean(process.env.NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN?.trim());
    const cfScript = cfAnalytics ? ' https://static.cloudflareinsights.com' : '';
    const cfConnect = cfAnalytics ? ' https://cloudflareinsights.com' : '';
    // Skrypty: własne + Turnstile (#46) + beacon Cloudflare Web Analytics (po zgodzie).
    const scriptSrcHosts = `https://challenges.cloudflare.com${cfScript}`;
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      // Inline: JSON-LD i własne skrypty RSC Next.js (patrz ADR wyżej). Dev dokłada
      // 'unsafe-eval' (React Refresh/HMR Next dev).
      `script-src 'self' 'unsafe-inline' ${isDev ? "'unsafe-eval' " : ''}${scriptSrcHosts}`,
      "style-src 'self' 'unsafe-inline'",
      // P3-02: obrazy wyłącznie z własnego origin, data:/blob:.
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      // XHR/fetch: API własne, beacon Cloudflare Web Analytics (webhook błędów #571 idzie z serwera — bez hosta w CSP).
      `connect-src 'self'${cfConnect}${isDev ? ' ws: http://localhost:*' : ''}`,
      // Ramki: tylko Cloudflare Turnstile (#46, ochrona formularzy), reszta zablokowana.
      "frame-src 'self' https://challenges.cloudflare.com",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      // #47: raporty naruszeń (bez zmiany egzekwowanej polityki). `report-uri` dla przeglądarek
      // bez Reporting API; `report-to` wskazuje grupę z nagłówka `Reporting-Endpoints` niżej.
      // Endpoint zapisuje tylko dyrektywę i origin zasobu (src/app/api/csp-report/route.ts).
      `report-uri ${CSP_REPORT_PATH}`,
      `report-to ${CSP_REPORT_GROUP}`,
    ];
    if (isProd) csp.push('upgrade-insecure-requests');

    // Report-Only (#585): sama dyrektywa script-src, bez 'unsafe-inline', hashem dla skryptów,
    // które kontrolujemy. NIE blokuje niczego — tylko raportuje, co złamałaby ściślejsza
    // polityka; oczekiwany szum: własne inline skrypty Next.js (patrz ADR wyżej) będą się
    // zgłaszać jako naruszenia dopóki projekt nie zdecyduje się na nonce+utratę ISR. Poza dev,
    // żeby nie zaśmiecać lokalnego devu (HMR).
    const scriptSrcReportOnly = !isDev
      ? [
          `script-src 'self' ${scriptHashes().join(' ')} ${scriptSrcHosts}`,
          `report-uri ${CSP_REPORT_PATH}`,
          `report-to ${CSP_REPORT_GROUP}`,
        ].join('; ')
      : null;

    const security = [
      { key: 'Content-Security-Policy', value: csp.join('; ') },
      ...(scriptSrcReportOnly
        ? [{ key: 'Content-Security-Policy-Report-Only', value: scriptSrcReportOnly }]
        : []),
      { key: 'Reporting-Endpoints', value: `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"` },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      // P3-03: spójnie z CSP `frame-ancestors 'none'` (było SAMEORIGIN — konflikt).
      { key: 'X-Frame-Options', value: 'DENY' },
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
    // #394: pliki z public/ nie mają hasha w nazwie, więc bez `immutable` — dzień świeżości
    // i tydzień serwowania z cache podczas rewalidacji. Service worker zawsze świeży, żeby
    // aktualizacja nie utknęła w cache przeglądarki.
    const publicAssetCache = [
      { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
    ];
    return [
      { source: '/:path*', headers: security },
      { source: '/images/:path*', headers: publicAssetCache },
      {
        source: '/:file(icon-[a-z0-9-]+\\.png|icon\\.svg|apple-touch-icon\\.png|og\\.png)',
        headers: publicAssetCache,
      },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }] },
    ];
  },
};

export default withNextIntl(nextConfig);
