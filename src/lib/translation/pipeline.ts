import { GLOSSARY_VERSION } from '@/lib/translation/glossary';

/**
 * Wersja pipeline tłumaczeń = prompt + walidator + glosariusz. Wchodzi do klucza
 * deduplikacji zadań (`translation_jobs_dedup`, 0127): zmiana wersji przy tej samej treści
 * kolejkuje nowe zadania (`requeued`) zamiast nowej rewizji.
 * Format zgodny z CHECK w bazie: `^[a-z0-9][a-z0-9.+_-]{0,63}$`.
 */
export const PROMPT_VERSION = 'prompt-v1';
export const TRANSLATION_PIPELINE_VERSION = `translation-v1+${PROMPT_VERSION}+${GLOSSARY_VERSION}`;
