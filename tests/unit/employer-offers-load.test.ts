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
  const relatedQuery = (rows: unknown[]) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  });
  const appsQuery = relatedQuery(appRows);
  const matchesQuery = relatedQuery(matchRows);
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
            ? appsQuery
            : matchesQuery,
      ),
  };
  vi.mocked(createServerClient).mockResolvedValue(supabase as never);
  return { supabase, query, appsQuery, matchesQuery };
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

  it("reveals jobs beyond twelve without repeating page one", async () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      id: `job-${index}`,
      title: `Offer ${index}`,
      city: "Brussels",
      status: "active",
    }));
    const { query, appsQuery, matchesQuery } = client(
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
    expect(appsQuery.eq).toHaveBeenCalledWith("company_id", "company-1");
    expect(appsQuery.in).toHaveBeenCalledWith(
      "job_id",
      rows.slice(12, 24).map((job) => job.id),
    );
    expect(matchesQuery.in).toHaveBeenCalledWith(
      "job_id",
      rows.slice(12, 24).map((job) => job.id),
    );
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
