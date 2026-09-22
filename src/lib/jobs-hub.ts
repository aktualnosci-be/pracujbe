export type HubFacet = {
  href: string;
  count: number | undefined;
};

/** Łączy adres kafla z dokładnie tym kluczem, dla którego wykonano agregację. */
export function buildHubFacet(
  basePath: string,
  slug: string,
  countKey: string,
  counts: Record<string, number> | null,
): HubFacet {
  const count = counts?.[countKey];

  return {
    href: `${basePath}/${slug}`,
    count: typeof count === "number" && count > 0 ? count : undefined,
  };
}
