/**
 * Przycisk menu wąskiego nagłówka ma stały rozmiar w px równy wysokości „pigułki” konta
 * z prototypu (`.people .nav .account .navlink`, 38 px): nagłówek ma wtedy wysokość
 * z prototypu (77 px), a przy 320 px i tekście 200% ikona nie rośnie, więc pasek się mieści
 * (WCAG 1.4.10). Cel dotykowy 38 px ≥ 24 px (WCAG 2.5.8 AA).
 */
export const HEADER_ICON_BUTTON_FIXED = 'h-[38px] w-[38px] [&_svg]:size-[16px]';
