import { describe, expect, it } from "vitest";
import { z } from "zod";
import { moduleSpec, seedModuleConfigs, sourceFields, TEMPLATES, type TemplateCode } from "@/lib/coverage";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import type { JsonValue } from "@/lib/schemas/common";
import { MODULE_KEYS, type ModuleKey } from "@/lib/schemas/module-result";
import type { ResolvedTemplate, TemplateDefinition } from "@/lib/schemas/template";
import { lookupFrom, planTemplateEdit, resolveTemplateOrThrow, type TemplateBase, type TemplateStatus } from "@/lib/templates";
import { defineModule, stubModule, type ModuleRegistry } from "@/modules/_framework";
import {
  ABANDONED_UPLOAD_MS,
  activationBlockers,
  activationPlan,
  allSectionsTicked,
  baseVersionOf,
  changeAdvice,
  changesInPlace,
  configProblems,
  countOf,
  CoverageConfirmSchema,
  coverageBlocker,
  coverageChecklist,
  definitionForNewVersion,
  describeTemplateError,
  formatBytes,
  formatDate,
  formatDateTime,
  groupTemplates,
  inventoryOf,
  isSourceOf,
  newVersionRow,
  nextVersionOf,
  parseDefinition,
  parseResolution,
  parseSourceObjectName,
  safeFileName,
  scopeTies,
  sectionKeyOf,
  sectionViews,
  SOURCE_ACCEPT,
  SOURCE_MAX_BYTES,
  SOURCE_TYPE_PROBLEM,
  sourceChangeBlocker,
  sourceChangeBlockerOf,
  sourceFileName,
  sourceFileProblem,
  sourceFileType,
  sourceObjectName,
  staleBasesOf,
  templateEditPath,
  TemplateIdSchema,
  templatePath,
  toVersionSummary,
  unusedSources,
  usageText,
  versionOffers,
  VersionTargetSchema,
  withSourceFile,
  type CoverageChecklist,
  type CoverageRow,
  type TemplateVersionDetail,
  type VersionOfCode,
} from "./templates";

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const PER_SIZE: ReadonlySet<ModuleKey> = new Set([
  "sampling_plan",
  "carton_sampling",
  "dimensions",
  "weight",
  "force_at_break",
  "tensile",
  "watertight",
  "visual",
  "dispensing_packing",
  "dispensing_safedon",
  "labeling",
  "dye_leak",
]);

/** Every module a placeholder that takes any config, titled as the dictionary titles it. */
function stubRegistry(): ModuleRegistry {
  return Object.fromEntries(
    MODULE_KEYS.map((key) => [key, stubModule({ key, title: moduleSpec(key).title, perSize: PER_SIZE.has(key) })]),
  ) as unknown as ModuleRegistry;
}

/** The stub registry with a built header: its own labels and a strict settings schema. */
function registryWithBuiltHeader(): ModuleRegistry {
  const header = defineModule({
    key: "header",
    title: "Manufacturer Information",
    labels: { poNo: "PO / SO Number", client: "Client Name" },
    dataSchema: z.strictObject({ poNo: z.string().nullable() }),
    emptyData: () => ({ poNo: null }),
    configSchema: z.strictObject({ fields: z.record(z.string(), z.boolean()), mfgExpiryPrecision: z.enum(["day", "month"]) }),
    defaultConfig: { fields: {}, mfgExpiryPrecision: "day" as const },
    calc: () => ({ result: { status: "info", summary: "" }, computed: {}, issues: [] }),
  });
  return { ...stubRegistry(), header } as ModuleRegistry;
}

/** A seed template as lib/coverage writes it (BUILD_SPEC 11). */
function seedDefinition(code: TemplateCode): TemplateDefinition {
  const spec = TEMPLATES[code];
  return {
    code,
    name: spec.name,
    ...(spec.extends ? { extends: spec.extends } : {}),
    scope: { productType: spec.scope.productType, standard: spec.scope.standard },
    unit: spec.unit,
    sizes: spec.sizes.map((size) => ({ ...size })),
    modules: seedModuleConfigs(code).map((entry) => ({
      key: entry.key,
      include: entry.include,
      title: entry.title,
      ...(Object.keys(entry.labels).length > 0 ? { labels: entry.labels } : {}),
      config: entry.config as unknown as Record<string, JsonValue>,
    })),
    customModules: spec.customModules.map((custom) => ({
      key: custom.key,
      title: custom.title,
      after: custom.after,
      layout: custom.layout,
      fields: custom.fields.map((field) => ({ key: field.key, label: field.label, type: field.type })),
    })),
    report: { title: (spec.report.titleLines ?? [spec.name]).join(": "), showClientLogo: spec.report.showClientLogo },
  };
}

function resolve(definition: TemplateDefinition, bases: TemplateBase[] = [], registry = stubRegistry()): ResolvedTemplate {
  return resolveTemplateOrThrow(definition, { getBase: lookupFrom(bases), registry });
}

const stdEg = () => resolve(seedDefinition("STD_EG"));

/** STD_EG with a change to one module's entry in the definition. */
function stdEgWith(key: ModuleKey, change: (entry: TemplateDefinition["modules"][number]) => void): ResolvedTemplate {
  const definition = seedDefinition("STD_EG");
  const entry = definition.modules.find((candidate) => candidate.key === key);
  if (!entry) throw new Error(`STD_EG has no ${key}`);
  change(entry);
  return resolve(definition);
}

function rows(checklist: CoverageChecklist): CoverageRow[] {
  return checklist.documents.flatMap((document) => document.sections.flatMap((section) => section.rows));
}

function missingRows(checklist: CoverageChecklist): CoverageRow[] {
  return rows(checklist).filter((row) => !row.covered);
}

const CLIENT_ID = "20000000-0000-4000-8000-0000000000c1";
const MAKER_ID = "10000000-0000-4000-8000-0000000000f1";

function detail(overrides: Partial<TemplateVersionDetail> = {}): TemplateVersionDetail {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    code: "STD_EG",
    version: 2,
    status: "draft",
    name: "Standard examination gloves",
    extendsCode: null,
    productType: "examination",
    standard: "EN455",
    clientId: null,
    clientName: null,
    manufacturerId: null,
    manufacturerName: null,
    sourceFilePath: "STD_EG/v2/1b4e28ba-2fa1-4d2b-9f3a-1c2d3e4f5a6b/report.xlsx",
    coverageConfirmedAt: "2026-10-06T06:00:00+00:00",
    coverageConfirmedBy: "Test Admin",
    createdAt: "2026-10-06T05:00:00+00:00",
    updatedAt: "2026-10-06T06:00:00+00:00",
    usage: 0,
    definition: { ok: true, definition: seedDefinition("STD_EG") },
    resolution: { state: "ok", template: stdEg() },
    versions: [],
    activeTemplates: [],
    ...overrides,
  };
}

