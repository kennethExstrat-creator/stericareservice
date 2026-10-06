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
const OTHER_CLIENT = "20000000-0000-4000-8000-0000000000c2";
const FACTORY = "10000000-0000-4000-8000-0000000000f1";
const OTHER_FACTORY = "10000000-0000-4000-8000-0000000000f2";

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

const standard = candidate({ code: "STD_EG" });
const forClient = candidate({ code: "CLIENT_EG", clientId: CLIENT, standard: "ASTM_D6319" });
const forFactory = candidate({ code: "FACTORY_EG", manufacturerId: FACTORY });
const forBoth = candidate({ code: "CLIENT_FACTORY_EG", clientId: CLIENT, manufacturerId: FACTORY });
const surgical = candidate({ code: "STD_SG", productType: "surgical" });
const otherClient = candidate({ code: "OTHER_EG", clientId: OTHER_CLIENT });
const ALL = [standard, forClient, forFactory, forBoth, surgical, otherClient];

const pick = (criteria: SelectionCriteria, candidates = ALL) => {
  const selection = selectTemplate(candidates, criteria);
  return selection.ok ? selection.template.code : selection.reason;
};

describe("selectTemplate: the most specific active template wins (BUILD_SPEC 4.4)", () => {
  it("client and manufacturer, then client, then manufacturer, then the standard template", () => {
    const criteria = { productType: "examination" as const, clientId: CLIENT, manufacturerId: FACTORY };
    expect(pick(criteria)).toBe("CLIENT_FACTORY_EG");
    expect(pick(criteria, ALL.filter((t) => t !== forBoth))).toBe("CLIENT_EG");
    expect(pick(criteria, [standard, forFactory])).toBe("FACTORY_EG");
    expect(pick(criteria, [standard])).toBe("STD_EG");
  });

  it("never applies a template scoped to another client or manufacturer", () => {
    expect(pick({ productType: "examination", clientId: OTHER_CLIENT, manufacturerId: OTHER_FACTORY })).toBe("OTHER_EG");
    expect(pick({ productType: "examination", clientId: OTHER_CLIENT })).toBe("OTHER_EG");
    expect(pick({ productType: "examination", manufacturerId: OTHER_FACTORY })).toBe("STD_EG");
    expect(specificityOf(forBoth, { productType: "examination", clientId: CLIENT })).toBeNull();
  });

  it("matches the product type", () => {
    expect(pick({ productType: "surgical", clientId: CLIENT, manufacturerId: FACTORY })).toBe("STD_SG");
  });

  it("ignores draft and retired versions", () => {
    const draft = { ...forBoth, status: "draft" as const };
    const retired = { ...forClient, status: "retired" as const };
    expect(pick({ productType: "examination", clientId: CLIENT, manufacturerId: FACTORY }, [standard, draft, retired])).toBe(
      "STD_EG",
    );
  });

  it("says so when nothing applies", () => {
    const selection = selectTemplate([forClient], { productType: "surgical" });
    expect(selection).toEqual({ ok: false, reason: "none", message: expect.stringContaining("surgical") });
  });

  it("breaks a tie by code and reports the other templates", () => {
    const second = candidate({ code: "A_CLIENT_EG", clientId: CLIENT });
    const selection = selectTemplate([forClient, second], { productType: "examination", clientId: CLIENT });
    expect(selection).toMatchObject({ ok: true, specificity: "client" });
    if (!selection.ok) throw new Error("expected a selection");
    expect(selection.template.code).toBe("A_CLIENT_EG");
    expect(selection.ties.map((template) => template.code)).toEqual(["CLIENT_EG"]);
  });

  it("ranks every template that applies", () => {
    const ranked = rankTemplates(ALL, { productType: "examination", clientId: CLIENT, manufacturerId: FACTORY });
    expect(ranked.map((entry) => [entry.template.code, entry.specificity])).toEqual([
      ["CLIENT_FACTORY_EG", "client_manufacturer"],
      ["CLIENT_EG", "client"],
      ["FACTORY_EG", "manufacturer"],
      ["STD_EG", "standard"],
    ]);
  });
});

describe("selectTemplate: admin override", () => {
  it("takes the chosen template whatever its scope, draft included", () => {
    const draft = candidate({ code: "TRIAL_EG", status: "draft", productType: "surgical" });
    const selection = selectTemplate([...ALL, draft], { productType: "examination", overrideTemplateId: draft.id });
    expect(selection).toEqual({ ok: true, template: draft, specificity: "override", ties: [] });
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
