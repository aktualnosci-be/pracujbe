# Obraz zadania kopii bazy (#569): pg_dump/pg_restore/psql 18 (= serwer Railway), age, node + SDK S3.
# Usługa cron Railway: Dockerfile path = docker/backup/Dockerfile (RAILWAY_DOCKERFILE_PATH),
# kontekst = katalog główny repozytorium, bez publicznej domeny. Nie wpływa na build usługi web
# (Railpack). Opis zmiennych: docs/railway/OPERATIONS.md („Kopia w Cloudflare R2”).
#
# #751: obraz bazowy przypięty do digestu (powtarzalny build, audytowalne pochodzenie).
# Aktualizacja = PR zmieniający digest (Dependabot, .github/dependabot.yml) — job
# „Backup image (build + scan)” (.github/workflows/backup-image.yml) buduje obraz, uruchamia smoke (scripts/db/backup-image-smoke.sh),
# generuje SBOM i skanuje pakiety (scripts/security/backup-image-scan.mjs). Sam tag bez
# digestu odrzuca tests/unit/backup-r2-image.test.ts. Runbook: docs/railway/BACKUP_RESTORE.md.
FROM node:22-bookworm-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c

ARG PG_MAJOR=18
# Ta sama wersja co w package.json (pilnuje tests/unit/backup-r2-image.test.ts).
ARG AWS_SDK_S3_VERSION=3.1137.0

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg age; \
    install -d /usr/share/postgresql-common/pgdg; \
    curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends "postgresql-client-${PG_MAJOR}"; \
    apt-get purge -y gnupg; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN npm init -y >/dev/null \
 && npm install --omit=dev --ignore-scripts --no-audit --no-fund "@aws-sdk/client-s3@${AWS_SDK_S3_VERSION}" \
 && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
      /root/.npm
# ↑ #751: menedżery pakietów z obrazu bazowego nie są potrzebne w czasie działania (backup.sh
# używa tylko node, pg_*, age) — usunięte, żeby nie wnosiły zależności do SBOM i skanu.

COPY scripts/db/backup.sh scripts/db/restore-backup.sh scripts/db/
COPY scripts/db/lib/ scripts/db/lib/

# Artefakty lokalne są chwilowe (kontener cron) — kopia trwała jest w R2.
ENV BACKUP_DIR=/tmp/pracujbe-backups \
    BACKUP_RETENTION=14 \
    NODE_ENV=production
USER node
CMD ["bash", "scripts/db/backup.sh"]
