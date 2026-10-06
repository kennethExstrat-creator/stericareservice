import { describe, expect, it } from "vitest";
import { REOPEN_REASON_MAX, REVIEW_MESSAGES, ReopenInputSchema, ReviewTargetSchema, reopenReasonOf } from "./schemas";

const ID = "3f0c2a1e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";

describe("ReviewTargetSchema", () => {
  it("takes an inspection id and the version exactly as Postgres wrote it, microseconds included", () => {
    const version = "2026-10-06T06:05:03.123456+00:00";
    expect(ReviewTargetSchema.parse({ inspectionId: ID, version })).toEqual({ inspectionId: ID, version });
  });

  it.each([
    [{ inspectionId: "1 or 1=1", version: "2026-10-06T06:05:03+00:00" }, REVIEW_MESSAGES.notFound],
    [{ inspectionId: null, version: "2026-10-06T06:05:03+00:00" }, REVIEW_MESSAGES.notFound],
    [{ inspectionId: ID, version: "" }, REVIEW_MESSAGES.staleForm],
    [{ inspectionId: ID, version: "yesterday" }, REVIEW_MESSAGES.staleForm],
    [{ inspectionId: ID, version: null }, REVIEW_MESSAGES.staleForm],
  ])("refuses %j in plain words", (input, message) => {
    const parsed = ReviewTargetSchema.safeParse(input);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe(message);
  });
});

describe("ReopenInputSchema", () => {
  it("trims the reason", () => {
    expect(ReopenInputSchema.parse({ inspectionId: ID, reason: "  Retest size M.  " })).toEqual({
      inspectionId: ID,
      reason: "Retest size M.",
    });
  });

  it.each([
    ["missing", null, REVIEW_MESSAGES.reasonMissing],
    ["blank", "   ", REVIEW_MESSAGES.reasonMissing],
    ["too long", "x".repeat(REOPEN_REASON_MAX + 1), REVIEW_MESSAGES.reasonTooLong],
  ])("asks for a reason when it is %s", (_, reason, message) => {
    const parsed = ReopenInputSchema.safeParse({ inspectionId: ID, reason });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toEqual([expect.objectContaining({ path: ["reason"], message })]);
  });

  it("allows exactly the limit", () => {
    expect(ReopenInputSchema.safeParse({ inspectionId: ID, reason: "x".repeat(REOPEN_REASON_MAX) }).success).toBe(true);
  });
});

describe("reopenReasonOf", () => {
  it("reads the reason an audit row carries", () => {
    expect(reopenReasonOf({ reason: " Retest size M. " })).toBe("Retest size M.");
  });

  it.each([[null], [[]], ["text"], [{}], [{ reason: "  " }], [{ reason: 4 }]])("is null for %j", (changes) => {
    expect(reopenReasonOf(changes)).toBeNull();
  });
});
