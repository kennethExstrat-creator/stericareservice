import { describe, expect, it, vi } from "vitest";
import { TEST_ADMIN_ID, testTemplate } from "./__fixtures__/capture";
import {
  isInspectionId,
  loadCaptureInspection,
  loadOverrideAuthors,
  normaliseData,
  toCaptureLoad,
} from "./load";

const ID = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const INSPECTOR = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const LEAD = "1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    ref_no: "INS-2026-0007",
    status: "draft" as const,
    data: { modules: { glove_info: { colour: "Blue" } }, custom: {} },
    module_overrides: {
      weight: { reason: "Not ordered.", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" },
      nonsense: { reason: "x" },
    },
    updated_at: "2026-10-06T09:14:03.123456+00:00",
    inspection_date: "2026-10-06",
    inspector_id: INSPECTOR,
    submitted_at: null,
    result: null,
    template: { id: "t1", code: "TEST_EG", version: 4, standard: "EN455" as const, product_type: "examination" as const, resolved: testTemplate() },
    client: { id: "20000000-0000-4000-8000-0000000000c1", name: "Client A" },
    manufacturer: {
      id: "10000000-0000-4000-8000-0000000000f1",
      factory_name: "Factory 1",
      company: { name: "Company A", brand: { name: "Manufacturer A" } },
    },
    inspector: { id: INSPECTOR, full_name: null, email: "inspector@test.local", lead_id: LEAD },
    ...overrides,
  };
}

describe("toCaptureLoad", () => {
  it("reads the row into what the screen needs, the template parsed, valid overrides only", () => {
    const loaded = toCaptureLoad(row());
    expect(loaded.kind).toBe("found");
    if (loaded.kind !== "found") return;
    const { inspection } = loaded;
    expect(inspection).toMatchObject({
      id: ID,
      refNo: "INS-2026-0007",
      status: "draft",
      updatedAt: "2026-10-06T09:14:03.123456+00:00",
      inspectorId: INSPECTOR,
      // For the Report page's Download PDF: the export's rule lets the inspector's lead inspector export it.
      inspectorLeadId: LEAD,
      manufacturerLabel: "Manufacturer A · Factory 1",
      // The header line names no factory.
      manufacturerBrand: "Manufacturer A",
      // The standard and product type too: the Report page's preview builds an export from the screen's copy.
      template: { id: "t1", code: "TEST_EG", version: 4, standard: "EN455", productType: "examination" },
    });
    expect(Object.keys(inspection.overrides)).toEqual(["weight"]);
    expect(inspection.meta).toEqual({
      refNo: "INS-2026-0007",
      inspectionDate: "2026-10-06",
      // No name on the profile: the email.
      inspector: { id: INSPECTOR, name: "inspector@test.local" },
      client: { id: "20000000-0000-4000-8000-0000000000c1", name: "Client A" },
      // By its label, brand and factory, as everywhere: the header's Manufacturer / Supplier, the export and the report.
      manufacturer: { id: "10000000-0000-4000-8000-0000000000f1", name: "Manufacturer A · Factory 1" },
    });
  });

  it("names a factory without a name by its company, the brand left out where the company starts with it", () => {
    const named = (company: { name: string; brand: { name: string } }) => {
      const loaded = toCaptureLoad(row({ manufacturer: { id: "10000000-0000-4000-8000-0000000000f1", factory_name: null, company } }));
      return loaded.kind === "found" ? [loaded.inspection.meta.manufacturer?.name, loaded.inspection.manufacturerLabel] : [];
    };
    expect(named({ name: "Manufacturer A Sdn. Bhd.", brand: { name: "Manufacturer A" } })).toEqual([
      "Manufacturer A Sdn. Bhd.",
      "Manufacturer A Sdn. Bhd.",
    ]);
    expect(named({ name: "Company B", brand: { name: "Manufacturer B" } })).toEqual(["Manufacturer B · Company B", "Manufacturer B · Company B"]);
  });

  it("still records the inspector when their profile cannot be read, with no lead inspector", () => {
    const loaded = toCaptureLoad(row({ inspector: null, client: null, manufacturer: null }));
    expect(loaded.kind === "found" && loaded.inspection.meta).toMatchObject({
      inspector: { id: INSPECTOR, name: "Inspector" },
      client: null,
      manufacturer: null,
    });
    expect(loaded.kind === "found" && loaded.inspection.inspectorLeadId).toBeNull();
  });

  it("reads an inspector in no lead inspector's team as having none", () => {
    const loaded = toCaptureLoad(row({ inspector: { id: INSPECTOR, full_name: null, email: "inspector@test.local", lead_id: null } }));
    expect(loaded.kind === "found" && loaded.inspection.inspectorLeadId).toBeNull();
  });

  it("reads the template's AI setting through its schema, off when it says nothing", () => {
    const withAi = (ai: unknown) => row({ template: { id: "t1", code: "TEST_EG", version: 4, resolved: { ...testTemplate(), ai } } });
    const asked = toCaptureLoad(withAi({ reviewOnSubmit: true }));
    expect(asked.kind === "found" && asked.inspection.template.aiReviewOnSubmit).toBe(true);
    expect(asked.kind === "found" && asked.inspection.template.resolved.ai).toEqual({ reviewOnSubmit: true });
    const off = toCaptureLoad(withAi({ reviewOnSubmit: false }));
    expect(off.kind === "found" && off.inspection.template.aiReviewOnSubmit).toBe(false);
    const silent = toCaptureLoad(row());
    expect(silent.kind === "found" && silent.inspection.template.aiReviewOnSubmit).toBe(false);
    // A setting the schema refuses is an unreadable template like any other part, not a guess.
    expect(toCaptureLoad(withAi({ reviewOnSubmit: "yes" })).kind).toBe("template_unreadable");
  });

  it("says when the template version cannot be read, rather than guessing", () => {
    expect(toCaptureLoad(row({ template: { id: "t1", code: "X", version: 1, resolved: { modules: [] } } }))).toMatchObject({
      kind: "template_unreadable",
      refNo: "INS-2026-0007",
    });
    expect(toCaptureLoad(row({ template: null }))).toMatchObject({ kind: "template_unreadable", problem: expect.any(String) });
  });
});

