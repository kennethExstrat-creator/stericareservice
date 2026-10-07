import { describe, expect, it } from "vitest";
import {
  decisionDraftKey,
  readDecisionDraft,
  readReopenDraft,
  reopenDraftKey,
  writeDecisionDraft,
  writeReopenDraft,
} from "./drafts";

const ADMIN = "00000000-0000-4000-8000-000000000102";
const OTHER_ADMIN = "00000000-0000-4000-8000-000000000103";
const INSPECTION = "3f0c2a1e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
const REVIEW = "99999999-9999-4999-8999-000000000001";
const NEWER_REVIEW = "99999999-9999-4999-8999-000000000002";

describe("draft keys", () => {
  it("keep each admin's drafts apart, per inspection, and per opinion and finding", () => {
    expect(reopenDraftKey(ADMIN, INSPECTION)).not.toBe(reopenDraftKey(OTHER_ADMIN, INSPECTION));
    expect(decisionDraftKey(ADMIN, REVIEW, "F1")).not.toBe(decisionDraftKey(ADMIN, NEWER_REVIEW, "F1"));
    expect(decisionDraftKey(ADMIN, REVIEW, "F1")).not.toBe(decisionDraftKey(ADMIN, REVIEW, "F2"));
    expect(decisionDraftKey(ADMIN, REVIEW, "F1")).not.toBe(decisionDraftKey(OTHER_ADMIN, REVIEW, "F1"));
  });
});

describe("drafts as stored", () => {
  it("round-trip the reason and the decision with its note", () => {
    const reason = "Size M watertight: retest the two burst gloves.\nAdd the photos.";
    expect(readReopenDraft(writeReopenDraft(reason))).toBe(reason);
    const decision = { action: "disagree" as const, note: "Checked on site." };
    expect(readDecisionDraft(writeDecisionDraft(decision))).toEqual(decision);
    // A note typed before a choice.
    expect(readDecisionDraft(writeDecisionDraft({ action: "", note: "First thoughts" }))).toEqual({ action: "", note: "First thoughts" });
  });

  it("read anything else as no draft", () => {
    expect(readReopenDraft(null)).toBeNull();
    expect(readReopenDraft("not json")).toBeNull();
    expect(readReopenDraft(JSON.stringify({ v: 2, reason: "later format" }))).toBeNull();
    expect(readDecisionDraft(JSON.stringify({ v: 1, action: "ignore", note: "" }))).toBeNull();
  });
});
