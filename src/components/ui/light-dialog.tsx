'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { FocusScope } from '@radix-ui/react-focus-scope';
import { useComposedRefs } from '@radix-ui/react-compose-refs';
import { hideOthers } from 'aria-hidden';

/**
 * Dialog modalny bez kosztownych efektów trybu `modal` Radix (#393).
 *
 * Radix `modal` przy otwarciu wstrzykuje do <head> arkusz blokady przewijania
 * (react-remove-scroll) i ustawia `pointer-events: none` na <body> (właściwość dziedziczona).
 * Każda z tych zmian wymusza przeliczenie stylów CAŁEGO dokumentu — przy CPU 4× to ~50 ms
 * na każdą, w ramce odpowiedzi na tap (INP). Tutaj Root działa jako non-modal, a zachowanie
 * modalne odtwarzamy tańszymi środkami:
 * - pułapka fokusu: `FocusScope` (trapped, loop) — ta sama, której używa Radix;
 * - reszta strony ukryta dla technologii asystujących: `hideOthers` + `aria-modal`;
 * - blokada przewijania: `overflow: hidden` na <html> (styl nie jest dziedziczony, więc
 *   przelicza się tylko korzeń); przy klasycznym pasku `scrollbar-gutter: stable` chroni układ
 *   przed przesunięciem;
 * - nakładka zamyka dialog kliknięciem, a Esc obsługuje Radix. Interakcje poza treścią nie
 *   zamykają dialogu same, więc fokus zawsze wraca na wyzwalacz (jak w trybie modal).
 */

export function LightDialogRoot(
  props: Omit<React.ComponentPropsWithoutRef<typeof Dialog.Root>, 'modal'>,
): React.JSX.Element {
  return <Dialog.Root {...props} modal={false} />;
}

let scrollLocks = 0;
let savedRootStyle: { overflow: string; scrollbarGutter: string } | null = null;

function lockScroll(): () => void {
  const root = document.documentElement;
  if (scrollLocks === 0) {
    savedRootStyle = { overflow: root.style.overflow, scrollbarGutter: root.style.scrollbarGutter };
    // Rezerwujemy miejsce tylko po widocznym klasycznym pasku; przy nakładkowych paskach
    // (telefony, macOS) lub krótkiej stronie `stable` samo dodałoby odstęp.
    const hasScrollbar = window.innerWidth - root.clientWidth > 0;
    root.style.overflow = 'hidden';
    if (hasScrollbar) root.style.scrollbarGutter = 'stable';
  }
  scrollLocks += 1;
  return () => {
    scrollLocks -= 1;
    if (scrollLocks === 0 && savedRootStyle) {
      root.style.overflow = savedRootStyle.overflow;
      root.style.scrollbarGutter = savedRootStyle.scrollbarGutter;
      savedRootStyle = null;
    }
  };
}

export interface LightDialogContentProps
  extends React.ComponentPropsWithoutRef<typeof Dialog.Content> {
  /** Stan dialogu — steruje `data-state` nakładki (animacja wejścia i wyjścia). */
  open: boolean;
  overlayClassName?: string;
}

/**
 * Efekty trybu modalnego. Renderowany WEWNĄTRZ `Dialog.Content`, więc montuje się dopiero
 * z treścią dialogu (Presence Radix) i zdejmuje blokadę po jej odmontowaniu.
 */
function ModalEffects({ contentRef }: { contentRef: React.RefObject<HTMLDivElement | null> }) {
  React.useEffect(() => {
    const release = lockScroll();
    const content = contentRef.current;
    const reveal = content ? hideOthers(content) : undefined;
    return () => {
      reveal?.();
      release();
    };
  }, [contentRef]);
  return null;
}

export const LightDialogContent = React.forwardRef<HTMLDivElement, LightDialogContentProps>(
  function LightDialogContent(
    { open, overlayClassName, onInteractOutside, children, ...props },
    forwardedRef,
  ) {
    const contentRef = React.useRef<HTMLDivElement>(null);
    const ref = useComposedRefs(forwardedRef, contentRef);

    return (
      <Dialog.Portal>
        <Dialog.Close asChild>
          <div aria-hidden="true" data-state={open ? 'open' : 'closed'} className={overlayClassName} />
        </Dialog.Close>
        <FocusScope
          asChild
          trapped
          loop
          onMountAutoFocus={(event) => event.preventDefault()}
          onUnmountAutoFocus={(event) => event.preventDefault()}
        >
          <Dialog.Content
            {...props}
            ref={ref}
            aria-modal="true"
            onInteractOutside={(event) => {
              onInteractOutside?.(event);
              event.preventDefault();
            }}
          >
            <ModalEffects contentRef={contentRef} />
            {children}
          </Dialog.Content>
        </FocusScope>
      </Dialog.Portal>
    );
  },
);
