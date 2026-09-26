import { describe, expect, it } from 'vitest';
import { isPublicHttpsUrl, sameOriginHost } from '@/lib/company-links';

/**
 * Lustro reguły `public.public_https_url` (0114/0141) — ta sama reguła musi obowiązywać
 * w formularzu (Zod) i w bazie (CHECK), inaczej formularz przepuści to, co baza odrzuci
 * (albo odwrotnie, dając mylący błąd zapisu po przejściu walidacji klienta).
 */
describe('isPublicHttpsUrl', () => {
  it('accepts absolute https addresses with a dotted host', () => {
    expect(isPublicHttpsUrl('https://example.com')).toBe(true);
    expect(isPublicHttpsUrl('https://www.example.com/logo.png')).toBe(true);
    expect(isPublicHttpsUrl('https://sub.example.co.uk:8443/a/b?x=1#y')).toBe(true);
    expect(isPublicHttpsUrl('  https://example.com  ')).toBe(true); // przycinane białe znaki
  });

  it('rejects everything that is not an absolute https URL', () => {
    expect(isPublicHttpsUrl('')).toBe(false);
    expect(isPublicHttpsUrl('http://example.com')).toBe(false); // nie-https
    expect(isPublicHttpsUrl('https://user:pass@example.com')).toBe(false); // dane logowania
    expect(isPublicHttpsUrl('https://example')).toBe(false); // bez kropki w hoście
    expect(isPublicHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isPublicHttpsUrl('/relative/path')).toBe(false);
    expect(isPublicHttpsUrl('https://exa mple.com')).toBe(false); // spacja
    expect(isPublicHttpsUrl('https://example.com "onload=x')).toBe(false); // cudzysłów
    expect(isPublicHttpsUrl('https://<script>.com')).toBe(false); // nawiasy kątowe
  });

  it('rejects addresses over 2048 characters', () => {
    const long = `https://example.com/${'a'.repeat(2048)}`;
    expect(isPublicHttpsUrl(long)).toBe(false);
  });
});

describe('sameOriginHost', () => {
  it('matches only the exact host of the site, case-insensitively', () => {
    expect(sameOriginHost('https://pracuj.be/og.png', 'pracuj.be')).toBe(true);
    expect(sameOriginHost('https://PRACUJ.BE/og.png', 'pracuj.be')).toBe(true);
    expect(sameOriginHost('https://cdn.pracuj.be/og.png', 'pracuj.be')).toBe(false);
    expect(sameOriginHost('https://example.com', 'pracuj.be')).toBe(false);
  });

  it('never previews when the own host is unknown or the URL is unparsable', () => {
    expect(sameOriginHost('https://pracuj.be', '')).toBe(false);
    expect(sameOriginHost('not a url', 'pracuj.be')).toBe(false);
  });
});
