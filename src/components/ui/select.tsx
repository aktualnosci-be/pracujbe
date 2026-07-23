'use client';

import * as React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useComposedRefs } from '@radix-ui/react-compose-refs';
import { useControllableState } from '@radix-ui/react-use-controllable-state';

import { cn } from '@/lib/utils';

/**
 * Select (shadcn-style API) — dostępny, samowystarczalny komponent listy wyboru.
 *
 * Uwaga implementacyjna: pakiet `@radix-ui/react-select` nie jest zainstalowany
 * (a package.json jest zamrożony), więc komponent jest zbudowany od zera na
 * dostępnych prymitywach Radix (compose-refs, use-controllable-state) tak, aby
 * zachować dokładnie ten sam kontrakt eksportów, co shadcn/Radix Select:
 *   <Select value onValueChange>
 *     <SelectTrigger><SelectValue placeholder /></SelectTrigger>
 *     <SelectContent><SelectItem value>…</SelectItem></SelectContent>
 *   </Select>
 *
 * Cechy dostępności: role combobox/listbox/option, aria-expanded/-controls/-selected,
 * aria-activedescendant, nawigacja klawiaturą (strzałki, Home/End, Enter/Spacja,
 * Escape), zamykanie po kliknięciu poza obszarem, zwracanie focusu na trigger.
 * Lista pozostaje zamontowana (ukrywana atrybutem `hidden`), dzięki czemu etykiety
 * pozycji są znane od pierwszego renderu (SelectValue pokazuje właściwy tekst).
 */

type SelectContextValue = {
  value: string | undefined;
  onSelect: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  disabled: boolean;
  labels: Record<string, React.ReactNode>;
  registerLabel: (value: string, label: React.ReactNode) => void;
  triggerId: string;
  contentId: string;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
};

const SelectContext = React.createContext<SelectContextValue | null>(null);

function useSelectContext(component: string): SelectContextValue {
  const ctx = React.useContext(SelectContext);
  if (ctx === null) {
    throw new Error(`${component} must be used within <Select>`);
  }
  return ctx;
}

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  name?: string;
  children: React.ReactNode;
}

function Select({
  value: valueProp,
  defaultValue,
  onValueChange,
  disabled = false,
  name,
  children,
}: SelectProps) {
  const [value, setValue] = useControllableState<string | undefined>({
    prop: valueProp,
    defaultProp: defaultValue,
    onChange: onValueChange ? (next) => (next === undefined ? undefined : onValueChange(next)) : undefined,
  });
  const [open, setOpenState] = React.useState(false);
  const [labels, setLabels] = React.useState<Record<string, React.ReactNode>>({});

  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const reactId = React.useId();
  const triggerId = `${reactId}trigger`;
  const contentId = `${reactId}content`;

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (disabled) return;
      setOpenState(next);
    },
    [disabled],
  );

  const onSelect = React.useCallback(
    (next: string) => {
      setValue(next);
      setOpenState(false);
      triggerRef.current?.focus();
    },
    [setValue],
  );

  const registerLabel = React.useCallback((val: string, label: React.ReactNode) => {
    setLabels((prev) => {
      if (Object.prototype.hasOwnProperty.call(prev, val) && prev[val] === label) {
        return prev;
      }
      return { ...prev, [val]: label };
    });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        setOpenState(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const contextValue = React.useMemo<SelectContextValue>(
    () => ({
      value,
      onSelect,
      open,
      setOpen,
      disabled,
      labels,
      registerLabel,
      triggerId,
      contentId,
      triggerRef,
    }),
    [value, onSelect, open, setOpen, disabled, labels, registerLabel, triggerId, contentId],
  );

  return (
    <SelectContext.Provider value={contextValue}>
      <div ref={containerRef} className="relative">
        {children}
        {name !== undefined ? (
          <input type="hidden" name={name} value={value ?? ''} />
        ) : null}
      </div>
    </SelectContext.Provider>
  );
}
Select.displayName = 'Select';

const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, children, onClick, onKeyDown, ...props }, forwardedRef) => {
  const { open, setOpen, disabled, triggerId, contentId, triggerRef } =
    useSelectContext('SelectTrigger');
  const composedRef = useComposedRefs(forwardedRef, triggerRef);

  return (
    <button
      ref={composedRef}
      type="button"
      id={triggerId}
      role="combobox"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={contentId}
      disabled={disabled}
      data-state={open ? 'open' : 'closed'}
      className={cn(
        'flex h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors',
        'placeholder:text-muted-foreground [&>span]:line-clamp-1',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        setOpen(!open);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (
          event.key === 'ArrowDown' ||
          event.key === 'ArrowUp' ||
          event.key === 'Enter' ||
          event.key === ' '
        ) {
          event.preventDefault();
          setOpen(true);
        }
      }}
      {...props}
    >
      {children}
      <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
    </button>
  );
});
SelectTrigger.displayName = 'SelectTrigger';

export interface SelectValueProps {
  placeholder?: string;
  className?: string;
}

