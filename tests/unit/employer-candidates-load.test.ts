import { beforeEach, describe, expect, it, vi } from "vitest";

import { getTopMatchedCandidates } from "@/lib/data/employer";
import { isSupabaseConfigured } from "@/lib/env";
import { createServerClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/company-context";
import { captureError } from "@/lib/sentry";

vi.mock("@/lib/env", () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: vi.fn() }));
vi.mock("@/lib/company-context", () => ({ getActiveCompany: vi.fn() }));
vi.mock("@/lib/sentry", () => ({ captureError: vi.fn() }));

function client(error: unknown = null) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ data: [], error }),
  };
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
    },
    from: vi.fn().mockReturnValue(query),
  };
  vi.mocked(createServerClient).mockResolvedValue(supabase as never);
  return { supabase, query };
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

describe("employer candidates read", () => {
  it("keeps a successful empty read distinct from failure", async () => {
    client();
    expect(await getTopMatchedCandidates({ throwOnError: true })).toEqual([]);
    expect(captureError).not.toHaveBeenCalled();
  });

  it("reports read failure to the candidates page after capture", async () => {
    const error = { code: "DATABASE_UNAVAILABLE" };
    client(error);
    await expect(getTopMatchedCandidates({ throwOnError: true })).rejects.toBe(
      error,
    );
    expect(captureError).toHaveBeenCalledWith(error, {
      area: "employer.getTopMatchedCandidates",
    });
  });

  it("does not query candidates for an unverified company", async () => {
    const { supabase } = client();
    vi.mocked(getActiveCompany).mockResolvedValueOnce({
      activeId: "company-1",
      activeStatus: "unverified",
      activeName: "Firma",
      activeRole: "owner",
      companies: [],
    });
    expect(await getTopMatchedCandidates({ throwOnError: true })).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
