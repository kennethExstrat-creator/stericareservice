// A photo's caption, kept in the tab while it is typed (lib/drafts/tab-draft.ts):
// one per user and photo, and only while it differs from the saved caption.
// In the browser it comes back after a reload and goes once cancelled or
// saved (e2e/capture/followups.spec.ts). The dialog as the server draws it:
// its words, and the Hand and Level legends as far above their choices as
// every other label is above its control.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultLabels } from "@/lib/coverage/fields";
import type { PhotoTagOptions } from "@/lib/inspections/photos/view";

// The dialog is drawn in place: a portal draws nothing on the server.
vi.mock("@/components/ui/dialog", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Part,
    DialogClose: Part,
    DialogContent: Part,
    DialogDescription: Part,
    DialogFooter: Part,
    DialogHeader: Part,
    DialogTitle: Part,
  };
});

import { captionDraft, captionDraftKey, PhotoEditDialog } from "./photo-edit-dialog";
import type { SlotPhoto } from "./photo-model";

const USER = "00000000-0000-4000-8000-000000000101";
const OTHER_USER = "00000000-0000-4000-8000-000000000102";
const PHOTO = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const OTHER_PHOTO = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";

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

describe("PhotoEditDialog", () => {
  const photo: SlotPhoto = {
    id: PHOTO,
    queued: false,
    moduleKey: "visual",
    target: "size:M/hand:R",
    caption: null,
    takenAt: null,
    flagged: false,
    includeInReport: false,
    state: "uploaded",
    progress: 1,
    error: null,
    thumbUrl: null,
    fullUrl: null,
    pendingRow: false,
  };
  const options: PhotoTagOptions = {
    modules: [
      { key: "visual", title: "Visual Inspection", targetKeys: ["size", "hand", "defect"], handSplit: true, included: true },
      { key: "labeling", title: "Labelling", targetKeys: ["size", "box", "defect", "level"], handSplit: false, included: true },
      { key: "loading", title: "Loading", targetKeys: ["item"], handSplit: false, included: true },
    ],
    sizes: [{ value: "M", label: "M" }],
    defects: [],
    defectLabels: {},
    levels: {
      labeling: [
        { value: "inner", label: "Dispenser Box" },
        { value: "carton", label: "Carton Box" },
      ],
    },
    items: { loading: [{ value: "sealed", label: "Sealed" }] },
  };
  const draw = (patch: Partial<SlotPhoto>) =>
    renderToStaticMarkup(
      <PhotoEditDialog inspectionId={INSPECTION} photo={{ ...photo, ...patch }} options={options} alt="Visual Inspection · Size M" onClose={() => {}} />,
    );

  /** The classes of the legend that reads `text`. */
  const legend = (html: string, text: string) =>
    new RegExp(`<legend data-slot="field-legend"[^>]*class="([^"]*)"[^>]*>${text}</legend>`).exec(html)?.[1].split(" ");
  /** The words of each radio choice, in order. */
  const choices = (html: string) => [...html.matchAll(/role="radio"[\s\S]*?<label[^>]*>([^<]*)<\/label>/g)].map(([, label]) => label);

  it("puts Hand and Level as far above their choices as every label is above its control", () => {
    // A fieldset's legend is no flex item: the FieldSet's gap never reaches it, so its own margin is the gap.
    for (const [html, text] of [
      [draw({}), "Hand"],
      [draw({ moduleKey: "labeling", target: "size:M/level:inner" }), "Level"],
    ] as const) {
      const classes = legend(html, text);
      expect(classes, text).toContain("mb-3");
      expect(classes, text).not.toContain("mb-0");
      // The FieldLabel's line height, so the text sits where a label's does.
      expect(classes, text).toContain("leading-snug");
      // Every other field keeps 12 px (gap-3) between its label and its control.
      expect(html).toMatch(/<div role="group" data-slot="field" data-orientation="vertical" class="[^"]*\bgap-3\b[^"]*"><label data-slot="field-label"[^>]*>Caption<\/label>/);
    }
  });

  it("titles the dialog and names its own fields and choices in Title Case", () => {
    const hand = draw({});
    expect(hand).toContain('Edit Photo<span class="sr-only">: Visual Inspection · Size M</span>');
    expect(choices(hand)).toEqual(["Not Recorded", "Right Hand", "Left Hand"]);

    const level = draw({ moduleKey: "labeling", target: "size:M/level:inner" });
    // The levels in the module's words, after the app's own "Not Recorded".
    expect(choices(level)).toEqual(["Not Recorded", "Dispenser Box", "Carton Box"]);
    expect(level).toContain(">Box (Carton Number)</label>");
  });

  it("names loading's stage picker in the loading module's words, as lib/coverage lists them", () => {
    // A template's caption, not the app's own label: it stays as printed (the loading form reads the same).
    const html = draw({ moduleKey: "loading", target: "item:sealed" });
    expect(html).toContain(`>${defaultLabels("loading").loadingStage}</label>`);
  });
});