function version(overrides: Partial<VersionOfCode> & Pick<VersionOfCode, "id" | "version" | "status">): VersionOfCode {
  return { usage: 0, coverageConfirmedAt: null, resolvedFormat: 2, updatedAt: "2026-10-06T06:00:00+00:00", ...overrides };
}

/* ------------------------------------------------------------------ *
 * Words and paths
 * ------------------------------------------------------------------ */

describe("paths and words", () => {
  it("links a version and its editor", () => {
    expect(templatePath("abc")).toBe("/admin/templates/abc");
    expect(templateEditPath("abc")).toBe("/admin/templates/abc/edit");
  });

  it("counts inspections in words", () => {
    expect(usageText(0)).toBe("Not used yet");
    expect(usageText(1)).toBe("1 inspection");
    expect(usageText(1250)).toBe("1,250 inspections");
  });

  it("writes dates in Malaysia time, the same on every device", () => {
    // 20:30 UTC on 5 Oct is 04:30 on 6 Oct in Kuala Lumpur.
    expect(formatDate("2026-10-05T20:30:00Z")).toBe("6 Oct 2026");
    expect(formatDateTime("2026-10-05T20:30:00Z")).toBe("6 Oct 2026, 04:30");
    expect(formatDate("not a date")).toBe("not a date");
  });

  it("writes file sizes for people", () => {
    expect(formatBytes(210)).toBe("210 bytes");
    expect(formatBytes(48_000)).toBe("47 KB");
    expect(formatBytes(1.25 * 1024 * 1024)).toBe("1.3 MB");
    expect(formatBytes(23 * 1024 * 1024)).toBe("23 MB");
  });
});

/* ------------------------------------------------------------------ *
 * Source files
 * ------------------------------------------------------------------ */

