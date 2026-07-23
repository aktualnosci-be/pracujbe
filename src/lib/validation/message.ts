import { z } from 'zod';

/**
 * Walidacja treści wiadomości w konwersacji (Etap 6).
 *
 * Zakres spójny z RPC `send_message` (migracja 0016): 1–5000 znaków po przycięciu białych
 * znaków. Warstwa akcji nie pokazuje surowych komunikatów Zod — przy niepowodzeniu zwraca
 * kod `VALIDATION_FAILED`, który UI mapuje na komunikat z klucza tłumaczenia (Invariant #8).
 */
export const messageBodySchema = z.string().trim().min(1).max(5000);

export type MessageBodyInput = z.infer<typeof messageBodySchema>;
