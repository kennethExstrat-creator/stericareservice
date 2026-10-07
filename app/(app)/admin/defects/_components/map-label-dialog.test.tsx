// The mapping form keeps its choices through a refused mapping: it is
// submitted by hand (lib/admin/submit.ts), never through a function `action`,
// which React resets after every action, sending "Map To" back to "An
// Existing Code" and the code back to none. The dialog is drawn in place here
// (a portal draws nothing on the server); e2e/defects refuses a new code in
// the browser and checks the choice stays.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { InspectionLabels, OneOffLabel } from "@/lib/admin/defects";
import { radioNames } from "../../_components/radio-card.testing";

vi.mock("../actions", () => ({ mapDefectLabel: vi.fn() }));
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

import { MapLabelDialog } from "./map-label-dialog";

/** What React draws for `<form action={fn}>` on the server: such a form is reset after every action. */
const FUNCTION_ACTION = "React form unexpectedly submitted";

const label: OneOffLabel = {
  id: "inspection-1:visual:major:torn cuff",
  module: "visual",
  kind: "unmapped",
  defectClass: "major",
  label: "Torn cuff",
  places: [{ size: "M", hand: null, count: 2 }],
  count: 2,
  suggestions: ["stain"],
  listed: ["stain"],
  newCode: "torn_cuff",
};

const inspection: InspectionLabels = {
  id: "1b4e28ba-2fa1-4d2b-9f3a-1c2d3e4f5a6b",
  refNo: "INS-2026-0001",
  status: "submitted",
  inspectionDate: "2026-10-07",
  inspector: "Test Inspector",
  template: { id: "2c5f39cb-3ab2-4e3c-8a4b-2d3e4f5a6b7c", code: "STD_EG", version: 1 },
  sizes: [{ value: "M" }],
  labels: [label],
};

function draw(): string {
  return renderToStaticMarkup(
    <MapLabelDialog
      inspection={inspection}
      label={label}
      codes={[{ code: "stain", name: "Stain" }]}
      onClose={() => {}}
      returnFocus={() => {}}
    />,
  );
}

describe("MapLabelDialog", () => {
  it("names each Map To radio by its choice and describes it, so Chrome does not leave it unnamed", () => {
    expect(radioNames(draw())).toEqual([
      { name: "An Existing Code", description: "One of the active codes." },
      { name: "A New Code", description: "Add a code for this label first." },
    ]);
  });

  it("submits by hand, so a refused mapping never resets the mode or the code", () => {
    const html = draw();
    expect(html).toContain("<form");
    expect(html).not.toContain(FUNCTION_ACTION);
    // "Map To" is a radio group, an existing code to start with; the code a select sent with the form.
    expect(html).toMatch(/<button[^>]*role="radio"[^>]*aria-checked="true"[^>]*value="existing"/);
    expect(html).toContain('role="combobox"');
  });
});
