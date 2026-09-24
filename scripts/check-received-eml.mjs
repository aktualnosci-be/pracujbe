#!/usr/bin/env node
// Kontrola odebranej wiadomości (#45): `node scripts/check-received-eml.mjs <plik.eml> [--marketing]`.
//
// Plik `.eml` = oryginał wiadomości pobrany ze skrzynki odbiorcy (np. „Pokaż oryginał” →
// „Pobierz”). Dozwolone hosty linków: host `NEXT_PUBLIC_SITE_URL` + `EML_ALLOWED_HOSTS`
// (przecinki). Tożsamość i adres nadawcy: `EMAIL_SENDER_IDENTITY`, `EMAIL_SENDER_POSTAL_ADDRESS`
// (te same wartości co w środowisku produkcji). Kod wyjścia 0 = zgodna, 1 = braki (lista na stderr).
import { readFileSync } from 'node:fs';

import { checkReceivedEml } from './lib/received-eml.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: node scripts/check-received-eml.mjs <message.eml> [--marketing]');
  process.exit(2);
}

const hosts = [];
try {
  if (process.env.NEXT_PUBLIC_SITE_URL) hosts.push(new URL(process.env.NEXT_PUBLIC_SITE_URL).host);
} catch {
  console.error('NEXT_PUBLIC_SITE_URL is not a valid URL');
  process.exit(2);
}
for (const h of (process.env.EML_ALLOWED_HOSTS ?? '').split(',')) if (h.trim()) hosts.push(h.trim());
if (hosts.length === 0) {
  console.error('set NEXT_PUBLIC_SITE_URL (and optionally EML_ALLOWED_HOSTS)');
  process.exit(2);
}

const result = checkReceivedEml(readFileSync(file, 'utf8'), {
  allowedHosts: hosts,
  identity: process.env.EMAIL_SENDER_IDENTITY ?? '',
  postalAddress: process.env.EMAIL_SENDER_POSTAL_ADDRESS ?? '',
  marketing: args.includes('--marketing'),
});

if (result.ok) {
  console.log('received message OK: HTML + text/plain, sender identity and address, no tracking');
  process.exit(0);
}
for (const f of result.failures) console.error(`- ${f}`);
process.exit(1);
