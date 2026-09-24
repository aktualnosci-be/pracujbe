import 'server-only';
import type { Pool } from 'pg';
import { createRuntimePool } from './pool';

let domain: ReturnType<typeof createRuntimePool> | undefined;
let domainReady: Pool | undefined;
let ops: ReturnType<typeof createRuntimePool> | undefined;

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

let service: ReturnType<typeof createRuntimePool> | undefined;

/**
 * Leniwa pula zadań uprzywilejowanych (#25): osobny login z jedynym członkostwem
 * service_role (`DATABASE_SERVICE_URL`). Używają jej wyłącznie worker poczty, webhooki,
 * cron maintenance, limiter i odczyty panelu admina po `requireAdmin` — nigdy loadery
 * paneli kandydata/pracodawcy.
 */
export function getServicePool() {
  if (!service) {
    const url = process.env.DATABASE_SERVICE_URL;
    if (!url) throw new Error('Brak konfiguracji połączenia zadań serwerowych.');
    service = createRuntimePool(url, 'service').catch(error => {
      service = undefined;
      throw error;
    });
  }
  return service;
}
