import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { batchDataChanges, createDataUpdater } from "@/components/qc/data-updater";
import { withItemValues, withoutFile } from "./edit";
import { DocumentsDataSchema, emptyDocuments, type DocumentsData } from "./schema";

function saved(): DocumentsData {
  const data = emptyDocuments();
  data.items.iso13485 = { status: "verified", referenceNo: "CERT-0001", expiryDate: "2027-03-31", file: null };
  return data;
}

describe("documents edits", () => {
  it("sets values of one item, keeping its other values and every other item", () => {
    const before = saved();
    const next = withItemValues(before, "iso13485", { expiryDate: "2028-03-31" });
    expect(next.items.iso13485).toEqual({ status: "verified", referenceNo: "CERT-0001", expiryDate: "2028-03-31", file: null });
    expect(next.items.fdaCe).toEqual(before.items.fdaCe);
    expect(withItemValues(next, "iso13485", { status: null }).items.iso13485.status).toBeNull();
    expect(before.items.iso13485.expiryDate).toBe("2027-03-31");
  });

  it("files a file under an item, and lets go of it wherever it was kept when it is deleted", () => {
    const FILE = "00000000-0000-4000-8000-000000000501";
    const attached = withItemValues(withItemValues(saved(), "iso13485", { file: FILE }), "fdaCe", { file: FILE });
    expect([attached.items.iso13485.file, attached.items.fdaCe.file]).toEqual([FILE, FILE]);
    const removed = withoutFile(attached, FILE);
    expect([removed.items.iso13485.file, removed.items.fdaCe.file]).toEqual([null, null]);
    expect(removed.items.iso13485.referenceNo).toBe("CERT-0001");
    // A file no item keeps: the same data back.
    expect(withoutFile(removed, FILE)).toBe(removed);
  });

  it("always gives data the schema accepts", () => {
    for (const next of [
      withItemValues(saved(), "fdaCe", { status: "na" }),
      withItemValues(saved(), "labTestReports", { referenceNo: "LAB-0001", expiryDate: null }),
    ]) {
      expect(DocumentsDataSchema.parse(next)).toEqual(next);
    }
  });
});

describe("documents edits through the capture kit's updater (docs/CAPTURE_KIT.md)", () => {
  it("keeps two changes made in one tick: a reference no. committed as a status is tapped", () => {
    const changes: DocumentsData[] = [];
    const { update } = createDataUpdater(saved(), (next) => changes.push(next));
    update((current) => withItemValues(current, "fdaCe", { referenceNo: "CE-0001" }));
    update((current) => withItemValues(current, "fdaCe", { status: "verified" }));
    expect(changes.at(-1)?.items.fdaCe).toEqual({ status: "verified", referenceNo: "CE-0001", expiryDate: null, file: null });
    expect(changes.at(-1)?.items.iso13485.referenceNo).toBe("CERT-0001");
  });

  it("hands a batch of changes to onChange once, every change in it", () => {
    const changes: DocumentsData[] = [];
    const { update } = createDataUpdater(emptyDocuments(), (next) => changes.push(next));
    batchDataChanges(() => {
      update((current) => withItemValues(current, "certificateOfAnalysis", { status: "verified" }));
      update((current) => withItemValues(current, "declarationOfOrigin", { status: "na" }));
    });
    expect(changes).toHaveLength(1);
    expect([changes[0]?.items.certificateOfAnalysis.status, changes[0]?.items.declarationOfOrigin.status]).toEqual([
      "verified",
      "na",
    ]);
  });

  it("is how the capture screen writes: through useDataUpdater, never onChange itself", () => {
    const source = readFileSync(new URL("./Capture.tsx", import.meta.url), "utf8");
    expect(source).toContain("useDataUpdater(data, onChange)");
    expect(source).not.toMatch(/\bonChange\s*(\?\.)?\(/);
  });
});
