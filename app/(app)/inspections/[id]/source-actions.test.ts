import { beforeEach, describe, expect, it, vi } from "vitest";

// The framework's test registry stands in for the real modules.
vi.mock("@/modules/registry", async () => {
  const { TEST_REGISTRY } = await import("@/modules/_framework/__fixtures__/test-registry");
  return { MODULE_REGISTRY: TEST_REGISTRY, getModuleDefinition: (key: keyof typeof TEST_REGISTRY) => TEST_REGISTRY[key] };
});
vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ rpc: vi.fn(async () => ({ error: null })) })) }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("@/lib/ai/settings", () => ({ loadAiEnv: vi.fn(async () => ({})), loadGlossary: vi.fn(async () => []) }));
vi.mock("@/lib/ai/source-reader", () => ({ readSourceDocument: vi.fn() }));
vi.mock("@/lib/inspections/parts-server", () => ({ loadParts: vi.fn(), createPart: vi.fn() }));
vi.mock("@/lib/inspections/source-parts-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/inspections/source-parts-server")>()),
  claimFile: vi.fn(),
  releaseFile: vi.fn(),
  recordReading: vi.fn(),
  fillPartOnServer: vi.fn(),
}));

import { readSourceDocument } from "@/lib/ai/source-reader";
import { authorizeAction } from "@/lib/auth/session";
import type { InspectionPart } from "@/lib/inspections/parts";
import { createPart, loadParts } from "@/lib/inspections/parts-server";
import { claimFile, fillPartOnServer, recordReading, releaseFile } from "@/lib/inspections/source-parts-server";
import { createClient } from "@/lib/supabase/server";
import { TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { makeTestTemplate } from "@/modules/_framework/testing";
import { fillSourcePart, readSourceFile } from "./source-actions";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const D = "dddddddd-0000-4000-8000-000000000004";
const FILE = "ffffffff-0000-4000-8000-00000000000f";
const INSPECTOR = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const USER = { id: INSPECTOR, email: "inspector@example.com", fullName: "Inspector", role: "inspector" as const };

const template = makeTestTemplate(TEST_REGISTRY, ["glove_info"]);
const dataWithPo = (poNo: string) => ({ modules: { header: { poNo, productName: null, client: null } }, custom: {} });

function part(id: string, poNo: string, status: InspectionPart["status"], primary = false): InspectionPart {
  return { id, refNo: "INS-2026-0001", poNo, productName: null, status, primary };
}

type Call = [string, unknown[]];

/** The caller's client: the asking part, its file, the other parts, the defect library and the file's bytes. */
function fakeClient(otherRows: Array<{ id: string; status: string; poNo: string }>) {
  const calls: Array<{ table: string; calls: Call[] }> = [];
  const respond = (table: string, chain: Call[]) => {
    const select = String(chain.find(([name]) => name === "select")?.[1][0] ?? "");
    if (table === "inspection_files") {
      return { data: { id: FILE, name: "forms.pdf", storage_path: `${A}/${FILE}.pdf`, module_key: "source_documents", ai_status: null, ai_read_at: null, ai_summary: null }, error: null };
    }
    if (table === "defect_codes") return { data: [], error: null };
    if (select === "data") return { data: { data: dataWithPo("2680276") }, error: null };
    if (select.includes("template:templates")) {
      return {
        data: { id: A, status: "draft", inspector_id: INSPECTOR, data: dataWithPo("2680276"), module_overrides: {}, template: { resolved: template } },
        error: null,
      };
    }
    return {
      data: otherRows.map((row) => ({ id: row.id, status: row.status, inspector_id: INSPECTOR, data: dataWithPo(row.poNo), module_overrides: {} })),
      error: null,
    };
  };
  const client = {
    from: (table: string) => {
      const entry = { table, calls: [] as Call[] };
      calls.push(entry);
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "order"]) {
        builder[method] = (...args: unknown[]) => {
          entry.calls.push([method, args]);
          return builder;
        };
      }
      builder.maybeSingle = async () => respond(table, entry.calls);
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(respond(table, entry.calls)).then(resolve);
      return builder;
    },
    storage: { from: () => ({ download: async () => ({ data: new Blob([Buffer.from("%PDF-1.7\n")]), error: null }) }) },
  };
  return { client, calls };
}

beforeEach(() => {
  vi.mocked(authorizeAction).mockResolvedValue({ ok: true, user: USER });
  vi.mocked(claimFile).mockResolvedValue({ kind: "claimed" });
  vi.mocked(releaseFile).mockResolvedValue(undefined);
  vi.mocked(recordReading).mockResolvedValue(undefined);
  vi.mocked(createPart).mockResolvedValue({ ok: true, id: D });
  vi.mocked(fillPartOnServer).mockImplementation(async (_client, _user, id) => {
    if (id === B) return { kind: "filled", filled: 1, poNo: "2680277" };
    if (id === C) return { kind: "skipped", reason: "it is submitted" };
    return { kind: "filled", filled: 1, poNo: "2680280" };
  });
});

