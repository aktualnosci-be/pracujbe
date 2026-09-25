import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import { cronSecretsFor, type CronTask } from './secrets';

/** Porównanie stałoczasowe (bez wycieku długości): najpierw bufory równej długości. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** `Authorization: Bearer <sekret>` z sekretem tego zadania (`src/lib/cron/secrets.ts`). */
export function isCronAuthorized(request: Request, task: CronTask): boolean {
  const header = request.headers.get('authorization');
  if (!header) return false;
  return cronSecretsFor(task).some((secret) => safeEqual(header, `Bearer ${secret}`));
}
