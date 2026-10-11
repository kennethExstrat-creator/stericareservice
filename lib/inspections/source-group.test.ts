import { describe, expect, it } from "vitest";
import type { createClient } from "@/lib/supabase/client";
import { CLAIM_MS, loadSourceGroup, sourceHomeOf, sourceHomes, storedReading } from "./source-group";

const HEAD = "aaaaaaaa-0000-4000-8000-000000000001";
const PART = "bbbbbbbb-0000-4000-8000-000000000002";

type Result = { data: unknown; error: unknown };

/** A client whose inspections reads answer the own row first, then the group. */
function fakeClient(own: Result, group: Result) {
  const filters: string[] = [];
  let reads = 0;
  const builder = () => {
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order"]) query[method] = () => query;
    query.or = (filter: string) => {
      filters.push(filter);
      return query;
    };
    query.maybeSingle = () => Promise.resolve(own);
    query.then = (resolve: (value: Result) => unknown) => Promise.resolve(group).then(resolve);
    return query;
  };
  const client = {
    from: () => {
      reads += 1;
      return builder();
    },
  };
  return { client: client as unknown as ReturnType<typeof createClient>, filters, reads: () => reads };
}

const row = (id: string, groupId: string | null, poNo: string | null) => ({
  id,
  ref_no: `INS-2026-000${groupId ? 2 : 1}`,
  po_no: poNo,
  product_name: null,
  status: "draft",
  group_id: groupId,
  created_at: "2026-10-11T08:00:00Z",
});

describe("storedReading", () => {
  const now = Date.parse("2026-10-11T08:10:00Z");

  it("tells a read, a failed and a claimed file from one not read yet", () => {
    expect(storedReading({ ai_status: "read", ai_read_at: "2026-10-11T08:00:00Z", ai_summary: "A PO." }, now)).toEqual({
      status: "read",
      summary: "A PO.",
    });
    expect(storedReading({ ai_status: "failed", ai_read_at: "2026-10-11T08:00:00Z", ai_summary: "Too large." }, now)).toEqual({
      status: "failed",
      summary: "Too large.",
    });
    expect(storedReading({ ai_status: null, ai_read_at: "2026-10-11T08:00:00Z", ai_summary: null }, now)).toEqual({
      status: "reading",
      summary: null,
      elsewhere: true,
    });
    expect(storedReading({ ai_status: null, ai_read_at: null, ai_summary: null }, now)).toBeNull();
  });

  it("takes a claim older than CLAIM_MS for a reading that stopped: the file is not read yet", () => {
    const claimedAt = new Date(now - CLAIM_MS - 1).toISOString();
    expect(storedReading({ ai_status: null, ai_read_at: claimedAt, ai_summary: null }, now)).toBeNull();
  });
});

describe("where the Source Documents are", () => {
  it("keeps them on the first part, or on this part when the first cannot be read", () => {
    const parts = [
      { id: HEAD, refNo: "INS-2026-0001", poNo: "PO-0001", productName: null, status: "draft" as const, primary: true },
      { id: PART, refNo: "INS-2026-0002", poNo: "PO-0002", productName: null, status: "draft" as const, primary: false },
    ];
    expect(sourceHomeOf(parts, PART)).toBe(HEAD);
    expect(sourceHomeOf(parts.slice(1), PART)).toBe(PART);
    expect(sourceHomeOf(null, PART)).toBe(PART);
    expect(sourceHomes(HEAD, PART)).toEqual([HEAD, PART]);
    expect(sourceHomes(PART, PART)).toEqual([PART]);
  });

  it("reads the group of the part through the caller's client", async () => {
    const fake = fakeClient(
      { data: { id: PART, group_id: HEAD }, error: null },
      { data: [row(HEAD, null, "PO-0001"), row(PART, HEAD, null)], error: null },
    );
    const group = await loadSourceGroup(fake.client, PART);
    expect(fake.filters).toEqual([`id.eq.${HEAD},group_id.eq.${HEAD}`]);
    expect(group?.homeId).toBe(HEAD);
    expect(group?.parts.map((part) => [part.id, part.poNo, part.primary])).toEqual([
      [HEAD, "PO-0001", true],
      [PART, null, false],
    ]);
  });

  it("answers null for an inspection this user cannot read, and throws when the reads fail", async () => {
    expect(await loadSourceGroup(fakeClient({ data: null, error: null }, { data: [], error: null }).client, PART)).toBeNull();
    await expect(
      loadSourceGroup(fakeClient({ data: null, error: { message: "Failed to fetch" } }, { data: [], error: null }).client, PART),
    ).rejects.toThrow("Failed to fetch");
  });
});
