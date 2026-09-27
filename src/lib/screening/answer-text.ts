import { localizedText, type ScreeningAnswer } from '@/lib/screening/questions';

export interface ScreeningAnswerLabels {
  yes: string;
  no: string;
  noAnswer: string;
}

/**
 * Tekst odpowiedzi na pytanie screeningowe (#101) ze snapshotu: treść opcji z chwili wysłania,
 * nie z bieżącej oferty; data bez przesunięcia strefy (dzień kalendarzowy); brak odpowiedzi →
 * `labels.noAnswer`. Wspólne dla karty „Moje odpowiedzi” i szczegółu zgłoszenia kandydata.
 */
export function screeningAnswerText(answer: ScreeningAnswer, locale: string, labels: ScreeningAnswerLabels): string {
  if (answer.type === 'yes_no' && answer.answerBoolean !== null) {
    return answer.answerBoolean ? labels.yes : labels.no;
  }
  if (answer.type === 'date' && answer.answerDate) {
    const ts = Date.parse(`${answer.answerDate}T12:00:00Z`);
    if (!Number.isNaN(ts)) {
      return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(ts);
    }
  }
  if (answer.type === 'single_choice' && answer.answerText) {
    const option = answer.options.find((o) => o.id === answer.answerText);
    return option ? localizedText(option.label, locale) : answer.answerText;
  }
  if (answer.type === 'short_text' && answer.answerText) return answer.answerText;
  return labels.noAnswer;
}
