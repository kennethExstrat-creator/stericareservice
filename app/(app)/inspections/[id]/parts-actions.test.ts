import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/inspections/parts-server", () => ({ createPart: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));

import { authorizeAction } from "@/lib/auth/session";
import { createPart } from "@/lib/inspections/parts-server";
import { createClient } from "@/lib/supabase/server";
import { addInspectionPart } from "./parts-actions";

const INSPECTION = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const PART = "9e8d7c6b-5a49-4382-9716-a5b4c3d2e1f0";
const INSPECTOR = { id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", email: "inspector@test.local", fullName: null, role: "inspector" as const };
/** The caller's own client, as createPart is handed it. */
const CLIENT = { from: vi.fn() };

beforeEach(() => {
  vi.mocked(authorizeAction).mockReset().mockResolvedValue({ ok: true, user: INSPECTOR });
  vi.mocked(createClient).mockReset().mockResolvedValue(CLIENT as never);
  vi.mocked(createPart).mockReset().mockResolvedValue({ ok: true, id: PART });
});

describe("addInspectionPart", () => {
  it("adds the part through the caller's own client, for the caller, and answers its id", async () => {
    await expect(addInspectionPart(INSPECTION, " 1000002 (2000002) ")).resolves.toEqual({ status: "added", id: PART });
    expect(createPart).toHaveBeenCalledWith(CLIENT, { id: INSPECTOR.id, role: "inspector" }, INSPECTION, "1000002 (2000002)");
  });

  it("adds a part without a PO number when none is typed", async () => {
    await addInspectionPart(INSPECTION, "   ");
    await addInspectionPart(INSPECTION, null);
    expect(vi.mocked(createPart).mock.calls.map((call) => call[3])).toEqual([null, null]);
  });

  it("checks the session first", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "Your session has ended. Sign in again." });
    await expect(addInspectionPart(INSPECTION, null)).resolves.toEqual({
      status: "error",
      message: "Your session has ended. Sign in again.",
    });
    expect(createPart).not.toHaveBeenCalled();
  });

  it("refuses an id that is no inspection's and a PO number longer than the header keeps", async () => {
    await expect(addInspectionPart("not-an-id", null)).resolves.toMatchObject({ status: "error" });
    await expect(addInspectionPart(INSPECTION, "1".repeat(2001))).resolves.toEqual({
      status: "error",
      message: "The PO / SO number is too long: up to 2000 characters.",
    });
    expect(createPart).not.toHaveBeenCalled();
  });

  it("answers createPart's reason when it refuses", async () => {
    vi.mocked(createPart).mockResolvedValue({ ok: false, message: "This inspection can no longer be changed here." });
    await expect(addInspectionPart(INSPECTION, null)).resolves.toEqual({
      status: "error",
      message: "This inspection can no longer be changed here.",
    });
  });

  it("answers calmly when something fails on the way", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createPart).mockRejectedValue(new Error("connection reset"));
    await expect(addInspectionPart(INSPECTION, null)).resolves.toEqual({
      status: "error",
      message: "The PO could not be added. Try again.",
    });
  });
});
