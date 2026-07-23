import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Locale-aware odpowiedniki next/navigation. Używaj TYCH zamiast next/link i next/navigation
 * w komponentach, żeby linki automatycznie zachowywały prefiks języka.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
