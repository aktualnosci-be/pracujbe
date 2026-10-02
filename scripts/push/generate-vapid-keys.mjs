#!/usr/bin/env node
/**
 * Generuje parę kluczy VAPID (P-256) dla Web Push (#724) — bez pakietów npm (`node:crypto`).
 * Wynik wpisz w zmiennych środowiska usługi (Railway): `WEB_PUSH_VAPID_PUBLIC_KEY`,
 * `WEB_PUSH_VAPID_PRIVATE_KEY`. Klucz prywatny jest sekretem — nie commituj go i nie loguj.
 * Zmiana klucza unieważnia subskrypcje urządzeń (kandydaci muszą włączyć push ponownie).
 *
 * Użycie: node scripts/push/generate-vapid-keys.mjs
 */
import { createECDH } from 'node:crypto';

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const publicKey = ecdh.getPublicKey();
const privateKey = Buffer.alloc(32);
const raw = ecdh.getPrivateKey();
raw.copy(privateKey, 32 - raw.length);

process.stdout.write(`WEB_PUSH_VAPID_PUBLIC_KEY=${publicKey.toString('base64url')}\n`);
process.stdout.write(`WEB_PUSH_VAPID_PRIVATE_KEY=${privateKey.toString('base64url')}\n`);
