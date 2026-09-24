import { beforeEach, describe, expect, it, vi } from "vitest";

import { getTopMatchedCandidates } from "@/lib/data/employer";
import { getActiveCompany } from "@/lib/company-context";
import { getPortalIdentity } from "@/lib/db/portal";
import { captureError } from "@/lib/sentry";
import { fakeDb, fakeSession, pgError, resetFakeDb } from "../helpers/fake-db";

vi.mock("@/lib/db/portal", async () => {
  const portal = (await import("../helpers/fake-db")).fakePortal();
  return { ...portal, getPortalIdentity: vi.fn(portal.getPortalIdentity) };
});
vi.mock("@/lib/company-context", () => ({ getActiveCompany: vi.fn() }));
vi.mock("@/lib/sentry", () => ({ captureError: vi.fn() }));

const USER = "11111111-1111-4111-8111-111111111111";

/** Rejestruje odczyty loadera; `failed` = nazwa zapytania/RPC, która zgłasza błąd bazy. */
function db(
  options: {
    winners?: unknown[];
    failed?: string;
    rows?: Record<string, unknown[]>;
  } = {},
) {
  const error = pgError("XX000", `${options.failed ?? ""} unavailable`);
  const handler = (name: string, rows: unknown[]) => () => {
    if (options.failed === name) throw error;
    return rows;
  };
  const rows = options.rows ?? {};
  fakeDb
    .rpc("get_company_top_matches", handler("get_company_top_matches", options.winners ?? []))
    .rows("employer.top-candidates-profiles", handler("employer.top-candidates-profiles", rows["profiles"] ?? []))
    .rows("employer.top-candidates-names", handler("employer.top-candidates-names", rows["names"] ?? []))
    .rows("employer.top-candidates-jobs", handler("employer.top-candidates-jobs", rows["jobs"] ?? []))
    .rows("employer.top-candidates-offers", handler("employer.top-candidates-offers", rows["offers"] ?? []));
  return error;
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

describe("employer candidates read", () => {
  it("keeps a successful empty read distinct from failure", async () => {
    db();
    expect(await getTopMatchedCandidates({ throwOnError: true })).toEqual([]);
    expect(captureError).not.toHaveBeenCalled();
    // Pusty wynik RPC = brak dalszych zapytań o kandydatów.
    expect(fakeDb.calls.map((c) => c.name)).toEqual(["get_company_top_matches"]);
  });

  it("reports read failure to the candidates page after capture", async () => {
    const error = db({ failed: "get_company_top_matches" });
    await expect(getTopMatchedCandidates({ throwOnError: true })).rejects.toBe(error);
    expect(captureError).toHaveBeenCalledWith(error, {
      area: "employer.getTopMatchedCandidates",
    });
  });

  it("reports a session read failure instead of showing an empty match list", async () => {
    db();
    const error = new Error("Auth service unavailable");
    vi.mocked(getPortalIdentity).mockRejectedValueOnce(error);
    await expect(getTopMatchedCandidates({ throwOnError: true })).rejects.toBe(error);
    expect(fakeDb.calls).toHaveLength(0);
    expect(captureError).toHaveBeenCalledWith(error, {
      area: "employer.getTopMatchedCandidates",
    });
  });

  it("keeps a valid missing session as an empty result", async () => {
    db();
    fakeSession.identity = null;
    expect(await getTopMatchedCandidates({ throwOnError: true })).toEqual([]);
    expect(fakeDb.calls).toHaveLength(0);
    expect(getActiveCompany).not.toHaveBeenCalled();
    expect(captureError).not.toHaveBeenCalled();
  });

  it.each([
    "get_company_top_matches",
    "employer.top-candidates-profiles",
    "employer.top-candidates-names",
    "employer.top-candidates-jobs",
    "employer.top-candidates-offers",
  ])("propagates %s errors instead of rendering an empty state", async (failed) => {
    const error = db({
      failed,
      winners: [{ candidate_id: "candidate-1", job_id: "job-1", score: 92 }],
      rows: {
        profiles: [{ profile_id: "candidate-1", headline: "Operator", city: "Liège" }],
        names: [{ id: "candidate-1", first_name: "Ada", last_name: "Nowak" }],
      },
    });
    await expect(getTopMatchedCandidates({ throwOnError: true })).rejects.toBe(error);
    expect(captureError).toHaveBeenCalledWith(error, {
      area: "employer.getTopMatchedCandidates",
    });
  });

  it("does not query candidates for an unverified company", async () => {
    db();
    vi.mocked(getActiveCompany).mockResolvedValueOnce({
      activeId: "company-1",
      activeStatus: "unverified",
      activeName: "Firma",
      activeRole: "owner",
      companies: [],
    });
    expect(await getTopMatchedCandidates({ throwOnError: true })).toEqual([]);
    expect(fakeDb.calls).toHaveLength(0);
  });

  it("asks the database for five distinct candidates of the active company (#141)", async () => {
    // RPC zwraca już zwycięzców na kandydata; loader zachowuje kolejność i job_id dopasowania.
    const winners = ["A", "B", "C", "D", "E"].map((c, i) => ({
      candidate_id: `candidate-${c}`,
      job_id: `job-${c}`,
      score: 100 - i,
    }));
    db({ winners });

    const result = await getTopMatchedCandidates({ throwOnError: true });
    const [call] = fakeDb.callsTo("get_company_top_matches");
    expect(call?.args).toEqual({ p_company_id: "company-1", p_limit: 5 });
    // Odczyt pod sesją pracodawcy, nigdy service_role.
    expect(new Set(fakeDb.calls.map((c) => c.as))).toEqual(new Set([USER]));
    expect(result.map((c) => [c.candidateId, c.jobId])).toEqual(
      winners.map((w) => [w.candidate_id, w.job_id]),
    );
    expect(fakeDb.callsTo("employer.top-candidates-profiles")[0]?.values).toEqual([
      winners.map((w) => w.candidate_id),
    ]);
  });

  it("returns the target job title and the active offer state from the database (#327)", async () => {
    db({
      winners: [
        { candidate_id: "candidate-1", job_id: "job-1", score: 92 },
        { candidate_id: "candidate-2", job_id: "job-1", score: 80 },
      ],
      rows: {
        jobs: [{ id: "job-1", title: "Operator wózka", slug: "operator-wozka" }],
        offers: [{ candidate_id: "candidate-1", job_id: "job-1", sent_at: "2026-09-20T10:00:00Z" }],
      },
    });
    const result = await getTopMatchedCandidates({ throwOnError: true });
    expect(result.map((c) => [c.candidateId, c.jobTitle, c.jobSlug, c.offerSentAt])).toEqual([
      ["candidate-1", "Operator wózka", "operator-wozka", "2026-09-20T10:00:00Z"],
      ["candidate-2", "Operator wózka", "operator-wozka", null],
    ]);
    const [offers] = fakeDb.callsTo("employer.top-candidates-offers");
    expect(offers?.values).toEqual([["candidate-1", "candidate-2"], ["job-1"]]);
    expect(offers?.text).toContain("status IN ('sent', 'viewed')");
    expect(offers?.text).toContain("deleted_at IS NULL");
  });
});