describe("normaliseData", () => {
  it("keeps modules and custom modules, and reads anything malformed as empty", () => {
    expect(normaliseData({ modules: { a: {} }, custom: { b: {} } })).toEqual({ modules: { a: {} }, custom: { b: {} } });
    expect(normaliseData({ modules: [] })).toEqual({ modules: {}, custom: {} });
    expect(normaliseData(null)).toEqual({ modules: {}, custom: {} });
  });

  it("keeps the Report page's options as stored, so the screen's copy hashes as the saved one (Kenneth, 27 October 2026)", () => {
    const report = { pageSize: "letter", sections: { dimensions: { include: false } } };
    expect(normaliseData({ modules: {}, custom: {}, report })).toEqual({ modules: {}, custom: {}, report });
    // As stored, readable or not: they are read with their defaults where they are shown.
    expect(normaliseData({ modules: {}, custom: {}, report: "corrupt" })).toEqual({ modules: {}, custom: {}, report: "corrupt" });
    expect(normaliseData({ modules: {}, custom: {} })).not.toHaveProperty("report");
  });
});

describe("loading", () => {
  it("treats anything but a uuid as not found without asking the database", async () => {
    const from = vi.fn();
    expect(isInspectionId("INS-2026-0007")).toBe(false);
    await expect(loadCaptureInspection({ from } as never, "INS-2026-0007")).resolves.toEqual({ kind: "not_found" });
    expect(from).not.toHaveBeenCalled();
  });

  it("is not found when RLS returns no row, and throws on a database error", async () => {
    const client = (result: unknown) =>
      ({
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(result) }) }) }),
      }) as never;
    await expect(loadCaptureInspection(client({ data: null, error: null }), ID)).resolves.toEqual({ kind: "not_found" });
    await expect(loadCaptureInspection(client({ data: null, error: { message: "boom" } }), ID)).rejects.toThrow(/boom/);
    await expect(loadCaptureInspection(client({ data: row(), error: null }), ID)).resolves.toMatchObject({ kind: "found" });
  });

  it("reads the inspection's files into the context's meta when asked", async () => {
    const files = [
      { id: "f1", module_key: "tensile", kind: "lab_report" },
      { id: "f2", module_key: null, kind: "other" },
    ];
    const tables: string[] = [];
    const client = {
      from: (table: string) => {
        tables.push(table);
        return table === "inspection_files"
          ? { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: files, error: null }) }) }) }
          : { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: row(), error: null }) }) }) };
      },
    } as never;
    const loaded = await loadCaptureInspection(client, ID, { files: true });
    expect(loaded.kind === "found" && loaded.inspection.meta.files).toEqual([
      { id: "f1", moduleKey: "tensile", kind: "lab_report" },
      { id: "f2", moduleKey: null, kind: "other" },
    ]);
    const plain = await loadCaptureInspection(client, ID);
    expect(plain.kind === "found" && "files" in plain.inspection.meta).toBe(false);
    expect(tables).toEqual(["inspections", "inspection_files", "inspections"]);
  });

  it("names the admins who switched modules off, where the user may read them", async () => {
    const inProfiles = vi.fn(() =>
      Promise.resolve({ data: [{ id: TEST_ADMIN_ID, full_name: "Admin A", email: "admin@test.local" }], error: null }),
    );
    const client = { from: () => ({ select: () => ({ in: inProfiles }) }) } as never;
    const overrides = { weight: { reason: "n/a", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" } };
    await expect(loadOverrideAuthors(client, overrides)).resolves.toEqual({ [TEST_ADMIN_ID]: "Admin A" });
    await expect(loadOverrideAuthors(client, {})).resolves.toEqual({});
    expect(inProfiles).toHaveBeenCalledTimes(1);
  });
});
