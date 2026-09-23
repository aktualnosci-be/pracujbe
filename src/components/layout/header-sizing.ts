/**
 * Przyciski-ikony wąskiego nagłówka mają stały rozmiar w px (identyczny z `size: icon`
 * przy 100%): przy 320 px i tekście 200% ikony nie rosną, więc nagłówek się mieści
 * (WCAG 1.4.10); cel dotykowy zostaje 44 px (WCAG 2.5.8).
 */
export const HEADER_ICON_BUTTON_FIXED = 'h-[44px] w-[44px] [&_svg]:size-[16px]';
