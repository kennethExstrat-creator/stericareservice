import { describe, expect, it } from "vitest";
import {
  rankTemplates,
  selectTemplate,
  specificityOf,
  templateCandidateFromRow,
  type SelectionCriteria,
  type TemplateCandidate,
} from "./select";

const CLIENT = "20000000-0000-4000-8000-0000000000c1";
const FACTORY = "10000000-0000-4000-8000-0000000000f1";

let next = 0;
function candidate(overrides: Partial<TemplateCandidate>): TemplateCandidate {
  next += 1;
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, "0")}`,
    code: `T_${next}`,
    version: 1,
    status: "active",
    productType: "examination",
    standard: "EN455",
    clientId: null,
    manufacturerId: null,
    ...overrides,
  };
}

const standard = candidate({ code: "STD_EG", standard: "ASTM_D6319" });
const forClient = candidate({ code: "CLIENT_EG", clientId: CLIENT, standard: "ASTM_D6319" });
const forFactory = candidate({ code: "FACTORY_EG", manufacturerId: FACTORY });
const forBoth = candidate({ code: "CLIENT_FACTORY_EG", clientId: CLIENT, manufacturerId: FACTORY });
const surgical = candidate({ code: "STD_SG", productType: "surgical" });
const ALL = [forBoth, forClient, forFactory, standard, surgical];

const pick = (criteria: SelectionCriteria, candidates = ALL) => {
  const selection = selectTemplate(candidates, criteria);
  return selection.ok ? selection.template.code : selection.reason;
};

describe("selectTemplate: the standard template of the product type, for every client (BUILD_SPEC 4.4)", () => {
  // Kenneth, 26 October 2026: "all the inspection flow will be standardized".
  it("takes the standard template, whatever client- or manufacturer-scoped templates are active", () => {
    expect(pick({ productType: "examination" })).toBe("STD_EG");
    expect(pick({ productType: "surgical" })).toBe("STD_SG");
  });

  it("never applies a template scoped to a client, a manufacturer or both", () => {
    for (const scoped of [forClient, forFactory, forBoth]) {
      expect(specificityOf(scoped, { productType: "examination" }), scoped.code).toBeNull();
    }
    expect(specificityOf(standard, { productType: "examination" })).toBe("standard");
    expect(pick({ productType: "examination" }, [forClient, forFactory, forBoth])).toBe("none");
  });

  it("matches the product type", () => {
    expect(specificityOf(surgical, { productType: "examination" })).toBeNull();
  });

  it("ignores draft and retired versions", () => {
    const draft = { ...standard, id: "draft", status: "draft" as const };
    const retired = { ...standard, id: "retired", status: "retired" as const };
    expect(pick({ productType: "examination" }, [draft, retired])).toBe("none");
    expect(pick({ productType: "examination" }, [draft, retired, standard])).toBe("STD_EG");
  });

  it("says so when nothing applies", () => {
    const selection = selectTemplate([forClient], { productType: "surgical" });
    expect(selection).toEqual({ ok: false, reason: "none", message: expect.stringContaining("surgical") });
  });

  it("breaks a tie by code and reports the other standard templates", () => {
    const second = candidate({ code: "A_STD_EG" });
    const selection = selectTemplate([standard, second, forClient], { productType: "examination" });
    expect(selection).toMatchObject({ ok: true, specificity: "standard" });
    if (!selection.ok) throw new Error("expected a selection");
    expect(selection.template.code).toBe("A_STD_EG");
    expect(selection.ties.map((template) => template.code)).toEqual(["STD_EG"]);
  });

  it("ranks the standard templates that apply, by code", () => {
    const second = candidate({ code: "A_STD_EG" });
    const ranked = rankTemplates([...ALL, second], { productType: "examination" });
    expect(ranked.map((entry) => [entry.template.code, entry.specificity])).toEqual([
      ["A_STD_EG", "standard"],
      ["STD_EG", "standard"],
    ]);
  });
});

describe("selectTemplate: admin override", () => {
  it("takes the chosen template whatever its scope, draft included", () => {
    const draft = candidate({ code: "TRIAL_EG", status: "draft", productType: "surgical" });
    const selection = selectTemplate([...ALL, draft], { productType: "examination", overrideTemplateId: draft.id });
    expect(selection).toEqual({ ok: true, template: draft, specificity: "override", ties: [] });
    const scoped = selectTemplate(ALL, { productType: "examination", overrideTemplateId: forClient.id });
    expect(scoped).toEqual({ ok: true, template: forClient, specificity: "override", ties: [] });
  });

  it("refuses a retired version or an unknown id", () => {
    const retired = candidate({ code: "OLD_EG", status: "retired" });
    expect(selectTemplate([retired], { productType: "examination", overrideTemplateId: retired.id })).toMatchObject({
      ok: false,
      reason: "override_retired",
    });
    expect(selectTemplate(ALL, { productType: "examination", overrideTemplateId: "missing" })).toMatchObject({
      ok: false,
      reason: "override_not_found",
    });
  });
});

describe("templateCandidateFromRow", () => {
  it("maps a templates row", () => {
    expect(
      templateCandidateFromRow({
        id: forBoth.id,
        code: "CLIENT_FACTORY_EG",
        version: 3,
        status: "active",
        product_type: "examination",
        standard: "EN455",
        client_id: CLIENT,
        manufacturer_id: FACTORY,
      }),
    ).toEqual({ ...forBoth, version: 3 });
  });
});
