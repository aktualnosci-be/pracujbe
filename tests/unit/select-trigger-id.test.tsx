import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Regresja #819: `SelectTrigger` pozwala nadpisać wygenerowany `id` (np.
 * `onb-availability-trigger` w kroku 6 onboardingu). `SelectContent` musi
 * wtedy odwołać się w `aria-labelledby` do TEGO SAMEGO, wyrenderowanego
 * identyfikatora — nie do porzuconego, wygenerowanego `triggerId` z
 * kontekstu, bo wtedy IDREF nie rozwiązuje się do żadnego elementu (WCAG 4.1.2).
 */
describe('Select — powiązanie etykiety otwartej listy z triggerem (#819)', () => {
  it('z własnym id na SelectTrigger: aria-labelledby listy wskazuje na realnie wyrenderowany element', () => {
    render(
      <Select defaultValue="a">
        <SelectTrigger id="onb-availability-trigger">
          <SelectValue placeholder="Wybierz" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Opcja A</SelectItem>
          <SelectItem value="b">Opcja B</SelectItem>
        </SelectContent>
      </Select>,
    );

    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAttribute('id', 'onb-availability-trigger');

    const listbox = screen.getByRole('listbox', { hidden: true });
    const labelledBy = listbox.getAttribute('aria-labelledby');
    expect(labelledBy).toBe('onb-availability-trigger');
    expect(labelledBy).not.toBeNull();
    // Odwołanie musi być rozwiązywalne — to jest sedno naprawy (#819).
    expect(document.getElementById(labelledBy as string)).toBe(trigger);
  });

  it('bez własnego id: aria-labelledby dalej wskazuje na wygenerowany, wyrenderowany trigger (kontrola ujemna)', () => {
    render(
      <Select defaultValue="a">
        <SelectTrigger>
          <SelectValue placeholder="Wybierz" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Opcja A</SelectItem>
        </SelectContent>
      </Select>,
    );

    const trigger = screen.getByRole('combobox');
    const listbox = screen.getByRole('listbox', { hidden: true });
    const labelledBy = listbox.getAttribute('aria-labelledby');

    expect(labelledBy).toBe(trigger.getAttribute('id'));
    expect(document.getElementById(labelledBy as string)).toBe(trigger);
  });
});
