import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  JOB_ITEM_LIMITS,
  step1Schema,
  step5Schema,
  step6Schema,
  step7Schema,
  step8Schema,
  step9DraftSchema,
  step9Schema,
} from "@/lib/validation/job";

vi.mock("@/lib/db/portal", () => ({ isPortalDataConfigured: () => false }));

function firstMessage(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? null : result.error?.issues[0]?.message;
}

describe("kreator oferty: puste pole = „wymagane” (#367)", () => {
  it("pusty tytuł → titleRequired, 1–4 znaki → titleTooShort", () => {
    const base = { category: "warehouse", occupation: "Magazynier" };
    expect(firstMessage(step1Schema.safeParse({ ...base, title: "" }))).toBe(
      "job.error.titleRequired",
    );
    expect(firstMessage(step1Schema.safeParse({ ...base, title: "   " }))).toBe(
      "job.error.titleRequired",
    );
    expect(firstMessage(step1Schema.safeParse({ ...base, title: "Opr" }))).toBe(
      "job.error.titleTooShort",
    );
  });

  it("pusty opis stanowiska i opis firmy → komunikaty „wymagane”", () => {
    expect(
      firstMessage(step5Schema.safeParse({ description: "", responsibilities: ["a"] })),
    ).toBe("job.error.descriptionRequired");
    expect(
      firstMessage(step5Schema.safeParse({ description: "krótki", responsibilities: ["a"] })),
    ).toBe("job.error.descriptionTooShort");
    expect(firstMessage(step9DraftSchema.safeParse({ companyDescription: "" }))).toBe(
      "job.error.companyDescriptionRequired",
    );
    expect(firstMessage(step9DraftSchema.safeParse({ companyDescription: "Firma" }))).toBe(
      "job.error.companyDescriptionTooShort",
    );
  });
});

describe("kreator oferty: szkic kroku 9 bez zgody na publikację (#193)", () => {
  const step9 = {
    companyDescription: "Rodzinna firma logistyczna z Antwerpii.",
    contactEmail: "hr@example.be",
  };

  it("szkic przechodzi bez zgody i ze zgodą odznaczoną", () => {
    expect(step9DraftSchema.safeParse(step9).success).toBe(true);
    expect(step9DraftSchema.safeParse({ ...step9, agreePublish: false }).success).toBe(true);
  });

  it("publikacja nadal wymaga zgody i wskazuje pole agreePublish", () => {
    const result = step9Schema.safeParse({ ...step9, agreePublish: false });
    expect(result.success).toBe(false);
    expect(result.success ? null : result.error.issues[0]?.path).toEqual(["agreePublish"]);
    expect(firstMessage(result)).toBe("job.error.publishAgreementRequired");
    expect(step9Schema.safeParse({ ...step9, agreePublish: true }).success).toBe(true);
  });

  it("szkic nadal waliduje opis firmy i e-mail kontaktowy", () => {
    expect(step9DraftSchema.safeParse({ ...step9, contactEmail: "zly" }).success).toBe(false);
  });

  it("serwer zapisuje szkic kroku 9 bez zgody, a błędny opis odrzuca", async () => {
    const { updateJobDraft } = await import("@/lib/actions/jobs");
    await expect(updateJobDraft("demo-draft", 9, step9)).resolves.toEqual({
      ok: true,
      demo: true,
    });
    await expect(
      updateJobDraft("demo-draft", 9, { ...step9, companyDescription: "" }),
    ).resolves.toEqual({ ok: false, error: "VALIDATION_FAILED" });
  });
});

describe("kreator oferty: limity pozycji list (#364)", () => {
  const cases: [string, (item: string) => { success: boolean }, number][] = [
    [
      "obowiązek",
      (item) =>
        step5Schema.safeParse({ description: "x".repeat(40), responsibilities: [item] }),
      JOB_ITEM_LIMITS.line,
    ],
    [
      "wymaganie obowiązkowe",
      (item) => step6Schema.safeParse({ requirementsMandatory: [item] }),
      JOB_ITEM_LIMITS.requirement,
    ],
    [
      "umiejętność obowiązkowa",
      (item) => step6Schema.safeParse({ requirementsMandatory: ["a"], mandatorySkills: [item] }),
      JOB_ITEM_LIMITS.skill,
    ],
    ["umiejętność", (item) => step7Schema.safeParse({ skills: [item] }), JOB_ITEM_LIMITS.skill],
    [
      "certyfikat",
      (item) => step7Schema.safeParse({ requiredCertificates: [item] }),
      JOB_ITEM_LIMITS.certificate,
    ],
    ["benefit", (item) => step8Schema.safeParse({ benefits: [item] }), JOB_ITEM_LIMITS.line],
  ];

  for (const [name, parse, max] of cases) {
    it(`${name}: ${max} znaków przechodzi, ${max + 1} jest odrzucane`, () => {
      expect(parse("a".repeat(max)).success).toBe(true);
      const tooLong = parse("a".repeat(max + 1));
      expect(tooLong.success).toBe(false);
      expect(firstMessage(tooLong as never)).toBe("job.error.itemTooLong");
    });
  }

  it("limity Zod są równe obcięciom w RPC relacji oferty (bez cichego left())", () => {
    const dir = join(process.cwd(), "supabase", "migrations");
    const latestBody = (fn: string): string => {
      const files = readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort()
        .filter((f) =>
          new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\b`, "i").test(
            readFileSync(join(dir, f), "utf8"),
          ),
        );
      const last = files.at(-1);
      expect(last, fn).toBeDefined();
      const sql = readFileSync(join(dir, last!), "utf8");
      const start = sql.search(new RegExp(`function\\s+public\\.${fn}\\b`, "i"));
      return sql.slice(start, sql.indexOf("$$;", start));
    };
    const cut = (body: string): number[] =>
      [...body.matchAll(/left\(btrim\([^)]*\),\s*(\d+)\)/g)].map((m) => Number(m[1]));

    expect(cut(latestBody("set_job_requirements"))).toContain(JOB_ITEM_LIMITS.requirement);
    expect(cut(latestBody("set_job_skills"))).toContain(JOB_ITEM_LIMITS.skill);
    expect(cut(latestBody("set_job_certificates"))).toContain(JOB_ITEM_LIMITS.certificate);
  });
});
