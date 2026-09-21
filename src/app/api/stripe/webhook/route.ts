/**
 * Integracja sprzedażowa jest celowo wyłączona w bezpłatnym MVP. Endpoint odpowiada 410
 * niezależnie od konfiguracji środowiska, aby pozostawiony webhook Stripe nie zmieniał danych.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  return Response.json({ error: 'billing disabled' }, { status: 410 });
}
