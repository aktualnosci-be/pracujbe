import { z } from 'zod/v3';
import { routing } from '@/i18n/routing';

/**
 * Język serwisu (PL/NL/FR/EN) — osobny moduł, żeby schematy aplikowania (JS szczegółu oferty)
 * nie wciągały całych schematów rejestracji z `validation/auth` (budżet JS, #395).
 */
export const localeSchema = z.enum(routing.locales);
