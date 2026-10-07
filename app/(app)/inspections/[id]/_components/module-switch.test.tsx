// The reason for switching a module off, kept in the tab while it is typed
// (lib/drafts/tab-draft.ts): one per admin, inspection and module. In the
// browser it comes back after a reload and goes once cancelled or sent
// (e2e/capture/followups.spec.ts).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ switchModuleOff: vi.fn(), switchModuleOn: vi.fn() }));

import { PhotoUserContext } from "@/components/capture/photos/hooks";
import { tabDrafts, writeTextDraft } from "@/lib/drafts/tab-draft";
import { SwitchOffDialog, switchOffDraftKey } from "./module-switch";

const ADMIN = "00000000-0000-4000-8000-000000000102";
const OTHER_ADMIN = "00000000-0000-4000-8000-000000000103";
const INSPECTION = "3f0c2a1e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
const OTHER_INSPECTION = "4a1d3b2f-6c7e-4f80-9bac-1d2e3f4a5b6c";

describe("switchOffDraftKey", () => {
  it("keeps each admin's reason apart, per inspection and per module", () => {
    const key = switchOffDraftKey(ADMIN, INSPECTION, "weight");
    expect(switchOffDraftKey(ADMIN, INSPECTION, "weight")).toBe(key);
    expect(switchOffDraftKey(OTHER_ADMIN, INSPECTION, "weight")).not.toBe(key);
    expect(switchOffDraftKey(ADMIN, OTHER_INSPECTION, "weight")).not.toBe(key);
    expect(switchOffDraftKey(ADMIN, INSPECTION, "glove_info")).not.toBe(key);
  });
});

describe("SwitchOffDialog", () => {
  it("renders on the server as its button alone, the dialog closed, whatever the tab keeps", () => {
    tabDrafts.set(switchOffDraftKey(ADMIN, INSPECTION, "weight"), writeTextDraft("Not in this order."));
    const html = renderToStaticMarkup(
      <PhotoUserContext.Provider value={ADMIN}>
        <SwitchOffDialog inspectionId={INSPECTION} moduleKey="weight" title="Weight (g)" onChanged={() => {}} />
      </PhotoUserContext.Provider>,
    );
    expect(html).toMatch(/^<button[^>]*data-action="switch-off"[^>]*>.*Switch Off<\/button>$/);
    expect(html).not.toContain("Not in this order.");
    // Without a known user (no photo queue around it) it renders the same.
    expect(
      renderToStaticMarkup(<SwitchOffDialog inspectionId={INSPECTION} moduleKey="weight" title="Weight (g)" onChanged={() => {}} />),
    ).toBe(html);
  });

  it("is read out as Switch Off and its section's title on a page of two, the title for screen readers only", () => {
    const title = "Packing configuration";
    const html = renderToStaticMarkup(
      <SwitchOffDialog inspectionId={INSPECTION} moduleKey="packing_config" title={title} nameContext={title} onChanged={() => {}} />,
    );
    expect(html).toMatch(/^<button[^>]*data-action="switch-off"[^>]*>.*Switch Off<span class="sr-only"> [^<]+<\/span><\/button>$/);
    expect(html).toContain(`<span class="sr-only"> ${title}</span>`);
    // The hidden title is anchored to the button (docs/DESIGN.md, Do / Don't).
    expect(html).toMatch(/^<button[^>]*class="[^"]*\brelative\b/);
  });
});
