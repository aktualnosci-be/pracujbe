/**
 * Tworzy identyfikator konkretnego artefaktu.
 *
 * Przed premierą format pozostaje zgodny z SemVer, ale nigdy sam nie przechodzi na 1.0:
 * 0.YYYYMMDD.M+SHA, gdzie M to milisekundy od północy UTC.
 *
 * @param {Date} builtAt
 * @param {...(string | undefined)} revisions kandydaci w kolejności preferencji
 */
export function createBuildMetadata(builtAt = new Date(), ...revisions) {
  assertValidDate(builtAt);

  const iso = builtAt.toISOString();
  const day = iso.slice(0, 10).replaceAll('-', '');
  const milliseconds =
    ((builtAt.getUTCHours() * 60 + builtAt.getUTCMinutes()) * 60 + builtAt.getUTCSeconds()) *
      1000 +
    builtAt.getUTCMilliseconds();
  const shortRevision = pickShortRevision(revisions);

  return {
    buildTime: iso,
    version: `0.${day}.${milliseconds}${shortRevision ? `+${shortRevision}` : ''}`,
  };
}

/** Nazwa zmiennej builda, która jako jedyna może włączyć wersję wydania (#103). */
export const RELEASE_VERSION_ENV = 'PRACUJBE_RELEASE_VERSION';

/**
 * Wersje wydania dopuszczone decyzją właściciela. Dopisanie kolejnej wymaga osobnej
 * zmiany w repozytorium; `package.json` nie jest źródłem wersji.
 */
export const APPROVED_RELEASE_VERSIONS = Object.freeze(['1.0.0']);

/**
 * Brak zmiennej albo pusta wartość = tryb automatyczny 0.x. Każda inna wartość niż
 * dokładnie zatwierdzona wersja przerywa build.
 *
 * @param {string | undefined} value
 * @returns {string | null}
 */
export function resolveReleaseVersion(value) {
  if (value === undefined || value === '') return null;
  if (!APPROVED_RELEASE_VERSIONS.includes(value)) {
    throw new Error(
      `${RELEASE_VERSION_ENV}="${value}" nie jest obsługiwaną wersją wydania. ` +
        `Dozwolone: ${APPROVED_RELEASE_VERSIONS.join(', ')} albo brak zmiennej (wersja 0.x).`,
    );
  }
  return value;
}

/**
 * Metadane builda z uwzględnieniem jawnie ustawionej wersji wydania.
 * Wydanie ma postać `1.0.0+SHA` i wymaga prawidłowego SHA commita, żeby wersję
 * w stopce dało się powiązać z wdrożeniem i tagiem.
 *
 * @param {Date} builtAt
 * @param {string | undefined} release wartość `PRACUJBE_RELEASE_VERSION`
 * @param {...(string | undefined)} revisions kandydaci w kolejności preferencji
 */
export function createReleaseAwareBuildMetadata(builtAt, release, ...revisions) {
  const releaseVersion = resolveReleaseVersion(release);
  if (!releaseVersion) return createBuildMetadata(builtAt, ...revisions);

  assertValidDate(builtAt);
  const shortRevision = pickShortRevision(revisions);
  if (!shortRevision) {
    throw new Error(
      `${RELEASE_VERSION_ENV}=${releaseVersion} wymaga SHA commita ` +
        '(RAILWAY_GIT_COMMIT_SHA albo GITHUB_SHA).',
    );
  }

  return {
    buildTime: builtAt.toISOString(),
    version: `${releaseVersion}+${shortRevision}`,
  };
}

function assertValidDate(builtAt) {
  if (Number.isNaN(builtAt.getTime())) {
    throw new TypeError('Data buildu musi być prawidłową datą.');
  }
}

function pickShortRevision(revisions) {
  return revisions
    .map((revision) => revision?.trim().match(/^[0-9a-f]{7,40}$/i)?.[0])
    .find(Boolean)
    ?.slice(0, 8)
    .toLowerCase();
}
