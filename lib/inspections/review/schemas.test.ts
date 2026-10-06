import { describe, expect, it } from "vitest";
import {
  normaliseLineBreaks,
  REOPEN_REASON_MAX,
  REVIEW_MESSAGES,
  ReopenInputSchema,
  ReviewTargetSchema,
  reopenReasonOf,
} from "./schemas";

const ID = "3f0c2a1e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";

/** Ten lines, `extra` characters past the limit as the field counts them: one per line break. */
function tenLines(extra = 0): string {
  const text = ["a".repeat(50 + extra), ...Array.from({ length: 9 }, () => "b".repeat(49))].join("\n");
  expect(text).toHaveLength(REOPEN_REASON_MAX + extra);
  return text;
}

/** How a form sends a textarea's value: every line break as CRLF. */
const asSent = (text: string) => text.replaceAll("\n", "\r\n");

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

  it("counts a line break as one character, as the field did, though the form sends it as two", () => {
    const parsed = ReopenInputSchema.safeParse({ inspectionId: ID, reason: asSent(tenLines()) });
    expect(parsed.success).toBe(true);
    // Stored with plain line ends.
    expect(parsed.data?.reason).toBe(tenLines());
  });

  it("still refuses a reason over the limit on several lines", () => {
    const parsed = ReopenInputSchema.safeParse({ inspectionId: ID, reason: asSent(tenLines(1)) });
    expect(parsed.error?.issues).toEqual([expect.objectContaining({ path: ["reason"], message: REVIEW_MESSAGES.reasonTooLong })]);
  });
});

describe("normaliseLineBreaks", () => {
  it("turns CRLF and a lone CR into LF, and keeps LF", () => {
    expect(normaliseLineBreaks("Retest size M.\r\nAdd the photos.\rThen submit.\nThanks.")).toBe(
      "Retest size M.\nAdd the photos.\nThen submit.\nThanks.",
    );
  });
});

describe("reopenReasonOf", () => {
  it("reads the reason an audit row carries", () => {
    expect(reopenReasonOf({ reason: " Retest size M. " })).toBe("Retest size M.");
  });

  it("gives a reason stored with CRLF line ends plain ones", () => {
    expect(reopenReasonOf({ reason: "Retest size M.\r\nAdd the photos." })).toBe("Retest size M.\nAdd the photos.");
  });

  it.each([[null], [[]], ["text"], [{}], [{ reason: "  " }], [{ reason: 4 }]])("is null for %j", (changes) => {
    expect(reopenReasonOf(changes)).toBeNull();
  });
});
