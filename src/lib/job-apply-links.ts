/**
 * Linki „Aplikuj u pracodawcy” (#1130) — decyzja produktowa: portal ogłoszeniowy.
 *
 * Jedyne cele CTA aplikacyjnego na szczególe oferty w trybie ogłoszeniowym: kanały, które podał
 * ogłoszeniodawca (`JobDetail.applyChannel`, #1129 / 0172). Kolejność = pierwszeństwo przycisku
 * głównego: strona (https) → e-mail → telefon.
 *
 * Każda wartość jest sprawdzana trzeci raz (baza CHECK → `parseJobApplyChannel` → tutaj), więc
 * link nigdy nie dostaje schematu innego niż `https:`, `mailto:` albo `tel:`. Parametry `mailto:`
 * (temat) składa aplikacja — pole e-maila nie może ich zawierać (`isApplyEmail`).
 */

import { isApplyEmail, isApplyPhone, isApplyUrl, normalizeApplyPhone } from '@/lib/job-apply-channel';
import type { JobApplyChannel } from '@/lib/jobs';

export type ApplyLinkKind = 'url' | 'email' | 'phone';

export interface ApplyLink {
  kind: ApplyLinkKind;
  href: string;
  /** Tekst widoczny obok etykiety: host strony, adres e-mail albo numer. */
  display: string;
  /** Tylko strona otwiera się w nowej karcie (`target=_blank`, `rel` bez `opener`/`referrer`). */
  external: boolean;
}

/** `rel` linku zewnętrznego: bez dostępu do `window.opener`, bez Referer, bez przekazania rankingu. */
export const APPLY_LINK_REL = 'noopener noreferrer nofollow';

export function buildApplyLinks(channel: JobApplyChannel | undefined, mailSubject: string): ApplyLink[] {
  if (!channel) return [];
  const links: ApplyLink[] = [];
  const url = channel.url?.trim();
  if (url && isApplyUrl(url)) {
    links.push({ kind: 'url', href: new URL(url).href, display: new URL(url).hostname, external: true });
  }
  const email = channel.email?.trim();
  if (email && isApplyEmail(email)) {
    const subject = mailSubject.trim();
    links.push({
      kind: 'email',
      href: `mailto:${email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`,
      display: email,
      external: false,
    });
  }
  const phone = channel.phone ? normalizeApplyPhone(channel.phone) : '';
  if (phone && isApplyPhone(phone)) {
    links.push({ kind: 'phone', href: `tel:${phone}`, display: phone, external: false });
  }
  return links;
}

/** Schemat dozwolony dla celu CTA aplikacyjnego (strażnik `tests/legal`). */
export function isApplyLinkHref(href: string): boolean {
  return /^(https:\/\/|mailto:|tel:\+)/.test(href);
}
