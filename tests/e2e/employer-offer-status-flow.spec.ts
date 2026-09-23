import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

type Messages = {
  dashboard: Record<string, string>;
  status: Record<string, string>;
  common: Record<string, string>;
};

const messages = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src', 'messages', 'pl.json'), 'utf8'),
) as Messages;
const d = messages.dashboard;

test('menu statusu: nazwa z kandydatem i tylko dozwolone przejścia (#306, #333)', async ({ page }) => {
  await page.goto('/pl/employer/aplikacje');
  const main = page.getByRole('main');

  // Demo: Piotr Nowak — Elektryk przemysłowy, status „submitted".
  const name = d.statusMenuTrigger
    .replace('{name}', 'Piotr Nowak')
    .replace('{job}', 'Elektryk przemysłowy')
    .replace('{status}', messages.status.submitted);
  const trigger = main.getByRole('button', { name, exact: true });
  await expect(trigger).toHaveAttribute('aria-haspopup', 'true');
  await trigger.click();

  const options = main.getByRole('list', { name: /Piotr Nowak/ });
  await expect(options.getByRole('button', { name: messages.status.interview })).toBeVisible();
  await expect(options.getByRole('button', { name: messages.status.hired })).toHaveCount(0);

  // Odrzucenie wymaga potwierdzenia — anulujemy, nic nie zostaje wysłane.
  await options.getByRole('button', { name: messages.status.rejected }).click();
  await expect(main.getByRole('button', { name: d.statusConfirmAction })).toBeVisible();
  await main.getByRole('button', { name: messages.common.cancel }).click();
  await expect(main.getByRole('button', { name: d.statusConfirmAction })).toHaveCount(0);
});

test('„Wyślij propozycję": oferta widoczna i dialog potwierdzenia przed wysyłką (#327)', async ({ page }) => {
  await page.goto('/pl/employer/kandydaci');
  const main = page.getByRole('main');

  await expect(main.getByText('Elektryk przemysłowy').first()).toBeVisible();
  const name = d.sendOfferTo.replace('{name}', 'Piotr Nowak').replace('{job}', 'Elektryk przemysłowy');
  await main.getByRole('button', { name, exact: true }).click();

  const dialog = page.getByRole('dialog', { name: d.offerDialogTitle });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Piotr Nowak');
  await expect(dialog).toContainText('Elektryk przemysłowy');
  await expect(dialog).toContainText(d.offerDefaultMessage!);
  await dialog.getByRole('button', { name: messages.common.cancel }).last().click();
  await expect(dialog).toHaveCount(0);
});
