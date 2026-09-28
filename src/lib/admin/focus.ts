/**
 * Klucze celów fokusu w panelu admina (#415) — `data-admin-focus` na nagłówkach wierszy/kart
 * (`tabIndex={-1}`) i na nagłówku strony. Zwykły moduł (bez `'use client'`), bo klucze są
 * używane i przez strony serwerowe, i przez komponenty klienckie.
 */

/** Nagłówek strony — cel fokusu, gdy zaktualizowana pozycja zniknęła z listy. */
export const ADMIN_PAGE_HEADING_FOCUS = 'page-heading';

export function companyFocusKey(id: string): string {
  return `company-${id}`;
}

export function reportFocusKey(id: string): string {
  return `report-${id}`;
}

export function emailSuppressionFocusKey(id: string): string {
  return `email-suppression-${id}`;
}

export function appealFocusKey(id: string): string {
  return `appeal-${id}`;
}

export function screeningReviewFocusKey(id: string): string {
  return `screening-review-${id}`;
}

export function contactMessageFocusKey(id: string): string {
  return `contact-message-${id}`;
}

export function emailCampaignFocusKey(id: string): string {
  return `email-campaign-${id}`;
}

/** 0910: przegląd treści oferty z sygnałem oszustwa. */
export function jobContentReviewFocusKey(id: string): string {
  return `job-content-review-${id}`;
}

/** 0910: sekcja agencji pracy tymczasowej w szczególe firmy. */
export function agencyCheckFocusKey(companyId: string): string {
  return `agency-check-${companyId}`;
}
