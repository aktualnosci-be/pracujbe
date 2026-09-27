import { render } from '@react-email/render';
import { createElement } from 'react';

/**
 * Jednorazowe załadowanie ścieżki renderu React Email przed pierwszym testem pliku.
 *
 * `@react-email/render` ładuje `react-dom/server` leniwie (`await import(...)`) przy pierwszym
 * `render()`, a wariant `plainText` dociąga konwersję HTML → tekst. W testach workera poczty
 * ten koszt płacił PIERWSZY test pliku (`processEmailQueue` renderuje mail) i przy pełnym
 * `npm run verify` na obciążonej maszynie przekraczał limit 5 s, choć sam test trwa
 * kilkadziesiąt ms. Wywołane w `beforeAll` (limit hooka 10 s) — każdy test mierzy już tylko
 * własną pracę; kolejne rendery korzystają z załadowanych modułów tak samo jak wcześniej.
 */
export async function warmUpEmailRender(): Promise<void> {
  const element = createElement('p', null, 'warm-up');
  await render(element);
  await render(element, { plainText: true });
}
