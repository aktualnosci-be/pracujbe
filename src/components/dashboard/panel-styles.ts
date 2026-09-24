/**
 * Klasy paneli (administrator, pracodawca) — kalka prototypu „04 Ludzie i praca”
 * (`docs/design/people-passport/prototype/`, widok panelu: `.people .dashboard`, #5).
 * Panel admina (#483) był pierwszy; panel pracodawcy i kreator oferty używają tych samych klas.
 *
 * Wartości (rozmiary, wagi, odstępy, promienie, breakpoint 600 px) przepisane 1:1 z
 * `style.css` + `people.css`, zmierzone w przeglądarce przy 1280 i 390 px. Odstępstwa:
 *   - kolory wyłącznie tokenami z `globals.css` (najbliższy token zamiast hexa prototypu;
 *     szarości tekstu `#686868`/`#777` → `muted-foreground`, bo `#777` na bieli ma < 4,5:1);
 *   - obramowanie pól formularza `border-input` (WCAG 1.4.11), cele dotyku ≥ 44 px;
 *   - font: Inter z `main` (DM Sans nie jest jeszcze wdrożony), waga 750 → 700 (oś 400–700).
 * Breakpoint prototypu to `@container (max-width: 600px)` → tu `max-[600px]:`.
 */

/** `.eyebrow` — 11 px, 700, rozstrzelenie .16em, kolor marki. */
export const EYEBROW =
  'block break-words text-[11px] font-bold uppercase tracking-[0.16em] text-primary';

/** `.dash-content h1` — 34 px / 750, interlinia 1.08, −0.05em, margines 8 px; ≤ 600 px: 30 px. */
export const H1 =
  'my-2 break-words text-[34px] font-bold leading-[1.08] tracking-[-0.05em] text-foreground max-[600px]:text-[30px]';

/** `.dash-intro` — 14 px, interlinia 1.7, margines górny 6 px. */
export const INTRO = 'mt-1.5 max-w-2xl text-sm leading-[1.7] text-muted-foreground';

/** `.stats` — siatka kafelków w jednej ramce, promień 16 px (≤ 600 px: 15 px), margines 22/28 px. */
export const STATS =
  'mb-7 mt-[22px] grid min-w-0 gap-px overflow-hidden rounded-[16px] border border-border bg-border max-[600px]:rounded-[15px]';

/** `.stat` — padding 21 px (≤ 600 px: 15/10 px); separator = 1 px tła siatki. */
export const STAT = 'block min-w-0 bg-card p-[21px] max-[600px]:px-[10px] max-[600px]:py-[15px]';

/** `.stat span` — 12 px, min. 30 px (≤ 600 px: 10 px / 31 px). */
export const STAT_LABEL =
  'block min-h-[30px] break-words text-xs text-muted-foreground max-[600px]:min-h-[31px] max-[600px]:text-[10px]';

/** `.stat strong` — 34 px / 650, −0.05em, margines 8 px (≤ 600 px: 30 px). */
export const STAT_VALUE =
  'my-2 block text-[34px] font-[650] tracking-[-0.05em] text-foreground max-[600px]:text-[30px]';

/** `.stat small` — 11 px (≤ 600 px: 10 px). */
export const STAT_SMALL = 'break-words text-[11px] text-muted-foreground max-[600px]:text-[10px]';

/** `.panel` — ramka, promień 17 px, padding 23 px (≤ 600 px: 19 px). */
export const PANEL =
  'min-w-0 rounded-[17px] border border-border bg-card p-[23px] max-[600px]:p-[19px]';

/** `.panel h2` — 22 px / 700, −0.035em (≤ 600 px: 21 px). */
export const PANEL_H2 =
  'min-w-0 break-words text-[22px] font-bold tracking-[-0.035em] text-foreground max-[600px]:text-[21px]';

/** `.panel p` — 12 px, interlinia 18 px. */
export const PANEL_P = 'text-xs leading-[18px] text-muted-foreground';

/** `.panel .section-head` — flex, odstęp 20 px, margines dolny 24 px; ≤ 600 px: kolumna, 10 px. */
export const SECTION_HEAD =
  'mb-6 flex min-w-0 flex-wrap items-center justify-between gap-5 max-[600px]:flex-col max-[600px]:items-start max-[600px]:gap-2.5';

/** `.table-wrap` + `th` — 11 px / 500, padding 17/12/17/0, linia dolna. */
export const TABLE_WRAP = 'overflow-x-auto';
export const TH =
  'whitespace-nowrap border-b border-border py-[17px] pr-3 text-left text-[11px] font-medium text-muted-foreground';
