import { createBuildMetadata } from '../../scripts/build-version.mjs';
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
