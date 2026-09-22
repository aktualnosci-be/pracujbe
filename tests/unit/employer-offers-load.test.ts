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

function client(jobRows: unknown[], jobError: unknown = null) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: jobRows, error: jobError }),
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
    expect(await getCompanyJobsLoad()).toEqual({ status: "ok", jobs: [] });
    expect(query.limit).toHaveBeenCalledWith(12);
    expect(captureError).not.toHaveBeenCalled();
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
    expect(await getCompanyJobsLoad()).toEqual({ status: "ok", jobs: [] });
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
