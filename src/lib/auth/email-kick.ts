import 'server-only';

import { after } from 'next/server';

import { captureError } from '@/lib/error-report';

/**
 * Natychmiastowa wysyłka e-maili konta (bloker startu W1, `docs/LAUNCH_CHECKLIST.md` §1).
 *
 * Rejestracja, logowanie niepotwierdzonego konta i prośba o reset hasła zapisują zlecenie
 * w `auth.email_outbox` (0061) w transakcji SDK. Do tej pory list wychodził dopiero przy
 * następnym wywołaniu `/api/email/process` przez harmonogram — bez harmonogramu nowy
 * użytkownik nie dostawał linku potwierdzającego i nie mógł się zalogować.
 *
 * Po zakończeniu akcji (`after()` z Next.js — po wysłaniu odpowiedzi, więc bez wpływu na czas
 * odpowiedzi i bez sygnału o istnieniu konta przy resecie) uruchamiamy JEDNĄ małą paczkę tego
 * samego workera co cron (`processAuthEmailQueue`: claim z dzierżawą, budżet puli `auth`,
 * klucz idempotencji dostawcy). Równoległy przebieg crona nie wyśle drugiego listu. Harmonogram
 * nadal jest potrzebny do ponowień i do kolejki `email_deliveries` (powiadomienia domeny).
 *
 * Wyłącznik awaryjny: `AUTH_EMAIL_IMMEDIATE_SEND=off` (dokładnie ta wartość) — listy konta
 * wychodzą wtedy wyłącznie z harmonogramu, jak przed zmianą.
 */

type Env = Record<string, string | undefined>;

/** Wielkość paczki jednego „kopnięcia” — tyle, ile zwykle zleca jedna akcja, z zapasem. */
export const AUTH_EMAIL_KICK_LIMIT = 5;

export function authEmailKickEnabled(env: Env = process.env): boolean {
  return env.AUTH_EMAIL_IMMEDIATE_SEND !== 'off';
}

export interface AuthEmailKickDeps {
  env: Env;
  /** Planowanie po odpowiedzi — w produkcji `after` z `next/server`. */
  schedule: (task: () => Promise<void>) => void;
  /** Worker kolejki kont — w produkcji `processAuthEmailQueue` (import leniwy). */
  process: (limit: number) => Promise<unknown>;
}

async function defaultProcess(limit: number): Promise<unknown> {
  const { processAuthEmailQueue } = await import('./email-worker');
  return processAuthEmailQueue(limit);
}

/**
 * Planuje jedną paczkę workera kont po zakończeniu bieżącego żądania. Nigdy nie rzuca:
 * awaria planowania (np. wywołanie poza żądaniem) lub workera nie zmienia wyniku akcji —
 * zlecenie zostaje w kolejce dla harmonogramu. Zwraca, czy paczka została zaplanowana.
 */
export function kickAuthEmailQueue(deps: Partial<AuthEmailKickDeps> = {}): boolean {
  if (!authEmailKickEnabled(deps.env ?? process.env)) return false;
  const run = deps.process ?? defaultProcess;
  const schedule = deps.schedule ?? after;
  try {
    schedule(async () => {
      try {
        await run(AUTH_EMAIL_KICK_LIMIT);
      } catch (error) {
        captureError(error, { area: 'auth.email.kick' });
      }
    });
    return true;
  } catch {
    // Poza zakresem żądania (testy, skrypty) `after` rzuca — list wyśle harmonogram.
    return false;
  }
}