describe("readSourceFile", () => {
  it("reads the file once for every part: this part's values back, the others filled, a new PO added", async () => {
    const fake = fakeClient([
      { id: B, status: "draft", poNo: "2680277" },
      { id: C, status: "submitted", poNo: "2680279" },
    ]);
    vi.mocked(createClient).mockResolvedValue(fake.client as never);
    vi.mocked(loadParts).mockResolvedValue([part(A, "2680276", "draft", true), part(B, "2680277", "draft"), part(C, "2680279", "submitted")]);
    vi.mocked(readSourceDocument).mockResolvedValue({
      ok: true,
      model: "claude-opus-5-5",
      answer: {
        summary: "Four inspection forms.",
        parts: {
          [A]: { glove_info: { colour: "Blue" }, conclusion: { finalResult: "pass" } },
          [B]: { glove_info: { colour: "Blue" } },
          [C]: { glove_info: { colour: "White" } },
        },
        newParts: [{ poNo: "2680280", proposals: { glove_info: { colour: "Green" } } }],
        mappings: [],
      },
    });

    const result = await readSourceFile(A, FILE);

    expect(result).toEqual({
      status: "read",
      summary:
        "Four inspection forms. Filled 1 field in PO 2680276. Filled 1 field in PO 2680277. Skipped PO 2680279: it is submitted. Added PO 2680280 with 1 field.",
      proposals: { glove_info: { colour: "Blue" } },
      others: "Filled 1 field in PO 2680277. Skipped PO 2680279: it is submitted. Added PO 2680280 with 1 field.",
      changedParts: [B, D],
    });
    // The files are the first part's: this one.
    const fileQuery = fake.calls.find((entry) => entry.table === "inspection_files");
    expect(fileQuery?.calls).toContainEqual(["in", ["inspection_id", [A]]]);
    // The AI gets every part once, a locked one without its data, and the modules once.
    const input = vi.mocked(readSourceDocument).mock.calls[0][0];
    expect(input.modules.map((module) => module.key)).toEqual(["header", "glove_info"]);
    expect(input.parts.map((entry) => [entry.id, entry.label, entry.editable])).toEqual([
      [A, "PO 2680276", true],
      [B, "PO 2680277", true],
      [C, "PO 2680279", false],
    ]);
    expect(vi.mocked(fillPartOnServer).mock.calls.map((call) => call[2])).toEqual([B, C, D]);
    expect(createPart).toHaveBeenCalledWith(fake.client, USER, A, "2680280");
    expect(recordReading).toHaveBeenCalledWith(FILE, "read", (result as { summary: string }).summary);
    expect(releaseFile).not.toHaveBeenCalled();
  });

  it("keeps the summary as it was for an inspection of one PO", async () => {
    vi.mocked(createClient).mockResolvedValue(fakeClient([]).client as never);
    vi.mocked(loadParts).mockResolvedValue([part(A, "2680276", "draft", true)]);
    vi.mocked(readSourceDocument).mockResolvedValue({
      ok: true,
      model: "claude-opus-5-5",
      answer: { summary: "A PO.", parts: {}, modules: { glove_info: { colour: "Blue" } }, newParts: [], mappings: ["SKV → Skin Void"] },
    });

    const result = await readSourceFile(A, FILE);

    expect(result).toEqual({
      status: "read",
      summary: "A PO. Read as: SKV → Skin Void.",
      proposals: { glove_info: { colour: "Blue" } },
      others: "",
      changedParts: [],
    });
    expect(fillPartOnServer).not.toHaveBeenCalled();
    expect(createPart).not.toHaveBeenCalled();
  });

  it("waits for a reading another screen holds, and gives the file back when the AI is not connected", async () => {
    vi.mocked(createClient).mockResolvedValue(fakeClient([]).client as never);
    vi.mocked(loadParts).mockResolvedValue([part(A, "2680276", "draft", true)]);

    vi.mocked(claimFile).mockResolvedValueOnce({ kind: "busy" });
    expect(await readSourceFile(A, FILE)).toEqual({ status: "busy" });
    vi.mocked(claimFile).mockResolvedValueOnce({ kind: "read", summary: "A PO." });
    expect(await readSourceFile(A, FILE)).toEqual({ status: "done", summary: "A PO." });
    expect(readSourceDocument).not.toHaveBeenCalled();

    vi.mocked(readSourceDocument).mockResolvedValue({ ok: false, reason: "not_connected", message: "AI is not connected yet." });
    expect(await readSourceFile(A, FILE)).toEqual({ status: "error", message: "AI is not connected yet." });
    expect(releaseFile).toHaveBeenCalledWith(FILE, { ai_status: null, ai_read_at: null, ai_summary: null });
    expect(recordReading).not.toHaveBeenCalled();
  });
});

describe("fillSourcePart", () => {
  it("fills a part on the server with checked input only", async () => {
    vi.mocked(createClient).mockResolvedValue(fakeClient([]).client as never);
    expect(await fillSourcePart("not-an-id", {})).toEqual({ error: "The request was not understood." });
    expect(await fillSourcePart(B, { glove_info: "Blue" })).toEqual({ error: "The request was not understood." });
    expect(await fillSourcePart(B, { glove_info: { colour: "Blue" } })).toEqual({ filled: 1 });
    expect(await fillSourcePart(C, { glove_info: { colour: "Blue" } })).toEqual({ error: "Nothing was filled: it is submitted." });
  });
});
