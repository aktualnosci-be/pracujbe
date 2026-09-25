import 'server-only';
import type { Pool } from 'pg';
import { createRuntimePool } from './pool';

let domain: ReturnType<typeof createRuntimePool> | undefined;
let domainReady: Pool | undefined;
let ops: ReturnType<typeof createRuntimePool> | undefined;
let rateLimit: ReturnType<typeof createRuntimePool> | undefined;
let authMail: ReturnType<typeof createRuntimePool> | undefined;

/** Leniwa pula procesu. Błąd inicjalizacji nie zostaje utrwalony do restartu. */
export function getDomainPool() {
  if (!domain) {
    const url = process.env.DATABASE_APP_URL;
    if (!url) throw new Error('Brak konfiguracji ograniczonego połączenia aplikacji.');
    domain = createRuntimePool(url, 'domain').then(pool => {
      domainReady = pool;
      return pool;
    }, error => {
      domain = undefined;
      throw error;
    });
  }
  return domain;
}

/**
 * Stan puli domenowej TEGO procesu (#47) — bez tworzenia puli. null = pula jeszcze
 * nieużyta. Same liczniki sterownika, bez adresu i loginu.
 */
export function domainPoolStats(): { total: number; idle: number; waiting: number; max: number } | null {
  if (!domainReady) return null;
  return {
    total: domainReady.totalCount,
    idle: domainReady.idleCount,
    waiting: domainReady.waitingCount,
    max: domainReady.options.max ?? 0,
  };
}

/** Leniwa pula monitoringu (#47): osobny login z członkostwem tylko w pracujbe_ops. */
export function getOpsPool() {
  if (!ops) {
    const url = process.env.DATABASE_OPS_URL;
    if (!url) throw new Error('Brak konfiguracji połączenia monitoringu.');
    ops = createRuntimePool(url, 'ops').catch(error => {
      ops = undefined;
      throw error;
    });
  }
  return ops;
}

/** Leniwa pula limitera (0058): login z członkostwem wyłącznie w pracujbe_rate_limit. */
export function getRateLimitPool() {
  if (!rateLimit) {
    const url = process.env.DATABASE_RATE_LIMIT_URL;
    if (!url) throw new Error('Brak konfiguracji połączenia limitera.');
    rateLimit = createRuntimePool(url, 'rate_limit').catch(error => {
      rateLimit = undefined;
      throw error;
    });
  }
  return rateLimit;
}

/** Leniwa pula workera wiadomości auth (0061): członkostwo wyłącznie w pracujbe_auth_mail. */
export function getAuthMailPool() {
  if (!authMail) {
    const url = process.env.DATABASE_AUTH_MAIL_URL;
    if (!url) throw new Error('Brak konfiguracji połączenia kolejki wiadomości auth.');
    authMail = createRuntimePool(url, 'auth_mail').catch(error => {
      authMail = undefined;
      throw error;
    });
  }
  return authMail;
}
