/**
 * #718 — data propozycji w szczególe kandydata (`getEmployerCandidateDetail`) nie może zależeć
 * od kolejności wierszy zwróconych przez SQL bez `ORDER BY`. Dwie aktywne propozycje (`sent`/
 * `viewed`) dla tej samej pary kandydat–oferta muszą zawsze dać najnowszą z nich, niezależnie
 * od tego, w jakiej kolejności atrapa bazy zwróci wiersze `offers`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getEmployerCandidateDetail } from "@/lib/data/employer";
import { getActiveCompany } from "@/lib/company-context";
import { fakeDb, resetFakeDb } from "../helpers/fake-db";
import { withRecruitmentMode } from '../helpers/portal-mode';

// Przepływ rekrutacyjny (#1128): w trybie ogłoszeniowym ta ścieżka jest wyłączona.
withRecruitmentMode();

vi.mock("@/lib/db/portal", async () => {
  const portal = (await import("../helpers/fake-db")).fakePortal();
  return { ...portal };
});
vi.mock("@/lib/company-context", () => ({ getActiveCompany: vi.fn() }));
vi.mock("@/lib/error-report", () => ({ captureError: vi.fn() }));

const USER = "22222222-2222-4222-8222-222222222222";
const CANDIDATE = "33333333-3333-4333-8333-333333333333";
const JOB = "44444444-4444-4444-8444-444444444444";

function db(offers: unknown[]) {
  fakeDb
    .rows("employer.candidate-detail-matches", [
      { job_id: JOB, score: 90, title: "Operator wózka", slug: "operator-wozka", can_offer: true },
    ])
    .rows("employer.candidate-detail-applications", [])
    .rows("employer.candidate-detail-offers", offers)
    .rows("employer.candidate-detail-name", [{ first_name: "Ada", last_name: "Nowak" }])
    .rows("employer.candidate-detail-profile", []);
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

describe("getEmployerCandidateDetail offer date (#718)", () => {
  it("picks the later of two active offers regardless of row order", async () => {
    db([
      { job_id: JOB, sent_at: "2026-09-10T10:00:00Z", created_at: "2026-09-10T10:00:00Z" },
      { job_id: JOB, sent_at: "2026-09-25T08:00:00Z", created_at: "2026-09-25T08:00:00Z" },
    ]);
    const result = await getEmployerCandidateDetail(CANDIDATE);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.candidate.matches).toEqual([
      expect.objectContaining({ jobId: JOB, offerSentAt: "2026-09-25T08:00:00Z" }),
    ]);
  });

  it("same rows in the opposite order still pick the latest date", async () => {
    db([
      { job_id: JOB, sent_at: "2026-09-25T08:00:00Z", created_at: "2026-09-25T08:00:00Z" },
      { job_id: JOB, sent_at: "2026-09-10T10:00:00Z", created_at: "2026-09-10T10:00:00Z" },
    ]);
    const result = await getEmployerCandidateDetail(CANDIDATE);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.candidate.matches).toEqual([
      expect.objectContaining({ jobId: JOB, offerSentAt: "2026-09-25T08:00:00Z" }),
    ]);
  });

  it("negative control: a single offer still surfaces its own date", async () => {
    db([{ job_id: JOB, sent_at: "2026-09-25T08:00:00Z", created_at: "2026-09-25T08:00:00Z" }]);
    const result = await getEmployerCandidateDetail(CANDIDATE);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(result.candidate.matches[0]?.offerSentAt).toBe("2026-09-25T08:00:00Z");
  });
});
