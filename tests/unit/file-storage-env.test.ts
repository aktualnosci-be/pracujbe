// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fileBucketConfig, fileDownloadSecret, isFileStorageConfigured, readinessChecks } from '@/lib/env';

/** Konfiguracja prywatnego bucketu Railway (#26): nazwy z presetu „AWS SDK” w Credentials. */

const BUCKET_ENV = {
  AWS_ENDPOINT_URL: 'https://t3.storageapi.dev',
  AWS_DEFAULT_REGION: 'auto',
  AWS_S3_BUCKET_NAME: 'pracujbe-cv-abc123',
  AWS_ACCESS_KEY_ID: 'tid_fixture',
  AWS_SECRET_ACCESS_KEY: 'tsec_fixture',
};
const RUNTIME_ENV = {
  FILE_DOWNLOAD_SECRET: 'a'.repeat(32),
  DATABASE_APP_URL: 'postgresql://app@localhost/pracujbe',
  DATABASE_AUTH_URL: 'postgresql://auth@localhost/pracujbe',
  BETTER_AUTH_SECRET: 'b'.repeat(32),
  BETTER_AUTH_URL: 'https://pracuj.be',
};

function stub(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value as string);
}

afterEach(() => vi.unstubAllEnvs());

describe('fileBucketConfig', () => {
  it('czyta komplet zmiennych; domyślnie virtual-hosted style', () => {
    stub(BUCKET_ENV);
    expect(fileBucketConfig()).toEqual({
      endpoint: 'https://t3.storageapi.dev',
      region: 'auto',
      bucket: 'pracujbe-cv-abc123',
      accessKeyId: 'tid_fixture',
      secretAccessKey: 'tsec_fixture',
      forcePathStyle: false,
    });
    stub({ AWS_S3_URL_STYLE: 'path' });
    expect(fileBucketConfig()?.forcePathStyle).toBe(true);
  });

  it.each([
    ...Object.keys(BUCKET_ENV).map((key) => ({ [key]: '' })),
    { AWS_ENDPOINT_URL: 'http://t3.storageapi.dev' },
    { AWS_ENDPOINT_URL: 'https://user:pass@t3.storageapi.dev' },
    { AWS_ENDPOINT_URL: 'https://t3.storageapi.dev/bucket' },
    { AWS_S3_URL_STYLE: 'dualstack' },
  ])('brak lub błąd %j → brak konfiguracji', (override) => {
    stub({ ...BUCKET_ENV, ...override });
    expect(fileBucketConfig()).toBeNull();
  });

  it('sekret linków pobrania ma co najmniej 32 bajty', () => {
    stub({ FILE_DOWNLOAD_SECRET: 'short' });
    expect(fileDownloadSecret()).toBeNull();
    stub({ FILE_DOWNLOAD_SECRET: 'a'.repeat(32) });
    expect(fileDownloadSecret()).toBe('a'.repeat(32));
  });
});

describe('readiness plików', () => {
  it('raportuje bucket i sekret osobno, bez wartości', () => {
    stub({ ...Object.fromEntries(Object.keys(BUCKET_ENV).map((k) => [k, ''])), FILE_DOWNLOAD_SECRET: '' });
    expect(readinessChecks()).toMatchObject({ fileBucket: false, fileDownloadSecret: false });
    stub({ ...BUCKET_ENV, ...RUNTIME_ENV });
    const checks = readinessChecks();
    expect(checks).toMatchObject({ fileBucket: true, fileDownloadSecret: true });
    expect(JSON.stringify(checks)).not.toContain('tsec_fixture');
  });

  it('pełna konfiguracja wymaga też bazy i sesji Better Auth', () => {
    stub({ ...BUCKET_ENV, ...RUNTIME_ENV });
    expect(isFileStorageConfigured()).toBe(true);
    stub({ DATABASE_APP_URL: '' });
    expect(isFileStorageConfigured()).toBe(false);
  });
});
