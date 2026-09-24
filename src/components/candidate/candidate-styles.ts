/**
 * Klasy panelu kandydata, wiadomości i aplikowania — kalka ekranów kandydata z prototypu
 * „04 Ludzie i praca” (`docs/design/people-passport/prototype/extended.css`, widoki
 * `#people/candidate`, `profile`, `applications`, `proposals`, `messages`, `saved`, `apply`).
 *
 * Uzupełnia wspólne klasy paneli (`src/components/dashboard/panel-styles.ts`) o prymitywy,
 * których nie ma panel pracodawcy/admina: etapy zgłoszenia (`.application-steps`), rozmowę
 * (`.conversation`, `.chat-log`, `.bubble`), baner profilu (`.profile-banner`), checklistę
 * (`.checklist`) i siatkę pulpitu (`.people .dash-grid`). Wartości przepisane 1:1; kolory
 * wyłącznie tokenami (`#f4f4f4`/`#f7f7f7` → `soft`/`muted`, `#fff0ef` → `primary/10`,
 * szarości tekstu → `muted-foreground`, bo `#777` ma < 4,5:1). Progi prototypu
 * `@container (max-width: 950/600px)` → `max-[950px]:` / `max-[600px]:`.
 */

/**
 * `.people .dash-grid` — 1.4fr / 1fr, odstęp 19 px; ≤ 1050 px jedna kolumna. Bazy w rem
 * (jak pulpit pracodawcy #496): przy 200% tekstu kolumna boczna przechodzi pod główną.
 */
export const DASH_GRID = 'flex min-w-0 flex-wrap gap-[19px]';
export const DASH_GRID_MAIN = 'flex min-w-0 flex-[1.4_1_36rem] flex-col gap-[19px]';
export const DASH_GRID_SIDE = 'flex min-w-0 flex-[1_1_20rem] flex-col gap-[19px]';

/** `.checklist` — bez punktorów, 13 px, interlinia 2.5, margines 20 px 0. */
export const CHECKLIST = 'my-5 list-none p-0 text-[13px] leading-[2.5]';

/** `.profile-banner` — flex, odstęp 20 px, tło szarości, promień 22 px, padding 27 px, margines 25 px; ≤ 600 px: 20/14 px. */
export const PROFILE_BANNER =
  'mt-[25px] flex min-w-0 flex-wrap items-center gap-5 rounded-[22px] bg-soft p-[27px] max-[600px]:gap-3.5 max-[600px]:p-5';

/** `.application-steps` — 4 kolumny, odstęp 12 px, margines 30 px 0; ≤ 600 px: 2 kolumny. */
export const APP_STEPS =
  'my-[30px] grid min-w-0 list-none grid-cols-4 gap-3 p-0 max-[600px]:grid-cols-2';
/** `.application-steps li` — 12 px, linia górna 3 px, padding 15 px. */
export const APP_STEP = 'min-w-0 break-words border-t-[3px] border-[color:var(--pp-line)] pt-[15px] text-xs text-muted-foreground';
/** `.application-steps .done` — linia w kolorze marki, tekst ink. */
export const APP_STEP_DONE = 'min-w-0 break-words border-t-[3px] border-primary pt-[15px] text-xs text-foreground';

/** `.conversation header` — flex, odstęp 15 px, linia dolna, padding 16 px. */
export const CONVERSATION_HEAD = 'flex min-w-0 items-center gap-[15px] border-b border-[color:var(--pp-line-soft)] pb-4';
/** `.chat-log` — kolumna, odstęp 16 px, padding 24 px 0. */
export const CHAT_LOG = 'flex min-w-0 flex-col items-start gap-4 py-6';
/** `.bubble` — tło szarości, promień 4/18/18 px, padding 17/20 px, 85% (≤ 600 px: 95%). */
export const BUBBLE =
  'max-w-[85%] rounded-[4px_18px_18px] bg-soft px-5 py-[17px] text-[15px] leading-[1.7] text-foreground max-[600px]:max-w-[95%]';
/** `.bubble.mine` — do prawej, jasne tło marki, promień 18/4/18/18 px. */
export const BUBBLE_MINE =
  'max-w-[85%] self-end rounded-[18px_4px_18px_18px] bg-primary/10 px-5 py-[17px] text-[15px] leading-[1.7] text-foreground max-[600px]:max-w-[95%]';