function SelectValue({ placeholder, className }: SelectValueProps) {
  const { value, labels } = useSelectContext('SelectValue');
  const hasValue =
    value !== undefined &&
    value !== '' &&
    Object.prototype.hasOwnProperty.call(labels, value);

  return (
    <span className={cn('block truncate', hasValue ? undefined : 'text-muted-foreground', className)}>
      {hasValue ? labels[value] : placeholder}
    </span>
  );
}
SelectValue.displayName = 'SelectValue';

const SelectContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, onKeyDown, ...props }, forwardedRef) => {
  const { open, setOpen, value, onSelect, triggerId, contentId, triggerRef } =
    useSelectContext('SelectContent');
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const composedRef = useComposedRefs(forwardedRef, contentRef);
  const [activeIndex, setActiveIndex] = React.useState(-1);

  const getOptions = React.useCallback((): HTMLElement[] => {
    const node = contentRef.current;
    if (!node) return [];
    return Array.from(
      node.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled="true"])'),
    );
  }, []);

  React.useEffect(() => {
    if (!open) {
      setActiveIndex(-1);
      return;
    }
    const options = getOptions();
    const selectedIdx = options.findIndex((option) => option.dataset.value === value);
    setActiveIndex(selectedIdx >= 0 ? selectedIdx : options.length > 0 ? 0 : -1);
    contentRef.current?.focus();
  }, [open, value, getOptions]);

  React.useEffect(() => {
    const node = contentRef.current;
    if (!node) return;
    const options = getOptions();
    options.forEach((option, index) => {
      if (index === activeIndex) {
        option.setAttribute('data-highlighted', '');
        option.scrollIntoView({ block: 'nearest' });
      } else {
        option.removeAttribute('data-highlighted');
      }
    });
    const active = activeIndex >= 0 ? options[activeIndex] : undefined;
    if (active && active.id !== '') {
      node.setAttribute('aria-activedescendant', active.id);
    } else {
      node.removeAttribute('aria-activedescendant');
    }
  }, [activeIndex, open, children, getOptions]);

  return (
    <div
      ref={composedRef}
      id={contentId}
      role="listbox"
      aria-labelledby={triggerId}
      tabIndex={-1}
      hidden={!open}
      data-state={open ? 'open' : 'closed'}
      className={cn(
        'absolute left-0 top-[calc(100%+0.25rem)] z-50 max-h-72 w-full min-w-[8rem] overflow-auto rounded-md border border-border bg-background p-1 text-foreground shadow-md focus:outline-none',
        className,
      )}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        const options = getOptions();
        switch (event.key) {
          case 'ArrowDown':
            event.preventDefault();
            if (options.length > 0) {
              setActiveIndex((index) => Math.min(options.length - 1, index + 1));
            }
            break;
          case 'ArrowUp':
            event.preventDefault();
            if (options.length > 0) {
              setActiveIndex((index) => Math.max(0, index - 1));
            }
            break;
          case 'Home':
            event.preventDefault();
            if (options.length > 0) setActiveIndex(0);
            break;
          case 'End':
            event.preventDefault();
            if (options.length > 0) setActiveIndex(options.length - 1);
            break;
          case 'Enter':
          case ' ': {
            event.preventDefault();
            const option = activeIndex >= 0 ? options[activeIndex] : undefined;
            const optionValue = option?.dataset.value;
            if (optionValue !== undefined) onSelect(optionValue);
            break;
          }
          case 'Escape':
            event.preventDefault();
            setOpen(false);
            triggerRef.current?.focus();
            break;
          case 'Tab':
            setOpen(false);
            break;
          default:
            break;
        }
      }}
      {...props}
    >
      {children}
    </div>
  );
});
SelectContent.displayName = 'SelectContent';

export interface SelectItemProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  value: string;
  disabled?: boolean;
}

const SelectItem = React.forwardRef<HTMLDivElement, SelectItemProps>(
  ({ className, children, value, disabled = false, onClick, ...props }, ref) => {
    const { value: selectedValue, onSelect, registerLabel } = useSelectContext('SelectItem');
    const itemId = React.useId();
    const labelRef = React.useRef<React.ReactNode>(children);
    labelRef.current = children;

    React.useEffect(() => {
      registerLabel(value, labelRef.current);
    }, [value, registerLabel]);

    const isSelected = selectedValue === value;

    return (
      <div
        ref={ref}
        id={itemId}
        role="option"
        aria-selected={isSelected}
        aria-disabled={disabled || undefined}
        data-disabled={disabled ? '' : undefined}
        data-value={value}
        data-state={isSelected ? 'checked' : 'unchecked'}
        className={cn(
          'relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm py-2 pl-8 pr-3 text-sm outline-none',
          'data-[highlighted]:bg-soft data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
          className,
        )}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented || disabled) return;
          onSelect(value);
        }}
        {...props}
      >
        {isSelected ? (
          <span
            className="absolute left-2 flex h-4 w-4 items-center justify-center"
            aria-hidden="true"
          >
            <Check className="h-4 w-4 text-primary" />
          </span>
        ) : null}
        <span className="block truncate">{children}</span>
      </div>
    );
  },
);
SelectItem.displayName = 'SelectItem';

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
