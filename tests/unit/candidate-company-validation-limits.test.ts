import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CANDIDATE_ITEM_LIMITS,
  step1Schema,
  step2Schema,
  step3Schema,
  step5Schema,
} from "@/lib/validation/candidate";
import { companyFormSchema } from "@/lib/validation/company";

function firstMessage(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? null : result.error?.issues[0]?.message;
}

describe("onboarding i dane firmy: puste pole = „wymagane” (#367)", () => {
  const base = { firstName: "Anna", lastName: "Nowak" };

  it.each([
    ["firstName", "candidate.error.firstNameRequired", "candidate.error.firstNameTooShort"],
    ["lastName", "candidate.error.lastNameRequired", "candidate.error.lastNameTooShort"],
  ])("%s: '' i spacje → wymagane, 1 znak → za krótkie", (field, required, tooShort) => {
    expect(firstMessage(step1Schema.safeParse({ ...base, [field]: "" }))).toBe(required);
    expect(firstMessage(step1Schema.safeParse({ ...base, [field]: "   " }))).toBe(required);
    expect(firstMessage(step1Schema.safeParse({ ...base, [field]: "A" }))).toBe(tooShort);
  });

  it("nazwa firmy: '' → nameRequired, 1 znak → nameTooShort", () => {
    expect(firstMessage(companyFormSchema.safeParse({ name: "" }))).toBe(
      "company.error.nameRequired",
    );
    expect(firstMessage(companyFormSchema.safeParse({ name: "  " }))).toBe(
      "company.error.nameRequired",
    );
    expect(firstMessage(companyFormSchema.safeParse({ name: "A" }))).toBe(
      "company.error.nameTooShort",
    );
    expect(companyFormSchema.safeParse({ name: "AB" }).success).toBe(true);
  });
});

describe("onboarding: limity pozycji list (#364)", () => {
  const cases: [string, (item: string) => { success: boolean }, number][] = [
    [
      "zawód",
      (item) => step2Schema.safeParse({ occupations: [item], categories: ["warehouse"] }),
      CANDIDATE_ITEM_LIMITS.occupation,
    ],
    [
      "umiejętność",
      (item) => step3Schema.safeParse({ skills: [item], experienceYears: 2 }),
      CANDIDATE_ITEM_LIMITS.skill,
    ],
    [
      "certyfikat",
      (item) => step5Schema.safeParse({ certificates: [item] }),
      CANDIDATE_ITEM_LIMITS.certificate,
    ],
  ];

  for (const [name, parse, max] of cases) {
    it(`${name}: ${max} znaków przechodzi, ${max + 1} jest odrzucane`, () => {
      expect(parse("a".repeat(max)).success).toBe(true);
      const tooLong = parse("a".repeat(max + 1));
      expect(tooLong.success).toBe(false);
      expect(firstMessage(tooLong as never)).toBe("candidate.error.itemTooLong");
    });
  }

  it("limity Zod są równe obcięciom w RPC relacji kandydata (bez cichego left())", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase", "migrations", "0028_onboarding_relations.sql"),
      "utf8",
    );
    const body = (fn: string): string => {
      const start = sql.search(new RegExp(`function\\s+public\\.${fn}\\b`, "i"));
      expect(start, fn).toBeGreaterThan(-1);
      return sql.slice(start, sql.indexOf("$$;", start));
    };
    const cut = (b: string): number[] =>
      [...b.matchAll(/left\(btrim\([^)]*\),\s*(\d+)\)/g)].map((m) => Number(m[1]));

    expect(cut(body("set_candidate_skills"))).toContain(CANDIDATE_ITEM_LIMITS.skill);
    expect(cut(body("set_candidate_certificates"))).toContain(CANDIDATE_ITEM_LIMITS.certificate);

    // 0079 (#96) zastępuje set_candidate_certificates wersją jsonb z datą ważności — ten sam limit.
    const certs = readFileSync(
      join(process.cwd(), "supabase", "migrations", "0079_matching_certificates_distinct.sql"),
      "utf8",
    );
    const start = certs.search(/function\s+public\.set_candidate_certificates\(p_certificates jsonb\)/i);
    expect(start).toBeGreaterThan(-1);
    const latest = certs.slice(start, certs.indexOf("$$;", start));
    expect([...latest.matchAll(/left\(btrim\([\s\S]*?\),\s*(\d+)\)/g)].map((m) => Number(m[1]))).toContain(
      CANDIDATE_ITEM_LIMITS.certificate,
    );
  });
});
