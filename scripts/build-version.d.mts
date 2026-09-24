export type BuildMetadata = {
  buildTime: string;
  version: string;
};

export function createBuildMetadata(
  builtAt?: Date,
  ...revisions: Array<string | undefined>
): BuildMetadata;

export const RELEASE_VERSION_ENV: 'PRACUJBE_RELEASE_VERSION';

export const APPROVED_RELEASE_VERSIONS: readonly string[];

export function resolveReleaseVersion(value: string | undefined): string | null;

export function createReleaseAwareBuildMetadata(
  builtAt: Date,
  release: string | undefined,
  ...revisions: Array<string | undefined>
): BuildMetadata;