/** `td` — 13 px, padding 17/12/17/0, linia dolna, bez zawijania (nazwy: patrz `TD_WRAP`). */
export const TD =
  'whitespace-nowrap border-b border-border py-[17px] pr-3 align-middle text-[13px] text-foreground';
/** Kolumna nazwy może się zawijać (długie nazwy firm/osób) — odstępstwo dla czytelności. */
export const TD_WRAP =
  'border-b border-border py-[17px] pr-3 align-middle text-[13px] text-foreground';

/** `.tag` — 11 px, padding 5/8 px, promień 6 px, tło szarości (≤ 600 px: 10 px). */
export const TAG =
  'inline-block max-w-full break-words rounded-[6px] bg-muted px-2 py-[5px] text-[11px] text-muted-foreground max-[600px]:text-[10px]';

/** `.job` w panelu — wiersz listy: odstęp 18 px, padding 25 px 0, linia górna; ≤ 600 px: 22 px, 12 px. */
export const ROW =
  'flex min-w-0 gap-[18px] border-t border-border py-[25px] first:border-t-0 first:pt-0 max-[600px]:gap-3 max-[600px]:py-[22px]';

/** `.company-icon` — 48 px, promień 14 px, tło soft, linia; ≤ 600 px: 42 px. */
export const ICON_BOX =
  'grid size-12 shrink-0 place-items-center rounded-[14px] border border-border bg-soft text-xs font-semibold tracking-[-0.04em] text-muted-foreground max-[600px]:size-[42px] [&_svg]:size-5';

/** `.job h3` — 15 px / 600, −0.03em, margines dolny 7 px. */
export const ROW_TITLE =
  'mb-[7px] break-words text-[15px] font-semibold tracking-[-0.03em] text-foreground';

/** `.job p` — 12 px, interlinia 18 px. */
export const ROW_META = 'break-words text-xs leading-[18px] text-muted-foreground';

/** `.notice` — padding 20/23 px, promień 16 px, czerwona ramka na jasnym tle; ≤ 600 px: kolumna, 18 px. */
export const NOTICE =
  'my-[25px] flex min-w-0 items-center justify-between gap-5 rounded-[16px] border border-primary/25 bg-primary/5 px-[23px] py-5 text-sm max-[600px]:flex-col max-[600px]:items-start max-[600px]:p-[18px]';
/** `.notice strong` — 15 px / 650 (≤ 600 px: 14 px). */
export const NOTICE_TITLE =
  'block break-words text-[15px] font-[650] text-foreground max-[600px]:text-sm';
/** `.notice p` — 13 px, margines 6 px (≤ 600 px: 12 px). */
export const NOTICE_TEXT =
  'my-1.5 break-words text-[13px] text-muted-foreground max-[600px]:text-xs';

const BTN_BASE =
  'inline-flex max-w-full items-center justify-center gap-2.5 text-center [overflow-wrap:anywhere] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

/** `.people .btn` — 14 px / 650, padding 12/19 px, promień 11 px, min. 49 px, tło marki. */
export const BTN_PRIMARY = `${BTN_BASE} min-h-[49px] rounded-[11px] border border-primary bg-primary px-[19px] py-3 text-sm font-[650] text-primary-foreground hover:bg-primary-dark`;

/** `.btn.secondary` — białe tło, linia, tekst ink. */
export const BTN_SECONDARY = `${BTN_BASE} min-h-[49px] rounded-[11px] border border-border bg-card px-[19px] py-3 text-sm font-[650] text-foreground hover:bg-soft`;

/** `.people .notice .btn` — mniejszy przycisk akcji w wierszu: 12 px, padding 11/17 px, min. 44 px. */
export const BTN_SMALL = `${BTN_BASE} min-h-11 rounded-[11px] border bg-card px-[17px] py-[11px] text-xs font-[650]`;

/** `.text-link` — 14 px / 700, kolor marki, min. 44 px. */
export const TEXT_LINK =
  'inline-flex min-h-11 items-center gap-1.5 text-sm font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

/** Link w treści (nazwa firmy, cel zgłoszenia) — tekst ink, podkreślenie na hover. */
export const INLINE_LINK =
  'font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

/** `.search` — pole wyszukiwania: białe tło, padding 10 px, linia, promień 14 px, odstęp 12 px. */
export const SEARCH_BOX =
  'flex min-w-0 flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-2.5';

/** Pole formularza (`.filters select`: 13 px, padding 12/9 px) z obramowaniem `border-input`. */
export const FIELD =
  'mt-1 block min-h-11 w-full min-w-0 rounded-md border border-input bg-card px-[9px] py-3 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Etykieta pola — 12 px / 600. */
export const FIELD_LABEL = 'block text-xs font-semibold text-foreground';

