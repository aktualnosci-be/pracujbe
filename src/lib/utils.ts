import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Łączy klasy Tailwind: clsx (warunki/tablice) + tailwind-merge (deduplikacja konfliktów).
 * Używany przez wszystkie komponenty UI (shadcn-style).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
