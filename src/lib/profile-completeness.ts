/** Ten sam próg oceny obowiązuje na pulpicie i stronie profilu. */
export function getProfileLevelTitle(completionPct: number, goodLevel: string): string | undefined {
  return completionPct >= 60 ? goodLevel : undefined;
}
