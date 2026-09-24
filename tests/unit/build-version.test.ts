import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  APPROVED_RELEASE_VERSIONS,
  createBuildMetadata,
  createReleaseAwareBuildMetadata,
  resolveReleaseVersion,
} from '../../scripts/build-version.mjs';
import { describe, expect, it } from 'vitest';

describe('wersja artefaktu przed premierą 1.0', () => {
  it('łączy datę, czas UTC i dokładny commit w wersję zgodną z SemVer', () => {
    expect(
      createBuildMetadata(
        new Date('2026-09-22T11:39:05.987Z'),
        '1E4B285F4ACB4CF5D24A5D2409F606241F61827C',
      ),
    ).toEqual({
      buildTime: '2026-09-22T11:39:05.987Z',
      version: '0.20260922.41945987+1e4b285f',
    });
  });

  it.each(['2027-03-22T11:39:05Z', '2031-09-22T11:39:05Z'])(
    'nie awansuje automatycznie do 1.0 wraz z upływem czasu: %s',
    (date) => {
      expect(createBuildMetadata(new Date(date), 'abcdef0123456789').version).toMatch(/^0\./);
    },
  );

  it('pomija metadane commita, gdy dostawca nie przekazał prawidłowego SHA', () => {
    expect(createBuildMetadata(new Date('2026-09-22T00:00:01Z'), 'local').version).toBe(
      '0.20260922.1000',
    );
  });

  it('wybiera pierwszy prawidłowy SHA zamiast zatrzymywać się na pustej zmiennej Railway', () => {
    expect(
      createBuildMetadata(new Date('2026-09-22T00:00:00Z'), '', 'abcdef0123456789').version,
    ).toBe('0.20260922.0+abcdef01');
  });

  it('rozróżnia dwa buildy tego samego commita w różnych milisekundach', () => {
    const first = createBuildMetadata(new Date('2026-09-22T11:39:05.001Z'), 'abcdef0123456789');
    const second = createBuildMetadata(new Date('2026-09-22T11:39:05.999Z'), 'abcdef0123456789');

    expect(first.version).not.toBe(second.version);
  });

  it('odrzuca nieprawidłową datę zamiast publikować fałszywą wersję', () => {
    expect(() => createBuildMetadata(new Date('invalid'))).toThrow(
      'Data buildu musi być prawidłową datą.',
    );
  });
});

describe('kontrolowane wejście wersji wydania (#103)', () => {
  const builtAt = new Date('2026-09-22T11:39:05.987Z');
  const sha = '1e4b285f4acb4cf5d24a5d2409f606241f61827c';

  it.each([undefined, ''])('bez zmiennej (%j) zostaje automatyczny major 0', (release) => {
    expect(createReleaseAwareBuildMetadata(builtAt, release, sha)).toEqual(
      createBuildMetadata(builtAt, sha),
    );
  });

  it('dokładnie zatwierdzona wartość 1.0.0 daje 1.0.0+SHA z tym samym czasem buildu', () => {
    expect(createReleaseAwareBuildMetadata(builtAt, '1.0.0', '', sha)).toEqual({
      buildTime: '2026-09-22T11:39:05.987Z',
      version: '1.0.0+1e4b285f',
    });
  });

  it('wydanie bez prawidłowego SHA przerywa build', () => {
    expect(() => createReleaseAwareBuildMetadata(builtAt, '1.0.0', 'local', undefined)).toThrow(
      /wymaga SHA commita/,
    );
  });

  it.each(['1.0', 'v1.0.0', ' 1.0.0', '1.0.0 ', '1.0.1', '1.1.0', '2.0.0', '0.1.0', 'true', '1'])(
    'odrzuca nieobsługiwaną wartość %j czytelnym błędem',
    (value) => {
      expect(() => resolveReleaseVersion(value)).toThrow(/PRACUJBE_RELEASE_VERSION=.*nie jest obsługiwaną/);
      expect(() => createReleaseAwareBuildMetadata(builtAt, value, sha)).toThrow();
    },
  );

  it('nie czerpie wersji z package.json ani npm_package_version', () => {
    const previous = process.env.npm_package_version;
    process.env.npm_package_version = '1.0.0';
    try {
      expect(createReleaseAwareBuildMetadata(builtAt, undefined, sha).version).toMatch(/^0\./);
    } finally {
      if (previous === undefined) delete process.env.npm_package_version;
      else process.env.npm_package_version = previous;
    }
    const source = readFileSync(join(process.cwd(), 'scripts/build-version.mjs'), 'utf8');
    expect(source).not.toMatch(/package\.json['"]|npm_package_version/);
  });

  it('next.config.mjs przekazuje do builda wyłącznie PRACUJBE_RELEASE_VERSION', () => {
    const config = readFileSync(join(process.cwd(), 'next.config.mjs'), 'utf8');
    expect(config).toMatch(
      /createReleaseAwareBuildMetadata\(\s*new Date\(\),\s*process\.env\.PRACUJBE_RELEASE_VERSION,/,
    );
  });

  it('CHANGELOG.md zawiera wyłącznie sekcje zatwierdzonych wersji', () => {
    const changelog = readFileSync(join(process.cwd(), 'CHANGELOG.md'), 'utf8');
    const released = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);
    for (const version of released) expect(APPROVED_RELEASE_VERSIONS).toContain(version);
    expect(changelog).toMatch(/^## \[Unreleased\]/m);
  });
});
