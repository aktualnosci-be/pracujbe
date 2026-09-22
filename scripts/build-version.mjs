/**
 * Tworzy identyfikator konkretnego artefaktu przed premierą 1.0.
 *
 * Format pozostaje zgodny z SemVer, ale nigdy sam nie przechodzi na 1.0:
 * 0.YYYYMMDD.M+SHA, gdzie M to milisekundy od północy UTC.
 *
 * @param {Date} builtAt
 * @param {...(string | undefined)} revisions kandydaci w kolejności preferencji
 */
export function createBuildMetadata(builtAt = new Date(), ...revisions) {
  if (Number.isNaN(builtAt.getTime())) {
    throw new TypeError('Data buildu musi być prawidłową datą.');
  }

  const iso = builtAt.toISOString();
  const day = iso.slice(0, 10).replaceAll('-', '');
  const milliseconds =
    ((builtAt.getUTCHours() * 60 + builtAt.getUTCMinutes()) * 60 + builtAt.getUTCSeconds()) *
      1000 +
    builtAt.getUTCMilliseconds();
  const shortRevision = revisions
    .map((revision) => revision?.trim().match(/^[0-9a-f]{7,40}$/i)?.[0])
    .find(Boolean)
    ?.slice(0, 8)
    .toLowerCase();

  return {
    buildTime: iso,
    version: `0.${day}.${milliseconds}${shortRevision ? `+${shortRevision}` : ''}`,
  };
}
