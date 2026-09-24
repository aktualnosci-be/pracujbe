import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCompanyJobsLoad } from "@/lib/data/employer";
import { isSupabaseConfigured } from "@/lib/env";
import { createServerClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/company-context";
import { captureError } from "@/lib/sentry";

vi.mock("@/lib/env", () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }));
vi.mock("@/lib/company-context", () => ({ getActiveCompany: vi.fn() }));
vi.mock("@/lib/sentry", () => ({ captureError: vi.fn() }));

function client(
  jobRows: unknown[],
  jobError: unknown = null,
  appRows: unknown[] = [],
  matchRows: unknown[] = [],
  countError: unknown = null,
) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi
      .fn()
      .mockImplementation((start: number, end: number) =>
        Promise.resolve({
          data: jobRows.slice(start, end + 1),
          error: jobError,
        }),
      ),
  };
  const appQueries: Array<{ select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn> }> = [];
  const matchQueries: Array<{ select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn> }> = [];
  const relatedQuery = (rows: unknown[], queries: typeof appQueries, error: unknown = null) => {
    let jobId = "";
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((key: string, value: string) => {
        if (key === "job_id") jobId = value;
        return query;
      }),
      is: vi.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ count: rows.filter((row) => (row as { job_id: string }).job_id === jobId).length, error }).then(resolve),
    };
    queries.push(query);
    return query;
  };
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
    },
    from: vi
      .fn()
      .mockImplementation((table: string) =>
        table === "jobs"
          ? query
          : table === "applications"
            ? relatedQuery(appRows, appQueries, countError)
            : relatedQuery(matchRows, matchQueries),
      ),
  };
  vi.mocked(createServerClient).mockResolvedValue(supabase as never);
  return { supabase, query, appQueries, matchQueries };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
  vi.mocked(getActiveCompany).mockResolvedValue({
    activeId: "company-1",
    activeStatus: "verified",
    activeName: "Firma",
    activeRole: "owner",
    companies: [],
  });
});

describe("employer offers read state", () => {
  it("does not present a failed jobs read as an empty list", async () => {
    const error = { code: "DATABASE_UNAVAILABLE" };
    const { query } = client([], error);
    expect(await getCompanyJobsLoad()).toEqual({ status: "error" });
    expect(query.eq).toHaveBeenCalledWith("company_id", "company-1");
    expect(captureError).toHaveBeenCalledWith(error, {
      area: "employer.getCompanyJobs",
    });
  });

  it("returns an actual empty result only after a successful read", async () => {
    const { query } = client([]);
    expect(await getCompanyJobsLoad()).toEqual({
      status: "ok",
      jobs: [],
      hasNext: false,
    });
    expect(query.range).toHaveBeenCalledWith(0, 12);
    expect(captureError).not.toHaveBeenCalled();
  });

  it("maps the creation date instead of exposing only the technical id", async () => {
    const { query } = client([
      { id: "job-1", title: "Offer", city: "Brussels", status: "active", created_at: "2026-09-18T09:00:00Z" },
      { id: "job-2", title: "Offer 2", city: "Gent", status: "draft" },
    ]);
    const result = await getCompanyJobsLoad();
    expect(query.select).toHaveBeenCalledWith("id, title, city, status, slug, expires_at, created_at");
    expect(result.status === "ok" && result.jobs.map((job) => job.createdAt)).toEqual([
      "2026-09-18T09:00:00Z",
      null,
    ]);
  });

  it("shows an active job past expires_at as expired before maintenance runs (#72)", async () => {
    client([
      { id: "job-1", title: "Past", city: "Gent", status: "active", expires_at: "2020-01-01T00:00:00Z" },
      { id: "job-2", title: "Future", city: "Gent", status: "active", expires_at: "2999-01-01T00:00:00Z" },
      { id: "job-3", title: "Open-ended", city: "Gent", status: "active", expires_at: null },
      { id: "job-4", title: "Paused past", city: "Gent", status: "paused", expires_at: "2020-01-01T00:00:00Z" },
    ]);
    const result = await getCompanyJobsLoad();
    expect(result.status === "ok" && result.jobs.map((job) => [job.status, job.pastExpiry])).toEqual([
      ["expired", true],
      ["active", false],
      ["active", false],
      ["paused", true],
    ]);
  });

  it("does not show zero counts when a count request fails", async () => {
    const error = { code: "COUNT_UNAVAILABLE" };
    client([{ id: "job-1", title: "Offer", city: "Brussels", status: "active" }], null, [], [], error);
    expect(await getCompanyJobsLoad()).toEqual({ status: "error" });
    expect(captureError).toHaveBeenCalledWith(error, { area: "employer.getCompanyJobs" });
  });

  it("bounds invalid page numbers to the first page", async () => {
    const { query } = client([]);
    await getCompanyJobsLoad(0);
    await getCompanyJobsLoad(Number.MAX_SAFE_INTEGER);
    expect(query.range.mock.calls).toEqual([[0, 12], [0, 12]]);
  });

  it("reveals jobs beyond twelve without repeating page one", async () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      id: `job-${index}`,
      title: `Offer ${index}`,
      city: "Brussels",
      status: "active",
    }));
    const { query, appQueries, matchQueries } = client(
      rows,
      null,
      [{ job_id: "job-12" }, { job_id: "job-12" }],
      [{ job_id: "job-12" }],
    );
    const first = await getCompanyJobsLoad(1);
    const second = await getCompanyJobsLoad(2);
    const third = await getCompanyJobsLoad(3);
    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    expect(third.status).toBe("ok");
    if (
      first.status !== "ok" ||
      second.status !== "ok" ||
      third.status !== "ok"
    )
      return;
    expect(first.jobs.map((job) => job.id)).toEqual(
      rows.slice(0, 12).map((job) => job.id),
    );
    expect(second.jobs.map((job) => job.id)).toEqual(
      rows.slice(12, 24).map((job) => job.id),
    );
    expect(second.jobs[0]).toMatchObject({ newApplications: 2, matched: 1 });
    expect(third.jobs.map((job) => job.id)).toEqual(["job-24"]);
    expect([first.hasNext, second.hasNext, third.hasNext]).toEqual([
      true,
      true,
      false,
    ]);
    expect(query.range.mock.calls).toEqual([
      [0, 12],
      [12, 24],
      [24, 36],
    ]);
    expect(appQueries).toHaveLength(25);
    expect(matchQueries).toHaveLength(25);
    expect(appQueries[12]!.eq).toHaveBeenCalledWith("company_id", "company-1");
    expect(appQueries[12]!.eq).toHaveBeenCalledWith("job_id", "job-12");
    expect(matchQueries[12]!.eq).toHaveBeenCalledWith("job_id", "job-12");
    expect(appQueries[12]!.select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(query.order.mock.calls).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
  });

  it("does not read company jobs without active membership", async () => {
    const { supabase } = client([]);
    vi.mocked(getActiveCompany).mockResolvedValueOnce({
      activeId: null,
      activeStatus: "unverified",
      activeName: "",
      activeRole: "member",
      companies: [],
    });
    expect(await getCompanyJobsLoad()).toEqual({
      status: "ok",
      jobs: [],
      hasNext: false,
    });
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
