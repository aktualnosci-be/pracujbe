import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCompanyJobsLoad } from "@/lib/data/employer";
import { getActiveCompany } from "@/lib/company-context";
import { captureError } from "@/lib/sentry";
import { fakeDb, pgError, resetFakeDb } from "../helpers/fake-db";

vi.mock("@/lib/db/portal", async () => (await import("../helpers/fake-db")).fakePortal());
vi.mock("@/lib/company-context", () => ({ getActiveCompany: vi.fn() }));
vi.mock("@/lib/sentry", () => ({ captureError: vi.fn() }));

const USER = "11111111-1111-4111-8111-111111111111";

/** Strona ofert: atrapa zwraca wycinek wg OFFSET ($2) i LIMIT 13 zapytania. */
function db(jobRows: unknown[], error: unknown = null) {
  fakeDb.rows("employer.jobs-page", ({ values }) => {
    if (error) throw error;
    const offset = Number(values[1]);
    return jobRows.slice(offset, offset + 13);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: USER, role: "employer" });
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
    const error = pgError("XX000", "DATABASE_UNAVAILABLE");
    db([], error);
    expect(await getCompanyJobsLoad()).toEqual({ status: "error" });
    expect(fakeDb.callsTo("employer.jobs-page")[0]?.values[0]).toBe("company-1");
    expect(captureError).toHaveBeenCalledWith(error, {
      area: "employer.getCompanyJobs",
    });
  });

  it("returns an actual empty result only after a successful read", async () => {
    db([]);
    expect(await getCompanyJobsLoad()).toEqual({
      status: "ok",
      jobs: [],
      hasNext: false,
    });
    const [call] = fakeDb.callsTo("employer.jobs-page");
    expect(call?.values).toEqual(["company-1", 0]);
    expect(call?.text).toContain("LIMIT 13 OFFSET $2");
    expect(call?.as).toBe(USER);
    expect(captureError).not.toHaveBeenCalled();
  });

  it("maps the creation date instead of exposing only the technical id", async () => {
    db([
      { id: "job-1", title: "Offer", city: "Brussels", status: "active", created_at: "2026-09-18T09:00:00Z" },
      { id: "job-2", title: "Offer 2", city: "Gent", status: "draft" },
    ]);
    const result = await getCompanyJobsLoad();
    expect(fakeDb.callsTo("employer.jobs-page")[0]?.text).toMatch(
      /j\.id, j\.title, j\.city, j\.status, j\.slug, j\.expires_at, j\.created_at/,
    );
    expect(result.status === "ok" && result.jobs.map((job) => job.createdAt)).toEqual([
      "2026-09-18T09:00:00Z",
      null,
    ]);
  });

  it("shows an active job past expires_at as expired before maintenance runs (#72)", async () => {
    db([
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

  it("counts new applications and matches in the same database read, so a failed count is an error", async () => {
    db([{ id: "job-1", title: "Offer", city: "Brussels", status: "active", new_applications: 2, matched: 1 }]);
    const ok = await getCompanyJobsLoad();
    expect(ok.status === "ok" && ok.jobs[0]).toMatchObject({ newApplications: 2, matched: 1 });
    const text = fakeDb.callsTo("employer.jobs-page")[0]!.text;
    expect(text).toMatch(/count\(\*\) FROM public\.applications a[\s\S]*a\.status = 'submitted' AND a\.deleted_at IS NULL/);
    expect(text).toMatch(/count\(\*\) FROM public\.matches m WHERE m\.job_id = j\.id/);

    resetFakeDb({ id: USER, role: "employer" });
    const error = pgError("XX000", "COUNT_UNAVAILABLE");
    db([], error);
    expect(await getCompanyJobsLoad()).toEqual({ status: "error" });
    expect(captureError).toHaveBeenCalledWith(error, { area: "employer.getCompanyJobs" });
  });

  it("bounds invalid page numbers to the first page", async () => {
    db([]);
    await getCompanyJobsLoad(0);
    await getCompanyJobsLoad(Number.MAX_SAFE_INTEGER);
    expect(fakeDb.callsTo("employer.jobs-page").map((c) => c.values[1])).toEqual([0, 0]);
  });

  it("reveals jobs beyond twelve without repeating page one", async () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      id: `job-${index}`,
      title: `Offer ${index}`,
      city: "Brussels",
      status: "active",
      new_applications: index === 12 ? 2 : 0,
      matched: index === 12 ? 1 : 0,
    }));
    db(rows);
    const first = await getCompanyJobsLoad(1);
    const second = await getCompanyJobsLoad(2);
    const third = await getCompanyJobsLoad(3);
    if (first.status !== "ok" || second.status !== "ok" || third.status !== "ok") {
      throw new Error("expected ok pages");
    }
    expect(first.jobs.map((job) => job.id)).toEqual(rows.slice(0, 12).map((job) => job.id));
    expect(second.jobs.map((job) => job.id)).toEqual(rows.slice(12, 24).map((job) => job.id));
    expect(second.jobs[0]).toMatchObject({ newApplications: 2, matched: 1 });
    expect(third.jobs.map((job) => job.id)).toEqual(["job-24"]);
    expect([first.hasNext, second.hasNext, third.hasNext]).toEqual([true, true, false]);
    expect(fakeDb.callsTo("employer.jobs-page").map((c) => c.values)).toEqual([
      ["company-1", 0],
      ["company-1", 12],
      ["company-1", 24],
    ]);
    expect(fakeDb.callsTo("employer.jobs-page")[0]!.text).toContain("ORDER BY j.created_at DESC, j.id DESC");
  });

  it("does not read company jobs without active membership", async () => {
    db([]);
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
    expect(fakeDb.calls).toHaveLength(0);
  });
});