describe("source files", () => {
  it("takes the bucket's types, and the type an extension stands for when the browser gives none", () => {
    expect(sourceFileType("report.pdf", "application/pdf")).toBe("application/pdf");
    expect(sourceFileType("Report.XLSX", "")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(sourceFileType("old.xls", "application/octet-stream")).toBe("application/vnd.ms-excel");
    expect(sourceFileType("form.doc", "")).toBe("application/msword");
    expect(sourceFileType("photo.HEIC", "")).toBe("image/heic");
    expect(sourceFileType("notes.txt", "text/plain")).toBeNull();
    expect(sourceFileType("drawing.svg", "image/svg+xml")).toBeNull();
    expect(sourceFileType("no-extension", "")).toBeNull();
  });

  it("offers every type and extension to the picker", () => {
    for (const part of ["application/pdf", ".xlsx", ".xls", ".docx", ".doc", ".jpg", ".heic"]) {
      expect(SOURCE_ACCEPT.split(",")).toContain(part);
    }
  });

  it("says why a file cannot be stored", () => {
    expect(sourceFileProblem({ name: "a.txt", type: "text/plain", size: 10 })).toBe(SOURCE_TYPE_PROBLEM);
    expect(sourceFileProblem({ name: "a.pdf", type: "application/pdf", size: 0 })).toMatch(/empty/);
    expect(sourceFileProblem({ name: "a.pdf", type: "application/pdf", size: SOURCE_MAX_BYTES + 1 })).toBe(
      "That file is 50 MB. Choose one up to 50 MB.",
    );
    expect(sourceFileProblem({ name: "a.pdf", type: "application/pdf", size: SOURCE_MAX_BYTES })).toBeNull();
  });

  it("makes file names safe for a storage path, keeping them readable", () => {
    expect(safeFileName("STD EG report (2026).xlsx")).toBe("STD-EG-report-2026.xlsx");
    expect(safeFileName("Rapport qualité.PDF")).toBe("Rapport-qualite.pdf");
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\forms\\SG form.docx")).toBe("SG-form.docx");
    expect(safeFileName("..")).toBe("source");
    expect(safeFileName(".hidden")).toBe("hidden");
    expect(safeFileName("表格.xlsx")).toBe("source.xlsx");
    expect(safeFileName(`${"a".repeat(200)}.pdf`)).toBe(`${"a".repeat(80)}.pdf`);
  });

  it("names each upload in its own folder of the version, and reads the name back", () => {
    const id = "1B4E28BA-2FA1-4D2B-9F3A-1C2D3E4F5A6B";
    const path = sourceObjectName({ code: "STD_EG", version: 3 }, "EG form.pdf", id);
    expect(path).toBe("STD_EG/v3/1b4e28ba-2fa1-4d2b-9f3a-1c2d3e4f5a6b/EG-form.pdf");
    expect(parseSourceObjectName(path)).toEqual({
      code: "STD_EG",
      version: 3,
      fileId: "1b4e28ba-2fa1-4d2b-9f3a-1c2d3e4f5a6b",
      fileName: "EG-form.pdf",
    });
    expect(isSourceOf(path, { code: "STD_EG", version: 3 })).toBe(true);
    expect(isSourceOf(path, { code: "STD_EG", version: 2 })).toBe(false);
    expect(isSourceOf(path, { code: "SAFEDON_EG", version: 3 })).toBe(false);
    expect(sourceFileName(path)).toBe("EG-form.pdf");
    // A fresh folder each time.
    expect(sourceObjectName({ code: "STD_EG", version: 3 }, "a.pdf")).not.toBe(
      sourceObjectName({ code: "STD_EG", version: 3 }, "a.pdf"),
    );
  });

  it("refuses any other name: no other folder, no traversal", () => {
    for (const path of [
      "STD_EG/v3/report.pdf",
      "STD_EG/v3/1b4e28ba-2fa1-4d2b-9f3a-1c2d3e4f5a6b/../x.pdf",
      "STD_EG/v3/1b4e28ba-2fa1-4d2b-9f3a-1c2d3e4f5a6b/..",
      "STD_EG/v0/1b4e28ba-2fa1-4d2b-9f3a-1c2d3e4f5a6b/a.pdf",
      "std_eg/v3/1b4e28ba-2fa1-4d2b-9f3a-1c2d3e4f5a6b/a.pdf",
      "STD_EG/v3/1b4e28ba-2fa1-4d2b-9f3a-1c2d3e4f5a6b/a b.pdf",
      "STD_EG/v3/1b4e28ba-2fa1-4d2b-9f3a-1c2d3e4f5a6b/sub/a.pdf",
    ]) {
      expect(parseSourceObjectName(path), path).toBeNull();
    }
  });

  it("names a file kept under an older name by its last part", () => {
    expect(sourceFileName("BASE_EG/v1/report.xlsx")).toBe("report.xlsx");
  });

  it("lets only a draft no inspection uses change its file", () => {
    const row = { version: 2, hasFile: true };
    expect(sourceChangeBlocker({ ...row, status: "draft", usage: 0 })).toBeNull();
    expect(sourceChangeBlocker({ ...row, hasFile: false, status: "draft", usage: 0 })).toBeNull();
    expect(sourceChangeBlocker({ ...row, status: "active", usage: 0 })).toBe(
      "Version 2 is active, so its source file stays as it was checked. Make a new version to attach a different form.",
    );
    expect(sourceChangeBlocker({ ...row, status: "retired", usage: 0 })).toMatch(/^Version 2 is retired, so its source file/);
    expect(sourceChangeBlocker({ ...row, status: "active", usage: 4 })).toBe(
      "Version 2 is used by inspections, so its source file stays as it is. Make a new version to attach a different form.",
    );
    // A draft an admin already started an inspection from is frozen like any other version in use.
    expect(sourceChangeBlocker({ ...row, status: "draft", usage: 1 })).toBe(
      "Version 2 is used by inspections, so its source file stays as it is. Make a new version to attach a different form.",
    );
    expect(sourceChangeBlocker({ ...row, hasFile: false, status: "draft", usage: 2 })).toBe(
      "Version 2 is used by inspections, so it can no longer change. Make a new version and upload the form to it.",
    );
  });

  it("sends a version that never had a file (one added outside the app) to a new version for it", () => {
    expect(sourceChangeBlocker({ version: 1, hasFile: false, status: "active", usage: 0 })).toBe(
      "Version 1 is active, and only a draft takes a source file. Make a new version and upload the form to it.",
    );
    expect(sourceChangeBlocker({ version: 1, hasFile: false, status: "active", usage: 3 })).toBe(
      "Version 1 is used by inspections, so it can no longer change. Make a new version and upload the form to it.",
    );
    expect(sourceChangeBlockerOf({ version: 1, status: "retired", usage: 0, source_file_path: null })).toMatch(
      /only a draft takes a source file/,
    );
    expect(sourceChangeBlockerOf({ version: 1, status: "draft", usage: 0, source_file_path: "A/v1/x/a.pdf" })).toBeNull();
  });

  it("names the file in the definition and the resolved template alike", () => {
    expect(withSourceFile({ code: "STD_EG", sourceFile: "old" }, "new")).toEqual({ code: "STD_EG", sourceFile: "new" });
    expect(withSourceFile(null, "new")).toBeNull();
    expect(withSourceFile([1, 2], "new")).toEqual([1, 2]);
  });

  it("lets go of the replaced file at once and of abandoned uploads after an hour, never of a file in use", () => {
    const now = Date.parse("2026-10-06T12:00:00Z");
    const recent = now - 5 * 60 * 1000;
    const old = now - ABANDONED_UPLOAD_MS - 1;
    const candidates = [
      { path: "A/v1/x/keep.pdf", createdAt: old },
      { path: "A/v1/x/previous.pdf", createdAt: recent },
      { path: "A/v1/x/young.pdf", createdAt: recent },
      { path: "A/v1/x/abandoned.pdf", createdAt: old },
      { path: "A/v1/x/copied.pdf", createdAt: old },
      { path: "A/v1/x/undated.pdf", createdAt: null },
    ];
    expect(
      unusedSources(candidates, {
        keep: "A/v1/x/keep.pdf",
        previous: "A/v1/x/previous.pdf",
        inUse: new Set(["A/v1/x/copied.pdf"]),
        now,
      }),
    ).toEqual(["A/v1/x/previous.pdf", "A/v1/x/abandoned.pdf"]);
  });
});

/* ------------------------------------------------------------------ *
 * Input and errors
 * ------------------------------------------------------------------ */

describe("action input", () => {
  it("lower-cases the template id and needs the version the page saw", () => {
    expect(
      VersionTargetSchema.parse({ templateId: "1B4E28BA-2FA1-4D2B-9F3A-1C2D3E4F5A6B", seen: "2026-10-06T06:00:00+00:00" }),
    ).toEqual({ templateId: "1b4e28ba-2fa1-4d2b-9f3a-1c2d3e4f5a6b", seen: "2026-10-06T06:00:00+00:00" });
    expect(VersionTargetSchema.safeParse({ templateId: "nope", seen: "x" }).success).toBe(false);
    expect(VersionTargetSchema.safeParse({ templateId: "1b4e28ba-2fa1-4d2b-9f3a-1c2d3e4f5a6b", seen: "" }).success).toBe(false);
  });

  it("takes any id Postgres takes, not only RFC 4122 ones (a seed script's fixed ids)", () => {
    expect(TemplateIdSchema.parse("30000000-0000-0000-0000-000000000001")).toBe("30000000-0000-0000-0000-000000000001");
    expect(TemplateIdSchema.parse("ABCDEF00-0000-0000-0000-00000000000A")).toBe("abcdef00-0000-0000-0000-00000000000a");
    for (const id of ["not-an-id", "30000000-0000-0000-0000-00000000001", "30000000000000000000000000000001"]) {
      expect(TemplateIdSchema.safeParse(id).success, id).toBe(false);
    }
  });

  it("needs the last tick to confirm coverage", () => {
    const base = { templateId: "1b4e28ba-2fa1-4d2b-9f3a-1c2d3e4f5a6b", seen: "t", sections: ["a"] };
    expect(CoverageConfirmSchema.safeParse({ ...base, attested: "yes" }).success).toBe(true);
    const refused = CoverageConfirmSchema.safeParse({ ...base, attested: null });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0].message).toMatch(/Tick the last box/);
  });
});

describe("describeTemplateError", () => {
  const template = { code: "STD_EG", version: 2 };

  it("explains the frozen version the database refuses to change", () => {
    const message = describeTemplateError(
      { code: "42501", message: "template STD_EG version 2 is in use: create a new version instead" },
      template,
    );
    expect(message).toMatch(/^STD_EG version 2 is used by inspections, so it can no longer change/);
    expect(message).toMatch(/BUILD_SPEC 4\.2 rule 8/);
    expect(message).toMatch(/Make a new version/);
  });

  it("says plainly what else went wrong", () => {
    expect(describeTemplateError({ code: "42501", message: "permission denied" })).toMatch(/Only active admins/);
    expect(
      describeTemplateError({ code: "23505", message: 'duplicate key value violates unique constraint "templates_one_active_version"' }, template),
    ).toMatch(/Another version of STD_EG became active/);
    expect(describeTemplateError({ code: "23505", message: "templates_code_version_key" }, template)).toMatch(
      /made a new version of STD_EG at the same moment/,
    );
    expect(describeTemplateError({ code: "23514", message: "check failed" })).toBe("The database refused the change: check failed.");
    expect(describeTemplateError({ code: "XX000", message: "boom" })).toMatch(/Something went wrong/);
    expect(describeTemplateError(null)).toMatch(/Something went wrong/);
  });
});

