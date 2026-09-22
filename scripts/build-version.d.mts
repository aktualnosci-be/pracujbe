export type BuildMetadata = {
  buildTime: string;
  version: string;
};

export function createBuildMetadata(
  builtAt?: Date,
  ...revisions: Array<string | undefined>
): BuildMetadata;
