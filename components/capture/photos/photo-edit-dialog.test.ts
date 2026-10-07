// A photo's caption, kept in the tab while it is typed (lib/drafts/tab-draft.ts):
// one per user and photo, and only while it differs from the saved caption.
// In the browser it comes back after a reload and goes once cancelled or
// saved (e2e/capture/followups.spec.ts).
import { describe, expect, it } from "vitest";
import { captionDraft, captionDraftKey } from "./photo-edit-dialog";

const USER = "00000000-0000-4000-8000-000000000101";
const OTHER_USER = "00000000-0000-4000-8000-000000000102";
const PHOTO = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const OTHER_PHOTO = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";

describe("captionDraftKey", () => {
  it("keeps each user's caption apart, per photo", () => {
    const key = captionDraftKey(USER, PHOTO);
    expect(captionDraftKey(USER, PHOTO)).toBe(key);
    expect(captionDraftKey(OTHER_USER, PHOTO)).not.toBe(key);
    expect(captionDraftKey(USER, OTHER_PHOTO)).not.toBe(key);
  });
});

describe("captionDraft", () => {
  it("is a draft while it differs from the saved caption, a caption cleared on purpose too", () => {
    expect(captionDraft("Thin spot on the palm, glove 3", "Thin spot")).toBe("Thin spot on the palm, glove 3");
    expect(captionDraft("New caption", null)).toBe("New caption");
    expect(captionDraft("", "Thin spot")).toBe("");
  });

  it("is none while it reads as the saved caption, so a reload shows that", () => {
    expect(captionDraft("Thin spot", "Thin spot")).toBeNull();
    expect(captionDraft("", null)).toBeNull();
  });
});
