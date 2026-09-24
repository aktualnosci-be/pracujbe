// Proces testów Playwright importuje moduły serwerowe aplikacji (Better Auth, pula runtime,
// transakcja użytkownika). Pakiet `server-only` rzuca poza warunkiem `react-server`, więc —
// jak alias w vitest.config.ts — mapujemy go na pusty stub. Dotyczy tylko procesu testów,
// nie serwera Next (webServer dostaje własne NODE_OPTIONS).
const Module = require('node:module');
const path = require('node:path');

const stub = path.resolve(__dirname, '../../stubs/server-only.ts');
const resolve = Module._resolveFilename;
Module._resolveFilename = function resolveServerOnly(request, ...rest) {
  if (request === 'server-only') return stub;
  return resolve.call(this, request, ...rest);
};
