import { describe, expect, it, vi } from "vitest";

import {
  getPublicJobCategoryCounts,
  getPublicJobCityCounts,
} from "@/lib/db/public-jobs";
import type { TransactionClient, TransactionPool } from "@/lib/db/transaction";

describe("Grupowane liczniki publicznych ofert", () => {
  it("wykonuje najwyżej po jednym agregacie na wymiar i zachowuje publiczny zakres", async () => {
    const aggregateSql: string[] = [];
    const query = vi.fn(async (text: string) => {
      if (text.includes("get_public_job_category_counts")) {
        aggregateSql.push(text);
        return {
          rows: [
            { key: "construction", total: 237 },
            { key: "transport", total: 4 },
          ],
        };
      }
      if (text.includes("get_public_job_city_counts")) {
        aggregateSql.push(text);
        return {
          rows: [
            { key: "Brussels", total: 91 },
            { key: "Antwerp", total: 12 },
            { key: "Ghent", total: 0 },
          ],
        };
      }
      return { rows: [] };
    });
    const client: TransactionClient = { query, release: vi.fn() };
    const pool: TransactionPool = { connect: vi.fn(async () => client) };

    await expect(
      getPublicJobCategoryCounts(pool, [
        "construction",
        "transport",
        "warehouse",
      ]),
    ).resolves.toEqual({ construction: 237, transport: 4, warehouse: 0 });
    await expect(
      getPublicJobCityCounts(pool, ["Brussels", "Antwerp", "Ghent"]),
    ).resolves.toEqual({
      Brussels: 91,
      Antwerp: 12,
      Ghent: 0,
    });

    expect(aggregateSql).toHaveLength(2);
    expect(aggregateSql[0]).toContain(
      "public.get_public_job_category_counts($1::text[])",
    );
    expect(aggregateSql[1]).toContain(
      "public.get_public_job_city_counts($1::text[])",
    );
    expect(
      query.mock.calls.filter(([sql]) =>
        String(sql).includes("_counts($1::text[])"),
      ),
    ).toHaveLength(2);
    expect(
      query.mock.calls.filter(([sql]) => sql === "SET LOCAL ROLE anon"),
    ).toHaveLength(2);
    expect(query.mock.calls.filter(([sql]) => sql === "BEGIN")).toHaveLength(2);
    expect(query.mock.calls.filter(([sql]) => sql === "COMMIT")).toHaveLength(
      2,
    );
  });
});