/**
 * Chip filtra — kształt pigułki (cel 44 px); aktywny = `.side-item.active`
 * (jasne tło marki, ciemniejsza czerwień, waga 650).
 */
export function chipClass(isActive: boolean): string {
  return [
    'inline-flex min-h-11 max-w-full items-center break-words rounded-full border px-4 py-1 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    isActive
      ? 'border-transparent bg-primary/10 font-[650] text-primary-dark'
      : 'border-border bg-card font-medium text-foreground hover:bg-soft',
  ].join(' ');
}

/** `.empty` — padding 45/15 px, wyśrodkowany tekst muted. */
export const EMPTY = 'px-[15px] py-[45px] text-center text-sm text-muted-foreground';

/* ------------------------------------------------------------------------------------------
 * Ekrany formularzy i kart z `extended.css` prototypu (`#people/newjob`, `#people/talent`,
 * `#people/company`): `.extended h1/h2/h3`, `.paper`, `.demo-form`, `.form-grid`,
 * `.info-pairs`, `.status`, `.profile-avatar`, `.progress`. Breakpoint 600 px jak wyżej.
 * ---------------------------------------------------------------------------------------- */

/** `.people .extended h1` — 40 px, −0.045em, interlinia 1.15, margines 12/16 px; ≤ 600 px: 30 px. */
export const H1_EXTENDED =
  'mb-4 mt-3 break-words text-[40px] font-bold leading-[1.15] tracking-[-0.045em] text-foreground max-[600px]:text-[30px]';

/** `.people .extended h2` — 23 px, −0.025em, interlinia 1.3. */
export const H2_EXTENDED =
  'break-words text-[23px] font-bold leading-[1.3] tracking-[-0.025em] text-foreground';

/** `.people .extended h3` — 18 px, margines górny 27 px. */
export const H3_EXTENDED = 'mt-[27px] break-words text-lg font-bold text-foreground';

/** `.extended p` — 15 px, interlinia 1.7. */
export const P_EXTENDED = 'text-[15px] leading-[1.7] text-muted-foreground';

/** `.demo-note` — 12 px, interlinia 1.6, padding 12 px 0, linia dolna, margines 24 px. */
export const DEMO_NOTE =
  'mb-6 border-b border-border py-3 text-xs leading-[1.6] text-muted-foreground';

/** `.paper` — białe tło, linia, promień 22 px, padding 28 px, margines 20 px 0; ≤ 600 px: 20 px / 18 px. */
export const PAPER =
  'my-5 min-w-0 rounded-[22px] border border-border bg-card p-7 max-[600px]:rounded-[18px] max-[600px]:p-5';

/** `.form-grid` — dwie kolumny, odstęp 20 px, margines 22/28 px; ≤ 600 px: jedna kolumna. */
export const FORM_GRID =
  'mb-7 mt-[22px] grid min-w-0 grid-cols-2 gap-5 max-[600px]:grid-cols-1';

/** `.demo-form .wide` — pole na całą szerokość siatki. */
export const FORM_WIDE = 'col-span-2 max-[600px]:col-span-1';

/** `.demo-form label` — kolumna, odstęp 9 px, 13 px / 600. */
export const FORM_LABEL = 'flex min-w-0 flex-col gap-[9px] text-[13px] font-semibold text-foreground';

/**
 * `.demo-form input/textarea/select` — promień 11 px, padding 13/14 px, 15 px / 1.5, min. 48 px.
 * Obramowanie `border-input` zamiast `#d8d8d8` (WCAG 1.4.11); fokus = pierścień marki
 * (prototyp: outline 2 px #d92932, offset 2 px).
 */
export const FORM_CONTROL =
  'block min-h-12 w-full min-w-0 rounded-[11px] border border-input bg-card px-3.5 py-[13px] text-[15px] font-normal leading-[1.5] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-error';

/** `.demo-form .check-row` — wiersz, wyrównanie do środka, 400, margines 18 px 0. */
export const CHECK_ROW =
  'my-[18px] flex min-w-0 flex-row items-center gap-[9px] text-[13px] font-normal text-foreground';

/** `.demo-form input[type=checkbox]` — 19 px, kolor marki. */
export const CHECKBOX = 'size-[19px] shrink-0 accent-primary';

/** `.info-pairs` — dwie kolumny, odstęp 22 px, padding 22 px 0; ≤ 600 px: odstęp 17 px. */
export const INFO_PAIRS = 'grid min-w-0 grid-cols-2 gap-[22px] py-[22px] max-[600px]:gap-[17px]';
/** `.info-pairs small` — 11 px, wersaliki, .06em, margines 10 px. */
export const INFO_LABEL =
  'mb-2.5 block break-words text-[11px] uppercase tracking-[0.06em] text-muted-foreground';
