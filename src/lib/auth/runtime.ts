import 'server-only';

import type { Pool } from 'pg';
import { env, isAuthRuntimeConfigured } from '@/lib/env';
import { createRuntimePool } from '@/lib/db/pool';
import { createAuthServer } from './server';

type AuthRuntime = ReturnType<typeof createAuthServer>;

let runtime: Promise<AuthRuntime> | undefined;

async function initializeAuthRuntime(): Promise<AuthRuntime> {
  if (!isAuthRuntimeConfigured()) {
    throw new Error('Brak konfiguracji serwera uwierzytelniania.');
  }

  let pool: Pool | undefined;
  try {
    pool = await createRuntimePool(env.authDatabaseUrl!, 'auth');
    return createAuthServer({
      pool,
      baseURL: env.authBaseUrl!,
      secret: env.authSecret!,
    });
  } catch {
    await pool?.end().catch(() => undefined);
    // Błędy sterownika i SDK mogą zawierać URL, login lub sekret konfiguracji.
    throw new Error('Nie można uruchomić serwera uwierzytelniania.');
  }
}

/**
 * Leniwa instancja procesu. Równoległe wywołania współdzielą inicjalizację, a błąd
 * usuwa odrzucony promise, aby następne żądanie mogło bezpiecznie ponowić próbę.
 */
export function getAuthRuntime(): Promise<AuthRuntime> {
  if (!runtime) {
    runtime = initializeAuthRuntime().catch(error => {
      runtime = undefined;
      throw error;
    });
  }
  return runtime;
}
