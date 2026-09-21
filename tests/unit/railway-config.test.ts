// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import config from '../../next.config.mjs';

afterEach(() => vi.unstubAllEnvs());

it('zostawia miejsce na multipart dla CV do 5 MB', () => {
  expect(config.experimental?.serverActions?.bodySizeLimit).toBe('6mb');
});

it.each([
  ['production', 'https://pracuj.be', true],
  ['production', 'https://staging.pracuj.be', false],
  ['', 'https://pracuj.be', false],
])('wylicza nagłówki dla trybu %s i adresu %s', async (mode, url, production) => {
  vi.stubEnv('APP_MODE', mode);
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', url);
  const rules = await config.headers!();
  const headers = rules[0]!.headers;
  expect(headers.some((header) => header.key === 'Strict-Transport-Security')).toBe(production);
  expect(headers.some((header) => header.key === 'X-Robots-Tag')).toBe(!production);
});