/** `.info-pairs strong` — 15 px, interlinia 1.6. */
export const INFO_VALUE = 'block break-words text-[15px] font-bold leading-[1.6] text-foreground';

/** `.status` — padding 8/12 px, promień 8 px, szare tło, 12 px. */
export const STATUS =
  'inline-block max-w-full break-words rounded-[8px] bg-muted px-3 py-2 text-xs text-muted-foreground';
/** `.status.good` — zielone tło, ciemnozielony tekst. */
export const STATUS_GOOD =
  'inline-block max-w-full break-words rounded-[8px] bg-success/10 px-3 py-2 text-xs text-success-text';

/** `.profile-avatar` — 64 px, promień 20 px, tło ink, biały tekst 22 px / 700. */
export const PROFILE_AVATAR =
  'flex size-16 shrink-0 items-center justify-center rounded-[20px] bg-foreground text-[22px] font-bold text-background';

/** `.progress` — 6 px, tło linii, promień 4 px, margines 18 px 0; wypełnienie kolorem marki. */
export const PROGRESS = 'my-[18px] h-1.5 overflow-hidden rounded-[4px] bg-border';
export const PROGRESS_FILL = 'block h-full rounded-[4px] bg-primary';

/** `.action-row` — wiersz akcji: odstęp 13 px, margines 23 px; ≤ 600 px: kolumna. */
export const ACTION_ROW =
  'mt-[23px] flex min-w-0 flex-wrap items-center gap-[13px] max-[600px]:flex-col max-[600px]:items-stretch';

/* ------------------------------------------------------------------------------------------
 * Nakładki `.demo-form` na wspólne komponenty `src/components/ui` (kreator oferty, #5).
 * W prototypie etykieta OWIJA pole (`<label>Nazwa<input></label>`); w aplikacji etykieta
 * i pole są rodzeństwem (`htmlFor`), więc kolumnę `.demo-form label` daje kontener pola,
 * a typografię — osobna klasa etykiety. Klasy przekazywane jako `className` do `Input`/
 * `SelectTrigger`/`Button` (scalane `cn`/tailwind-merge) neutralizują ich domyślne `h-*`,
 * cień i `whitespace-nowrap`, żeby wymiary były te z prototypu.
 * ---------------------------------------------------------------------------------------- */

/** Kontener pola (`.demo-form label`: kolumna, odstęp 9 px) dla etykiety + pola + błędu. */
export const FORM_FIELD = 'flex min-w-0 flex-col gap-[9px]';

/** Typografia `.demo-form label` dla elementu `<Label>` — 13 px / 600. */
export const FORM_LABEL_TEXT = 'text-[13px] font-semibold leading-[1.4] text-foreground';

/** Podpowiedź pod polem — `.demo-note` bez linii: 12 px, interlinia 1.6. */
export const FORM_HINT = 'text-xs font-normal leading-[1.6] text-muted-foreground';

/** Błąd przy polu — 13 px, kolor błędu. */
export const FORM_ERROR = 'text-[13px] font-normal leading-[1.5] text-error';

/** `FORM_CONTROL` dla `ui/Input` i `ui/Textarea` (zdejmuje `h-11` i cień). */
export const FORM_INPUT = `${FORM_CONTROL} h-auto shadow-none`;

/** `FORM_CONTROL` dla `ui/SelectTrigger` (przycisk-combobox: flex, strzałka po prawej). */
export const FORM_SELECT = `${FORM_CONTROL} flex h-auto items-center justify-between gap-2 text-left shadow-none`;

/** Reset rozmiaru `ui/Button` przy klasach `BTN_*` (wysokość z `min-h`, zawijanie tekstu). */
export const BTN_RESET = 'h-auto whitespace-normal';

/**
 * `.p-job` — karta paszportowa w panelu (lista ofert, zgłoszeń, kandydatów): linia, promień
 * 20 px, padding 23/23/19 px, hover ciemniejsza linia; ≤ 600 px: promień 18 px, padding 21 px.
 */
export const JOB_CARD =
  'flex h-full min-w-0 flex-col rounded-[20px] border border-border bg-card px-[23px] pb-[19px] pt-[23px] transition-colors hover:border-input max-[600px]:rounded-[18px] max-[600px]:p-[21px]';

/** `.people .p-job h3` — 19 px / 700, −0.018em, interlinia 1.35. */
export const JOB_CARD_TITLE =
  'min-w-0 break-words text-[19px] font-bold leading-[1.35] tracking-[-0.018em] text-foreground';

/** `.p-card-bottom` — linia górna, padding 14 px, akcje na dole karty. */
export const JOB_CARD_BOTTOM =
  'mt-auto flex min-w-0 flex-wrap items-center gap-[9px] border-t border-border pt-[14px]';
