import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCompanyJobsLoad } from "@/lib/data/employer";
import { decodeTimeCursor, type ListPageRequest, type TimeCursor } from "@/lib/employer/list-cursor";
import { getActiveCompany } from "@/lib/company-context";
import { captureError } from "@/lib/error-report";
import { fakeDb, pgError, resetFakeDb } from "../helpers/fake-db";

vi.mock("@/lib/db/portal", async () => (await import("../helpers/fake-db")).fakePortal());
vi.mock("@/lib/company-context", () => ({ getActiveCompany: vi.fn() }));
vi.mock("@/lib/error-report", () => ({ captureError: vi.fn() }));

const USER = "11111111-1111-4111-8111-111111111111";

type Row = { id: string; created_at?: string } & Record<string, unknown>;

/**
 * Strona ofert: atrapa odtwarza kursor bazy — wiersze w porządku listy (created_at, id malejąco),
 * `$2/$3` = kursor, `$4` = LIMIT; zapytanie „-prev” czyta rosnąco od kursora.
 */
function db(jobRows: Row[], error: unknown = null) {
  const key = (r: Row) => `${r.created_at ?? ""}|${r.id}`;
  for (const [name, prev] of [["employer.jobs-page", false], ["employer.jobs-page-prev", true]] as const) {
    fakeDb.rows(name, ({ values }) => {
      if (error) throw error;
      const cursor = values[1] === null ? null : `${String(values[1])}|${String(values[2])}`;
      const ordered = prev ? [...jobRows].reverse() : jobRows;
      const after = cursor === null ? ordered : ordered.filter((r) => (prev ? key(r) > cursor : key(r) < cursor));
      return after.slice(0, Number(values[3]));
    });
  }
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
      prevCursor: null,
      nextCursor: null,
    });
    const [call] = fakeDb.callsTo("employer.jobs-page");
    expect(call?.values).toEqual(["company-1", null, null, 13]);
    expect(call?.text).toContain("LIMIT $4");
    expect(call?.text).not.toContain("OFFSET");
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

  it("walks all pages by cursor in both directions without repeats or gaps (P1-05)", async () => {
    // 25 ofert; remis created_at na granicy stron rozstrzyga UUID.
    const rows: Row[] = Array.from({ length: 25 }, (_, index) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(99 - index).padStart(12, "0")}`,
      title: `Offer ${index}`,
      city: "Brussels",
      status: "active",
      created_at: index < 14 ? "2026-09-20T10:00:00.000001+00:00" : "2026-09-19T10:00:00+00:00",
      new_applications: index === 12 ? 2 : 0,
      matched: index === 12 ? 1 : 0,
    }));
    db(rows);
    const next = (token: string | null): ListPageRequest<TimeCursor> =>
      ({ cursor: decodeTimeCursor(token), direction: "next" });
    const first = await getCompanyJobsLoad();
    if (first.status !== "ok") throw new Error("expected ok");
    const second = await getCompanyJobsLoad(next(first.nextCursor));
    if (second.status !== "ok") throw new Error("expected ok");
    const third = await getCompanyJobsLoad(next(second.nextCursor));
    if (third.status !== "ok") throw new Error("expected ok");
    expect([...first.jobs, ...second.jobs, ...third.jobs].map((job) => job.id)).toEqual(rows.map((r) => r.id));
    expect(second.jobs[0]).toMatchObject({ newApplications: 2, matched: 1 });
    expect([first.prevCursor, first.nextCursor !== null]).toEqual([null, true]);
    expect(third.nextCursor).toBeNull();
    // Kursor niesie czas z mikrosekundami bez zaokrąglenia przez Date.
    expect(decodeTimeCursor(first.nextCursor)?.ts).toBe("2026-09-20T10:00:00.000001+00:00");

    // Wstecz z trzeciej strony: dokładnie druga strona, potem pierwsza bez kursora „nowsze”.
    const back = await getCompanyJobsLoad({ cursor: decodeTimeCursor(third.prevCursor), direction: "prev" });
    if (back.status !== "ok") throw new Error("expected ok");
    expect(back.jobs.map((job) => job.id)).toEqual(second.jobs.map((job) => job.id));
    const top = await getCompanyJobsLoad({ cursor: decodeTimeCursor(back.prevCursor), direction: "prev" });
    if (top.status !== "ok") throw new Error("expected ok");
    expect(top.jobs.map((job) => job.id)).toEqual(first.jobs.map((job) => job.id));
    expect(top.prevCursor).toBeNull();
    expect(fakeDb.callsTo("employer.jobs-page")[0]!.text).toContain("ORDER BY j.created_at DESC, j.id DESC");
    expect(fakeDb.callsTo("employer.jobs-page-prev")[0]!.text).toContain("ORDER BY j.created_at ASC, j.id ASC");
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
      prevCursor: null,
      nextCursor: null,
    });
    expect(fakeDb.calls).toHaveLength(0);
  });
});
