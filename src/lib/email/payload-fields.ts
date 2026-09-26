import type { GUEST_EMAIL_TYPES, QUEUED_EMAIL_TYPES } from '@/emails/wiring';

/**
 * Minimalizacja treści e-maili (#503): pola payloadu kolejki, które worker może przekazać
 * do szablonu — a więc do HTML/tekstu wysyłanego dostawcy poczty.
 *
 * Wszystko spoza listy worker odrzuca przed renderem (`minimizeEmailPayload` w
 * `delivery-data.ts`), nawet jeśli funkcja SQL dołoży nowe pole. Celowo POZA listą:
 * - treść korespondencji: `preview` (podgląd wiadomości) i `message` (wiadomość do propozycji)
 *   — e-mail prowadzi do panelu, gdzie odbiorca czyta ją po zalogowaniu; propozycja niesie
 *   tylko oczyszczony, krótki `messageExcerpt` (`src/lib/email/message-excerpt.ts`);
 * - pola, których szablon nie pokazuje (np. `query` zapisanego wyszukiwania, `reason` przy
 *   weryfikacji firmy, `companyName` i `appealTarget` w odwołaniu, `jobTitle` przy zawieszeniu firmy).
 * CV, odpowiedzi screeningowe, telefon i dane kontaktowe osób trzecich nie mają tu miejsca —
 * pilnuje tego `tests/unit/email-payload-minimization.test.ts` (z kontrolą ujemną).
 *
 * Pola routingu (`panel`, `conversationId`, `appellantRole`, `caseNumber`, `accessCode`)
 * służą do zbudowania linku do panelu (`emailTargetPath`).
 */
type DeliveredType = (typeof QUEUED_EMAIL_TYPES)[number] | (typeof GUEST_EMAIL_TYPES)[number];

export const EMAIL_PAYLOAD_FIELDS = {
  newApplication: ['candidateName', 'jobTitle'],
  applicationViewed: ['companyName', 'jobTitle'],
  statusChanged: ['companyName', 'jobTitle', 'status'],
  // `messageExcerpt` (decyzja 26.09.2026): ≤ 200 znaków wiadomości rekrutera bez danych
  // kontaktowych i identyfikatorów — liczy worker (`message-excerpt.ts`); pełny `message` odrzucany.
  jobOffer: ['companyName', 'jobTitle', 'salaryMin', 'salaryMax', 'salaryPeriod', 'currency', 'expiresAt', 'messageExcerpt'],
  offerAccepted: ['candidateName', 'jobTitle'],
  offerDeclined: ['candidateName', 'jobTitle'],
  newMessage: ['senderName', 'panel', 'conversationId', 'attachmentCount'],
  jobPublished: ['jobTitle'],
  companyVerified: ['companyName'],
  companyRejected: ['companyName', 'reason'],
  companySuspended: ['companyName', 'reason'],
  teamInvitation: ['companyName', 'inviterName', 'panel'],
  jobMatch: ['searchName', 'count', 'jobs'],
  reportReceived: ['recipientName', 'caseNumber', 'accessCode', 'targetType'],
  reportDecisionActioned: ['recipientName', 'caseNumber', 'targetType'],
  reportDecisionNoAction: ['recipientName', 'caseNumber', 'targetType'],
  reportRestored: ['recipientName', 'caseNumber'],
  // 0208: wynik zgłoszenia wiadomości — bez dowodu, opisu i kategorii; `panel`/`conversationId` = CTA.
  messageReportResolved: ['panel', 'targetType', 'conversationId'],
  messageReportDismissed: ['panel', 'targetType', 'conversationId'],
  moderationJobRemoved: [
    'companyName',
    'jobTitle',
    'facts',
    'groundType',
    'groundReference',
    'automatedDetection',
    'decisionReference',
  ],
  moderationCompanySuspended: [
    'companyName',
    'facts',
    'groundType',
    'groundReference',
    'automatedDetection',
    'decisionReference',
  ],
  moderationRestored: ['companyName', 'jobTitle', 'reason', 'decisionReference'],
  appealReceived: ['recipientName', 'appealReference', 'appellantRole', 'caseNumber', 'decisionReference'],
  appealUpheld: ['recipientName', 'appealReference', 'appellantRole', 'caseNumber', 'decisionReference', 'reasoning'],
  appealReversed: ['recipientName', 'appealReference', 'appellantRole', 'caseNumber', 'decisionReference', 'reasoning'],
  breachNotice: ['incidentReference', 'noticeSubject', 'noticeText', 'panel'],
  guestApplicationConfirm: ['recipientName', 'companyName', 'jobTitle'],
  guestApplicationSent: ['recipientName', 'companyName', 'jobTitle'],
  // #98 (0122): e-mail do gościa o zmianie statusu — ten sam zakres co statusChanged + powitanie.
  guestStatusChanged: ['recipientName', 'companyName', 'jobTitle', 'status'],
  // #403 (0121): zaproszenie na adres bez konta — link składa worker z `nonce` przed minimalizacją.
  teamInvitationSignup: ['companyName', 'inviterName'],
  // #61 (0125): formularz kontaktu — numer sprawy i temat; bez treści i adresu nadawcy.
  supportContact: ['reference', 'topic', 'recipientName'],
  contactMessageAdmin: ['reference', 'topic'],
  // #574 (0127): ostrzeżenie przed usunięciem — sama data usunięcia.
  inactiveCvWarning: ['deletionDate'],
  inactiveAccountWarning: ['deletionDate'],
} as const satisfies Record<DeliveredType, readonly string[]>;

/** Payload ograniczony do pól dozwolonych dla szablonu; nieznany szablon → pusty obiekt. */
export function minimizeEmailPayload(
  template: string,
  payload: Record<string, unknown> | null,
): Record<string, unknown> {
  const allowed: readonly string[] | undefined = Object.hasOwn(EMAIL_PAYLOAD_FIELDS, template)
    ? EMAIL_PAYLOAD_FIELDS[template as DeliveredType]
    : undefined;
  if (!allowed || !payload) return {};
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (Object.hasOwn(payload, key)) out[key] = payload[key];
  }
  return out;
}
