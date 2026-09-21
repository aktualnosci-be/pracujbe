import 'server-only';
import { createRuntimePool } from './pool';

let domain: ReturnType<typeof createRuntimePool> | undefined;

/** Leniwa pula procesu. Błąd inicjalizacji nie zostaje utrwalony do restartu. */
export function getDomainPool() {
  if (!domain) {
    const url = process.env.DATABASE_APP_URL;
    if (!url) throw new Error('Brak konfiguracji ograniczonego połączenia aplikacji.');
    domain = createRuntimePool(url, 'domain').catch(error => {
      domain = undefined;
      throw error;
    });
  }
  return domain;
}