/* ------------------------------------------------------------------ *
 * The list
 * ------------------------------------------------------------------ */

describe("the list", () => {
  const row = (overrides: Record<string, unknown>) =>
    toVersionSummary({
      id: "id",
      code: "STD_EG",
      version: 1,
      status: "retired",
      extends_code: null,
      product_type: "examination",
      standard: "EN455",
      client_id: null,
      manufacturer_id: null,
      source_file_path: null,
      coverage_confirmed_at: null,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
      name: "Standard examination gloves",
      clients: null,
      manufacturers: null,
      inspections: [{ count: 0 }],
      ...overrides,
    } as Parameters<typeof toVersionSummary>[0]);

  it("reads a row: names of client and manufacturer, use, file", () => {
    const summary = row({
      client_id: CLIENT_ID,
      clients: { name: "Client A" },
      manufacturer_id: MAKER_ID,
      manufacturers: { name: "Terang Nusa Sdn. Bhd.", factory_name: "TG Factory 40" },
      inspections: [{ count: 12 }],
      source_file_path: "STD_EG/v1/1b4e28ba-2fa1-4d2b-9f3a-1c2d3e4f5a6b/report.xlsx",
      coverage_confirmed_at: "2026-10-01T00:00:00Z",
    });
    expect(summary).toMatchObject({
      clientName: "Client A",
      manufacturerName: "Terang Nusa Sdn. Bhd. · TG Factory 40",
      usage: 12,
      sourceFileName: "report.xlsx",
      coverageConfirmed: true,
    });
    // A definition without a name (an old or broken row) still lists.
    expect(row({ name: null }).name).toBeNull();
    expect(row({ name: "  " }).name).toBeNull();
  });

  it("groups by code in order, newest version first, named after the active version", () => {
    const groups = groupTemplates([
      row({ id: "s1", code: "SAFEDON_EG", version: 1, status: "draft", name: "Safedon" }),
      row({ id: "e1", code: "STD_EG", version: 1, status: "retired", name: "Old name" }),
      row({ id: "e3", code: "STD_EG", version: 3, status: "draft", name: "Newest name" }),
      row({ id: "e2", code: "STD_EG", version: 2, status: "active", name: "Active name" }),
    ]);
    expect(groups.map((group) => group.code)).toEqual(["SAFEDON_EG", "STD_EG"]);
    const std = groups[1];
    expect(std.versions.map((entry) => entry.version)).toEqual([3, 2, 1]);
    expect(std.active?.id).toBe("e2");
    expect(std.name).toBe("Active name");
    expect(groups[0].active).toBeNull();
    expect(groups[0].name).toBe("Safedon");
  });

  it("reads embedded counts however PostgREST gives them", () => {
    expect(countOf([{ count: 3 }])).toBe(3);
    expect(countOf({ count: 2 })).toBe(2);
    expect(countOf([])).toBe(0);
    expect(countOf(null)).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * One version
 * ------------------------------------------------------------------ */

describe("reading a stored version", () => {
  it("parses the definition, or lists its problems", () => {
    expect(parseDefinition(seedDefinition("STD_EG")).ok).toBe(true);
    const broken = parseDefinition({ code: "E2E_LIST", name: "Fixture", modules: [] });
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.issues.length).toBeGreaterThan(0);
  });

  it("tells a version that has not resolved from one an older build resolved", () => {
    expect(parseResolution(null)).toEqual({ state: "missing" });
    expect(parseResolution({ ...stdEg(), format: 1 }).state).toBe("invalid");
    expect(parseResolution(stdEg()).state).toBe("ok");
  });
});

describe("warnings about a version", () => {
  it("names bases whose active version moved on", () => {
    const child = resolve(
      { ...seedDefinition("STD_EG"), code: "CLIENT_EG", extends: "STD_EG" },
      [{ definition: seedDefinition("STD_EG"), version: 1 }],
    );
    const active = (code: string, versionNumber: number) => ({
      id: code,
      code,
      version: versionNumber,
      productType: "examination" as const,
      standard: "EN455" as const,
      clientId: null,
      manufacturerId: null,
    });
    expect(staleBasesOf({ resolution: { state: "ok", template: child }, activeTemplates: [active("STD_EG", 1)] })).toEqual([]);
    expect(staleBasesOf({ resolution: { state: "ok", template: child }, activeTemplates: [active("STD_EG", 2)] })).toEqual([
      { code: "STD_EG", resolvedWith: 1, active: 2 },
    ]);
    expect(staleBasesOf({ resolution: { state: "ok", template: child }, activeTemplates: [] })).toEqual([
      { code: "STD_EG", resolvedWith: 1, active: null },
    ]);
    expect(staleBasesOf({ resolution: { state: "missing" }, activeTemplates: [] })).toEqual([]);
  });

  it("names other codes active for exactly the same scope", () => {
    const active = (code: string, clientId: string | null, productType: "examination" | "surgical" = "examination") => ({
      id: code,
      code,
      version: 1,
      productType,
      standard: "EN455" as const,
      clientId,
      manufacturerId: null,
    });
    const ties = scopeTies({
      code: "CLIENT_B",
      productType: "examination",
      clientId: CLIENT_ID,
      manufacturerId: null,
      activeTemplates: [
        active("CLIENT_B", CLIENT_ID),
        active("CLIENT_C", CLIENT_ID),
        active("CLIENT_A", CLIENT_ID),
        active("STD_EG", null),
        active("STD_SG", CLIENT_ID, "surgical"),
      ],
    });
    expect(ties.map((tie) => tie.code)).toEqual(["CLIENT_A", "CLIENT_C"]);
  });

  it("finds stored settings a built module no longer accepts, and leaves stubs alone", () => {
    const registry = registryWithBuiltHeader();
    const fits = resolve(
      {
        ...seedDefinition("STD_EG"),
        modules: [{ key: "header", include: true, config: { fields: { client: true }, mfgExpiryPrecision: "day" } }],
      },
      [],
      registry,
    );
    expect(configProblems(fits, registry)).toEqual([]);

    // Saved when the header was a stub: a key its schema now refuses.
    const saved = resolve(
      { ...seedDefinition("STD_EG"), modules: [{ key: "header", include: true, config: { fields: {}, legacy: 1 } }] },
      [],
      stubRegistry(),
    );
    const problems = configProblems(saved, registry);
    expect(problems.map((problem) => problem.key)).toEqual(["header"]);
    expect(problems[0].messages.join(" ")).toMatch(/legacy|mfgExpiryPrecision/);
  });
});

describe("activation", () => {
  it("needs a resolution, settings that fit, the source file and the coverage checklist", () => {
    expect(activationBlockers(detail(), [])).toEqual([]);
    expect(activationBlockers(detail({ status: "active", coverageConfirmedAt: null }), [])).toEqual([]);
    expect(activationBlockers(detail({ resolution: { state: "missing" } }), [])[0]).toMatch(/has not resolved/);
    expect(activationBlockers(detail({ resolution: { state: "invalid", issues: [] } }), [])[0]).toMatch(/earlier build/);
    expect(activationBlockers(detail(), [{ key: "header", title: "Manufacturer Information", messages: ["x"] }])[0]).toMatch(
      /Settings of Manufacturer Information no longer fit the module\./,
    );
    expect(activationBlockers(detail({ sourceFilePath: null, coverageConfirmedAt: null }), [])).toEqual([
      "Upload the source form or report first (BUILD_SPEC 4.2 rule 10).",
      "Confirm the coverage checklist first (BUILD_SPEC 4.2 rule 10).",
    ]);
    expect(activationBlockers(detail({ coverageConfirmedAt: null }), [])).toEqual([
      "Confirm the coverage checklist first (BUILD_SPEC 4.2 rule 10).",
    ]);
  });

  it("sends a retired version without a source file to a new version, which can take one", () => {
    expect(activationBlockers(detail({ status: "retired", sourceFilePath: null, coverageConfirmedAt: null }), [])).toEqual([
      "Version 2 has no source file, and only a draft takes one: make a new version, upload the form to it and confirm its checklist (BUILD_SPEC 4.2 rule 10).",
    ]);
    // A retired version with its file and checklist goes back to active as it was.
    expect(activationBlockers(detail({ status: "retired" }), [])).toEqual([]);
  });

  it("sends a draft an inspection already uses, with no source file, to a new version too", () => {
    const used = detail({ status: "draft", usage: 2, sourceFilePath: null, coverageConfirmedAt: null });
    // Not "upload the source form first": a version in use can no longer take one (sourceChangeBlocker).
    expect(sourceChangeBlocker({ ...used, hasFile: false })).not.toBeNull();
    expect(activationBlockers(used, [])).toEqual([
      "Version 2 has no source file, and it is used by inspections, so it can no longer take one: make a new version, upload the form to it and confirm its checklist (BUILD_SPEC 4.2 rule 10).",
    ]);
    // With its file and a confirmed checklist it can still be activated as it is: a status change, not an edit.
    expect(activationBlockers(detail({ status: "draft", usage: 2 }), [])).toEqual([]);
  });

  it("says how to fix a version in the words of what its page offers", () => {
    const problem = [{ key: "header" as const, title: "Manufacturer Information", messages: ["x"] }];
    // A draft no inspection uses is fixed in the editor.
    expect(activationBlockers(detail({ resolution: { state: "missing" } }), [])[0]).toBe(
      "Version 2 has not resolved. Open it in the editor and save it without problems.",
    );
    expect(activationBlockers(detail(), problem)[0]).toBe(
      "Settings of Manufacturer Information no longer fit the module. Fix them in the editor.",
    );
    // Any other version through a new version.
    for (const frozen of [{ status: "draft" as const, usage: 1 }, { status: "retired" as const, usage: 0 }]) {
      expect(activationBlockers(detail({ ...frozen, resolution: { state: "missing" } }), [])[0]).toBe(
        "Version 2 has not resolved. Make a new version and fix it in the editor.",
      );
      expect(activationBlockers(detail({ ...frozen, resolution: { state: "invalid", issues: [] } }), [])[0]).toMatch(
        /earlier build of the app and cannot be read now\. Make a new version: it resolves again\.$/,
      );
      expect(activationBlockers(detail(frozen), problem)[0]).toBe(
        "Settings of Manufacturer Information no longer fit the module. Make a new version and fix them in the editor.",
      );
    }
  });

  it("retires the active version of the code first", () => {
    const versions = [
      version({ id: "v3", version: 3, status: "draft", coverageConfirmedAt: "2026-10-06T00:00:00Z" }),
      version({ id: "v2", version: 2, status: "active", coverageConfirmedAt: "2026-10-01T00:00:00Z" }),
      version({ id: "v1", version: 1, status: "retired", coverageConfirmedAt: "2026-09-01T00:00:00Z" }),
    ];
    expect(activationPlan(versions, "v3")).toEqual({ ok: true, retire: ["v2"], activate: "v3" });
    expect(activationPlan(versions, "v1")).toEqual({ ok: true, retire: ["v2"], activate: "v1" });
    const unconfirmed = activationPlan([version({ id: "v4", version: 4, status: "draft" })], "v4");
    expect(unconfirmed.ok).toBe(false);
    const unresolved = activationPlan(
      [version({ id: "v4", version: 4, status: "draft", resolvedFormat: null, coverageConfirmedAt: "x" })],
      "v4",
    );
    expect(unresolved.ok).toBe(false);
  });
});

describe("what a version can still do", () => {
  const states: { status: TemplateStatus; usage: number }[] = [
    { status: "draft", usage: 0 },
    { status: "draft", usage: 3 },
    { status: "active", usage: 0 },
    { status: "active", usage: 3 },
    { status: "retired", usage: 0 },
    { status: "retired", usage: 3 },
  ];

  it("changes only a draft no inspection uses in place, as the editor decides (planTemplateEdit)", () => {
    for (const state of states) {
      const plan = planTemplateEdit({ id: "v", status: state.status, inUse: state.usage > 0 }, [1]);
      expect(changesInPlace(state), JSON.stringify(state)).toBe(plan.kind === "update");
      // The source file follows the same rule.
      expect(sourceChangeBlocker({ ...state, version: 1, hasFile: true }) === null, JSON.stringify(state)).toBe(
        changesInPlace(state),
      );
    }
  });

  it("offers Edit draft for a draft no inspection uses and New version for every other version", () => {
    expect(versionOffers({ status: "draft", usage: 0 })).toEqual({ edit: true, newVersion: false, activate: true, retire: false });
    // A draft an admin started an inspection from: frozen, so a new version is the way forward.
    expect(versionOffers({ status: "draft", usage: 2 })).toEqual({ edit: false, newVersion: true, activate: true, retire: false });
    expect(versionOffers({ status: "active", usage: 0 })).toEqual({ edit: false, newVersion: true, activate: false, retire: true });
    expect(versionOffers({ status: "retired", usage: 5 })).toEqual({ edit: false, newVersion: true, activate: true, retire: false });
    // Always a way to change it, never both.
    for (const state of states) {
      const offers = versionOffers(state);
      expect(offers.edit !== offers.newVersion, JSON.stringify(state)).toBe(true);
      expect(offers.activate !== offers.retire, JSON.stringify(state)).toBe(true);
    }
  });

  it("words its advice after the action offered", () => {
    expect(changeAdvice({ status: "draft", usage: 0 }).unresolved).toMatch(/^Open it in the editor/);
    expect(changeAdvice({ status: "draft", usage: 1 }).unresolved).toMatch(/^Make a new version/);
    expect(changeAdvice({ status: "active", usage: 0 }).settings).toMatch(/^Make a new version/);
  });
});

/* ------------------------------------------------------------------ *
 * Modules as shown
 * ------------------------------------------------------------------ */

describe("sectionViews", () => {
  const definition: TemplateDefinition = {
    code: "CLIENT_EG",
    name: "Client gloves",
    scope: { productType: "examination", standard: "custom" },
    unit: "pcs",
    sizes: [{ value: "M" }],
    modules: [
      {
        key: "header",
        include: true,
        labels: { poNo: "PO Number", productName: "Product" },
        config: { fields: { client: false, factoryGloveCode: false }, mfgExpiryPrecision: "day" },
      },
      { key: "glove_info", include: false },
      { key: "order_lots", include: true },
      { key: "packing_config", include: false },
      { key: "sampling_plan", include: true, config: { columns: { pouches: false, cases: true } } },
      { key: "dimensions", include: true, title: "Dimensions", config: { measures: ["length", "width"] } },
      { key: "conclusion", include: true },
    ],
    customModules: [
      {
        key: "glove_type",
        title: "Glove Type",
        after: "header",
        layout: "fields",
        fields: [{ key: "gloveType", label: "Glove Type", type: "text" }],
      },
      {
        key: "packing_notes",
        title: "Packing notes",
        after: "packing_config",
        layout: "fields",
        fields: [{ key: "note", label: "Note", type: "textarea", required: true }],
      },
    ],
  };

  it("lists every module in order, switched off ones too, each custom module after its module", () => {
    const resolved = resolve(definition, [], registryWithBuiltHeader());
    const views = sectionViews(resolved, registryWithBuiltHeader());
    expect(views.map((view) => `${view.kind}:${view.key}`)).toEqual([
      "module:header",
      "custom:glove_type",
      "module:glove_info",
      "module:order_lots",
      // A custom module stays in place when the module it follows is off, as on the capture screen.
      "module:packing_config",
      "custom:packing_notes",
      "module:sampling_plan",
      "module:dimensions",
      "module:conclusion",
    ]);

    // One whose module is missing altogether goes last.
    const orphaned = { ...resolved, customModules: [{ ...resolved.customModules[1], after: "loading" as const }] };
    expect(sectionViews(orphaned, registryWithBuiltHeader()).at(-1)).toMatchObject({ kind: "custom", key: "packing_notes" });
  });

  it("shows include state, wording, what the module calls itself and fields switched off", () => {
    const registry = registryWithBuiltHeader();
    const views = sectionViews(resolve(definition, [], registry), registry);
    const view = (key: string) => views.find((entry) => entry.key === key)!;

    const header = view("header");
    if (header.kind !== "module") throw new Error("header");
    expect(header).toMatchObject({ position: 1, include: true, alwaysOn: true, notBuilt: false, defaultTitle: null });
    // PO Number is the template's wording; Client Name is the built module's own.
    expect(header.labels).toEqual([
      { key: "client", label: "Client Name", changed: false },
      { key: "poNo", label: "PO Number", changed: true },
      { key: "productName", label: "Product", changed: true },
    ]);
    expect(header.fieldsOff).toEqual(["Client Name", "Factory Glove Code"]);

    const glove = view("glove_info");
    expect(glove).toMatchObject({ include: false, alwaysOn: false, notBuilt: true });
    const sampling = view("sampling_plan");
    if (sampling.kind !== "module") throw new Error("sampling_plan");
    expect(sampling.fieldsOff).toEqual(["Pouches"]);
    const dimensions = view("dimensions");
    if (dimensions.kind !== "module") throw new Error("dimensions");
    expect(dimensions.title).toBe("Dimensions");
    expect(dimensions.defaultTitle).toBe(moduleSpec("dimensions").title);
    expect(dimensions.fieldsOff).toEqual(["Finger Thickness", "Palm Thickness", "Cuff Thickness"]);

    const notes = view("packing_notes");
    if (notes.kind !== "custom") throw new Error("packing_notes");
    expect(notes.afterTitle).toBe(moduleSpec("packing_config").title);
    expect(notes.fields).toEqual([
      { key: "note", label: "Note", type: "textarea", unit: null, required: true, options: [], mapsTo: null },
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * Coverage checklist
 * ------------------------------------------------------------------ */

describe("coverage checklist", () => {
  it("lists a seed template's own forms field by field, every field kept (BUILD_SPEC 4.2 rule 2)", () => {
    const checklist = coverageChecklist(stdEg());
    expect(checklist.mode).toBe("own");
    expect(checklist.inventoryCode).toBe("STD_EG");
    expect(checklist.documents.map((document) => document.id)).toEqual(["report_STD_EG", "onsite_EG"]);
    expect(checklist.fields).toBe(sourceFields("report_STD_EG").length + sourceFields("onsite_EG").length);
    expect(missingRows(checklist).map((row) => `${row.id}: ${row.targets.map((target) => target.reason).join(" ")}`)).toEqual(
      [],
    );
    expect(checklist.blocking).toBe(false);
    // One tick per section, every section once.
    expect(new Set(checklist.sectionKeys).size).toBe(checklist.sectionKeys.length);
    expect(checklist.documents.flatMap((document) => document.sections.map((section) => section.key))).toEqual(
      checklist.sectionKeys,
    );
  });

  it("keeps every field of the other seed templates' forms too", () => {
    const safedon = resolve(seedDefinition("SAFEDON_EG"), [{ definition: seedDefinition("STD_EG"), version: 1 }]);
    const sg = resolve(seedDefinition("STD_SG"));
    for (const template of [safedon, sg]) {
      const checklist = coverageChecklist(template);
      expect(checklist.mode).toBe("own");
      expect(missingRows(checklist).map((row) => row.id)).toEqual([]);
    }
  });

  it("words each field as this version does, and as the source prints it", () => {
    const checklist = coverageChecklist(stdEgWith("header", (entry) => (entry.labels = { poNo: "PO Number" })));
    const po = rows(checklist).find((row) => row.label === "PO / SO Number")!;
    expect(po.input).toBe("Text");
    expect(po.targets).toEqual([{ place: "Manufacturer Information", text: "PO Number", covered: true, reason: null }]);
    // A typo on the source keeps its printed label; the app's wording sits beside it.
    const glove = rows(checklist).find((row) => row.label === "Factrory glove code")!;
    expect(glove.corrected).toBe("Factory Glove Code");
  });

  it("names the places it points to as the template editor does, in Title Case (docs/DESIGN.md, Capitalisation)", () => {
    const template = stdEg();
    const checklist = coverageChecklist(template);
    const targets = rows(checklist).flatMap((row) => row.targets);
    const titleOf = (key: ModuleKey) => template.modules.find((entry) => entry.key === key)!.title;
    const has = (place: string | null, text: string | RegExp) =>
      targets.some((target) => target.place === place && (typeof text === "string" ? target.text === text : text.test(target.text)));
    // A setting by the steps to it in the editor: the module, Settings, then the setting as its form names it.
    expect(has(titleOf("weight"), "Settings › Gloves Weighed")).toBe(true);
    expect(has(titleOf("force_at_break"), "Settings › Gloves Tested")).toBe(true);
    expect(has(titleOf("visual"), "Settings › Classes › Major")).toBe(true);
    expect(has(titleOf("dimensions"), "Settings › Specs")).toBe(true);
    // A custom module (STD_SG's Glove Type: EG holds it in Glove Information), the report's own layout and a section's heading.
    const sg = resolve(seedDefinition("STD_SG"));
    const [glove] = sg.customModules;
    const sgTargets = rows(coverageChecklist(sg)).flatMap((row) => row.targets);
    expect(sgTargets.some((target) => target.place === `Custom Module ${glove.title}`)).toBe(true);
    expect(has("Report Layout", /./)).toBe(true);
    expect(has(null, /^Section Title “.+”$/)).toBe(true);
    expect(targets.some((target) => target.place?.endsWith(" settings"))).toBe(false);
    // What the source shows in each cell, as a short name.
    const inputs = new Set(rows(checklist).map((row) => row.input));
    expect(inputs).toContain("Worked Out");
    expect(inputs).toContain("Printed Value");
    for (const input of inputs) expect(lowerCaseWords(input), input).toEqual([]);
  });

  it("falls back to a field's own wording where a level has none of its own", () => {
    const checklist = coverageChecklist(stdEg());
    const texts = rows(checklist).flatMap((row) => row.targets.map((target) => target.text));
    expect(texts).not.toContain("cartonInspected");
    expect(texts.some((text) => /^[a-z]+[A-Z]\w*$/.test(text))).toBe(false);
  });

  it("blocks confirmation when a module the form needs is switched off", () => {
    const checklist = coverageChecklist(stdEgWith("force_at_break", (entry) => (entry.include = false)));
    expect(checklist.blocking).toBe(true);
    const lost = missingRows(checklist);
    expect(lost.length).toBeGreaterThan(0);
    expect(lost[0].targets.find((target) => !target.covered)?.reason).toMatch(/switched off in this version/);
    expect(coverageBlocker(detail({ coverageConfirmedAt: null }), checklist)).toMatch(
      /not in this version\. Nothing may be lost \(BUILD_SPEC 4\.2 rule 2\)/,
    );
  });

  it("finds a header field, a defect class, a labelling level, a listed defect and a location switched off", () => {
    const cases: [ModuleKey, (config: Record<string, JsonValue>) => void, RegExp][] = [
      ["header", (config) => ((config.fields as Record<string, boolean>).factoryGloveCode = false), /Factory Glove Code is switched off/],
      [
        "visual",
        (config) => ((config.classes as Record<string, Record<string, JsonValue>>).minor.include = false),
        /The minor class is switched off/,
      ],
      [
        "labeling",
        (config) => ((config.levels as Record<string, Record<string, JsonValue>>).carton.include = false),
        /The carton level is switched off/,
      ],
      [
        "visual",
        (config) => {
          const major = (config.classes as Record<string, Record<string, JsonValue>>).major;
          major.defects = (major.defects as { code: string }[]).filter((item) => item.code !== "thin_spot");
        },
        /is not in .*major defects/,
      ],
      [
        "watertight",
        (config) => (config.locations = (config.locations as { code: string }[]).filter((item) => item.code !== "hole_cuff")),
        /is not in .*hole locations/,
      ],
      [
        "sampling_plan",
        (config) => ((config.columns as Record<string, boolean>).glovesPhysical = false),
        /column is switched off/,
      ],
      [
        "dimensions",
        (config) => (config.measures = ["length", "width"]),
        /is not measured/,
      ],
    ];
    for (const [key, change, reason] of cases) {
      const checklist = coverageChecklist(
        stdEgWith(key, (entry) => {
          const config = structuredClone(entry.config ?? {});
          change(config);
          entry.config = config;
        }),
      );
      const reasons = missingRows(checklist).flatMap((row) => row.targets.map((target) => target.reason ?? ""));
      expect(reasons.some((text) => reason.test(text)), `${key}: ${reason}`).toBe(true);
    }
  });

  it("keeps every field with # Gloves for Weight switched off: the app's own row, no form prints it (12 October 2026)", () => {
    const checklist = coverageChecklist(
      stdEgWith("sampling_plan", (entry) => {
        const config = structuredClone(entry.config ?? {});
        (config.columns as Record<string, boolean>).glovesWeight = false;
        entry.config = config;
      }),
    );
    // The report's "Weight (g) - average of 13 gloves per size" stays kept by weight's title and n.
    expect(missingRows(checklist).map((row) => row.label)).toEqual([]);
    expect(checklist.blocking).toBe(false);
  });

  it("needs the custom modules the inventory names, and the form's sizes", () => {
    // STD_SG keeps Glove Type in a custom module (EG and Safedon hold it in Glove Information).
    const sg = seedDefinition("STD_SG");
    const withoutCustom = resolve({ ...sg, customModules: [] });
    expect(missingRows(coverageChecklist(withoutCustom)).map((row) => row.label)).toEqual(["Glove Type"]);

    const definition = seedDefinition("STD_EG");

    const fewerSizes = resolve({ ...definition, sizes: [{ value: "S" }, { value: "M" }, { value: "L" }] });
    const sizeReasons = missingRows(coverageChecklist(fewerSizes)).flatMap((row) => row.targets.map((target) => target.reason));
    expect(sizeReasons).toContain("Sizes XS, XL of the form are not in this version.");
  });

  it("checks a template on top of a seed against the seed's forms, without blocking on what it leaves out", () => {
    const child = resolve(
      {
        code: "CLIENT_EG",
        name: "Client gloves",
        extends: "STD_EG",
        scope: { productType: "examination", standard: "EN455" },
        unit: "pcs",
        sizes: seedDefinition("STD_EG").sizes,
        modules: [{ key: "force_at_break", include: false }],
      },
      [{ definition: seedDefinition("STD_EG"), version: 1 }],
    );
    expect(inventoryOf(child)).toEqual({ mode: "base", code: "STD_EG" });
    const checklist = coverageChecklist(child);
    expect(checklist.documents.map((document) => document.id)).toEqual(["report_STD_EG", "onsite_EG"]);
    expect(checklist.missing).toBeGreaterThan(0);
    expect(checklist.blocking).toBe(false);
    expect(
      coverageBlocker(detail({ code: "CLIENT_EG", coverageConfirmedAt: null, resolution: { state: "ok", template: child } }), checklist),
    ).toBeNull();
  });

  it("has nothing to list for a template outside the inventory: the last tick is the check", () => {
    const own = resolve({ ...seedDefinition("STD_EG"), code: "OTHER_EG" });
    const checklist = coverageChecklist(own);
    expect(checklist).toMatchObject({ mode: "none", inventoryCode: null, documents: [], fields: 0, blocking: false });
    expect(checklist.sectionKeys).toEqual([]);
    expect(allSectionsTicked(checklist, [])).toBe(true);
  });

  it("names each section by its source and heading", () => {
    const [field] = sourceFields("report_STD_EG");
    expect(sectionKeyOf(field)).toBe(field.id.slice(0, field.id.lastIndexOf(":")));
    expect(sectionKeyOf(field).startsWith("report_STD_EG:")).toBe(true);
  });

  it("needs every section ticked, and only this checklist's sections", () => {
    const checklist = coverageChecklist(stdEg());
    expect(allSectionsTicked(checklist, checklist.sectionKeys)).toBe(true);
    expect(allSectionsTicked(checklist, checklist.sectionKeys.slice(1))).toBe(false);
    expect(allSectionsTicked(checklist, [...checklist.sectionKeys, "report_SAFEDON_EG:other"])).toBe(false);
  });

  it("is confirmed only against a resolved version with its source file", () => {
    const checklist = coverageChecklist(stdEg());
    expect(coverageBlocker(detail({ coverageConfirmedAt: null }), checklist)).toBeNull();
    expect(coverageBlocker(detail({ sourceFilePath: null }), checklist)).toMatch(/Upload the source form or report first/);
    expect(coverageBlocker(detail({ status: "active", sourceFilePath: null }), checklist)).toMatch(
      /^Version 2 has no source file to check against, and only a draft takes one\. Make a new version/,
    );
    // A draft in use cannot take the file any more: not "upload it first".
    expect(coverageBlocker(detail({ usage: 1, sourceFilePath: null }), checklist)).toBe(
      "Version 2 has no source file to check against, and it is used by inspections, so it can no longer take one. Make a new version, upload the form to it and confirm its checklist there.",
    );
    // With its file it can still be confirmed: coverage is not part of the frozen content.
    expect(coverageBlocker(detail({ usage: 1, coverageConfirmedAt: null }), checklist)).toBeNull();
    expect(coverageBlocker(detail({ resolution: { state: "missing" } }), null)).toBe(
      "This version has not resolved, so there is nothing to check yet. Open it in the editor and save it without problems.",
    );
    expect(coverageBlocker(detail({ status: "retired", resolution: { state: "missing" } }), null)).toMatch(
      /nothing to check yet\. Make a new version and fix it in the editor\.$/,
    );
  });
});

/* ------------------------------------------------------------------ *
 * New version
 * ------------------------------------------------------------------ */

describe("new version", () => {
  it("copies the definition with the version's source file, leaving the original as it was", () => {
    const original = { code: "STD_EG", name: "Standard", modules: [{ key: "header", include: true }], sourceFile: "old" };
    const copy = definitionForNewVersion(original, "STD_EG/v2/1b4e28ba-2fa1-4d2b-9f3a-1c2d3e4f5a6b/report.xlsx");
    expect(copy.sourceFile).toBe("STD_EG/v2/1b4e28ba-2fa1-4d2b-9f3a-1c2d3e4f5a6b/report.xlsx");
    (copy.modules as { include: boolean }[])[0].include = false;
    expect(original.modules[0].include).toBe(true);
    expect(definitionForNewVersion(original, null)).not.toHaveProperty("sourceFile");
  });

  it("numbers it after the highest version of the code", () => {
    expect(nextVersionOf([])).toBe(1);
    expect(nextVersionOf([{ version: 1 }, { version: 3 }, { version: 2 }])).toBe(4);
  });

  it("builds on a base's active version only, as the editor does: never a draft, never a retired one", () => {
    const base = (version: number, status: TemplateStatus) => ({ version, status });
    expect(baseVersionOf([base(4, "draft"), base(3, "active"), base(2, "retired")])).toEqual(base(3, "active"));
    // In any order.
    expect(baseVersionOf([base(1, "retired"), base(5, "draft"), base(3, "active")])).toEqual(base(3, "active"));
    // A retired base is no base to build on; a draft can still be saved over in place.
    expect(baseVersionOf([base(1, "retired"), base(5, "draft"), base(3, "retired")])).toBeNull();
    expect(baseVersionOf([base(2, "draft"), base(1, "draft")])).toBeNull();
    expect(baseVersionOf([])).toBeNull();
  });

  it("writes a draft row, scope from the definition, coverage to confirm again", () => {
    const definition = definitionForNewVersion(
      { ...seedDefinition("STD_EG"), scope: { productType: "examination", standard: "EN455", clientId: CLIENT_ID } },
      "STD_EG/v2/1b4e28ba-2fa1-4d2b-9f3a-1c2d3e4f5a6b/report.xlsx",
    );
    const source = {
      code: "STD_EG",
      extends_code: null,
      product_type: "surgical" as const,
      standard: "custom" as const,
      client_id: null,
      manufacturer_id: MAKER_ID,
    };
    const resolved = resolve(definition as unknown as TemplateDefinition);
    expect(newVersionRow(source, definition, resolved, 3)).toMatchObject({
      code: "STD_EG",
      version: 3,
      status: "draft",
      product_type: "examination",
      standard: "EN455",
      client_id: CLIENT_ID,
      manufacturer_id: null,
      extends_code: null,
      source_file_path: "STD_EG/v2/1b4e28ba-2fa1-4d2b-9f3a-1c2d3e4f5a6b/report.xlsx",
      coverage_confirmed_by: null,
      coverage_confirmed_at: null,
    });
    expect(newVersionRow(source, definition, null, 3).resolved).toBeNull();

    // A definition that does not parse keeps the scope of the version it came from.
    const broken = newVersionRow(source, { code: "STD_EG", name: "Broken" }, null, 4);
    expect(broken).toMatchObject({ product_type: "surgical", standard: "custom", manufacturer_id: MAKER_ID, source_file_path: null });
  });
});
