/**
 * Railway IaC (#19) — usługi z tego repozytorium w projekcie `captivating-vision`.
 *
 * Odtworzone z odczytu konfiguracji produkcji (API Railway, 2026-09-25). Railway
 * NIE czyta tego pliku przy wdrożeniu — zmienia coś dopiero `railway config apply`,
 * wykonane przez właściciela po `railway config plan` = 0 zmian
 * (docs/railway/IAC.md). Świadomie nie `railway.json`/`railway.toml`: Config as Code
 * jest wycofywany (koniec 2026-12-01) i byłby czytany przy każdym deployu.
 *
 * Zasady (strażnik `tests/unit/railway-iac.test.ts`):
 * - `partial` — plik zarządza tylko usługami z tego repo; baza `PostgreSQL 18`
 *   i bucket pozostają poza nim (pełny plik projektu usunąłby je przy apply);
 * - zmienne wyłącznie jako `preserve()` — wartości i sekrety zostają w Railway;
 * - komendy muszą istnieć w `package.json`, healthcheck musi mieć trasę.
 */
import { defineRailway, github, preserve, project, service } from 'railway/iac';

export const partial = 'pracujbe-repo';

const REPO = 'aktualnosci-be/pracujbe';
const REGION = 'europe-west4-drams3a';

export default defineRailway(() => {
  // Web: Railpack (Node 22 z `engines`), start = domyślne `npm start` Railpacka
  // (w Railway pole start jest puste — nie ustawiamy go, żeby plan był pusty).
  // `Wait for CI` jest włączone w źródle usługi (poza DSL — patrz IAC.md).
  const web = service('pracujbe', {
    source: github(REPO, { branch: 'main' }),
    build: 'npm run build',
    healthcheck: '/api/health',
    replicas: { [REGION]: 1 },
    domains: ['pracuj.be'],
    env: {
      AWS_ACCESS_KEY_ID: preserve(),
      AWS_DEFAULT_REGION: preserve(),
      AWS_ENDPOINT_URL: preserve(),
      AWS_S3_BUCKET_NAME: preserve(),
      AWS_S3_URL_STYLE: preserve(),
      AWS_SECRET_ACCESS_KEY: preserve(),
      BETTER_AUTH_SECRET: preserve(),
      BETTER_AUTH_URL: preserve(),
      DATABASE_APP_URL: preserve(),
      DATABASE_AUTH_URL: preserve(),
      FILE_DOWNLOAD_SECRET: preserve(),
      NEXT_PUBLIC_SITE_URL: preserve(),
      SITE_ACCESS_PASSWORD: preserve(),
    },
  });

  // Migrator: bez builda Next.js, jednorazowy proces (restart NEVER), domyślnie
  // MIGRATION_MODE=status (tylko odczyt). Login migratora tylko tutaj, nigdy w web.
  const migrator = service('db-migrator', {
    source: github(REPO, { branch: 'main' }),
    build: 'echo "db-migrator: bez builda Next.js"',
    start: 'npm run db:migrate:production',
    replicas: { [REGION]: 1 },
    deploy: { restartPolicyType: 'NEVER' },
    env: {
      AUTH_DATABASE_PASSWORD: preserve(),
      AUTH_MAIL_DATABASE_PASSWORD: preserve(),
      CHECK_APP_URL: preserve(),
      DATABASE_APP_PASSWORD: preserve(),
      DB_LOGIN_STEP: preserve(),
      EXPECTED_DATABASE_NAME: preserve(),
      EXPECTED_MIGRATION_USER: preserve(),
      EXPECTED_POSTGRES_MAJOR: preserve(),
      MIGRATION_DATABASE_URL: preserve(),
      MIGRATION_MODE: preserve(),
      RATE_LIMIT_DATABASE_PASSWORD: preserve(),
    },
  });

  return project('captivating-vision', { resources: [web, migrator] });
});
