/**
 * Data odniesienia dla ważności certyfikatów (#96): bieżący dzień kalendarzowy w Belgii
 * ('YYYY-MM-DD'). Ta sama funkcja zasila matching na serwerze i oznaczenie „wygasł" w UI,
 * więc oba miejsca zgadzają się co do granicy dnia.
 */
export function referenceDate(now: Date = new Date()): string {
  // en-CA formatuje datę jako YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
