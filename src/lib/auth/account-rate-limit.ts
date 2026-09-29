import { createHash } from 'node:crypto';

/**
 * Identyfikator konta/adresu dla limitów niezależnych od adresu IP: skrót znormalizowanego
 * adresu e-mail (mała litera, bez spacji na brzegach). Do limitera trafia skrót, nie adres.
 */
export function accountRateLimitKey(email: string): string {
  return createHash('sha256').update(`account:${email.trim().toLowerCase()}`).digest('hex');
}
