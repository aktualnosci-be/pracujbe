import { z } from 'zod/v3';

/**
 * Walidacja treści wiadomości w konwersacji (Etap 6).
 *
 * Górny limit = `CHECK (length(body) <= 4000)` na `messages` (migracja 0026) — najostrzejszy
 * z limitów w bazie (RPC `send_message` dopuszcza 5000, ale zapis i tak odrzuci dłuższe).
 * Ta sama stała steruje `maxLength` i licznikiem w `MessageComposer`. `String.length` liczy
 * jednostki UTF-16, więc jest nie mniej restrykcyjne niż `length()` w PostgreSQL (znaki).
 * Warstwa akcji nie pokazuje surowych komunikatów Zod — przy niepowodzeniu zwraca kod
 * `VALIDATION_FAILED`, który UI mapuje na komunikat z klucza tłumaczenia (Invariant #8).
 */
export const MESSAGE_BODY_MAX_LENGTH = 4000;

export const messageBodySchema = z.string().trim().min(1).max(MESSAGE_BODY_MAX_LENGTH);

export type MessageBodyInput = z.infer<typeof messageBodySchema>;
