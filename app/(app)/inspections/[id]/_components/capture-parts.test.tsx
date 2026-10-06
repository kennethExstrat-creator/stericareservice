// The capture screen's parts as server-rendered markup: names, roles,
// states and wording. Behaviour in the browser (autosave, issue links,
// switching sections and modules) is covered by e2e/capture.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({
  saveCaptureData: vi.fn(),
  submitInspection: vi.fn(),
  switchModuleOff: vi.fn(),
  switchModuleOn: vi.fn(),
}));

import { SITE_NOTES, SIZE_TABLE, TEST_ADMIN_ID } from "@/lib/inspections/capture/__fixtures__/capture";
import type { CaptureSection } from "@/lib/inspections/capture/sections";
import { TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { makeTestContext } from "@/modules/_framework/testing";
import CaptureLoading from "../loading";
import { CaptureHeader } from "./capture-header";
import { CaptureNotices } from "./capture-notices";
import { FieldControl } from "./field-control";
import { formatOverrideTime, SwitchedOffPanel } from "./module-switch";
import { PhotoSlot } from "./photo-slot";
import { CustomModuleForm, FallbackModuleForm } from "./plain-forms";
import { SaveIndicator } from "./save-indicator";
import { SectionFrame } from "./section-frame";
import { nextTabIndex, SectionTabs, tabId } from "./section-tabs";

const noop = () => {};

/** Every opening tag that carries `attribute`. */
const tagsWith = (html: string, attribute: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<[^>]*${attribute}[^>]*>`, "g")), (match) => match[0]);

const SECTIONS: CaptureSection[] = [
  { kind: "module", key: "header", title: "Manufacturer Information", status: "info", summary: "", progress: "done", stub: false, errors: 0, warnings: 0 },
  { kind: "module", key: "glove_info", title: "Glove Information", status: "not_done", summary: "", progress: "in_progress", stub: false, errors: 0, warnings: 1 },
  { kind: "excluded", key: "packing_config", title: "Packing configuration", override: { reason: "Not ordered.", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" } },
  { kind: "module", key: "conclusion", title: "Conclusion", status: "not_done", summary: "", progress: "not_started", stub: false, errors: 1, warnings: 0 },
];

describe("SectionTabs", () => {
  const html = renderToStaticMarkup(
    <SectionTabs sections={SECTIONS} activeKey="glove_info" onSelect={noop} panelId="panel" idPrefix="cap" />,
  );

  it("is a tab list with one tab per section, the open one selected and in the tab order", () => {
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Sections"');
    const tabs = tagsWith(html, 'role="tab"');
    expect(tabs).toHaveLength(4);
    const selected = tabs.filter((tab) => tab.includes('aria-selected="true"'));
    expect(selected).toHaveLength(1);
    expect(selected[0]).toContain('data-section="glove_info"');
    expect(selected[0]).toContain('aria-controls="panel"');
    expect(selected[0]).toContain(`id="${tabId("cap", "glove_info")}"`);
    expect(tabs.filter((tab) => tab.includes('tabindex="0"'))).toHaveLength(1);
  });

  it("shows each included section's result chip and puts switched-off sections last, marked off", () => {
    expect(tagsWith(html, 'data-slot="result-chip"').map((chip) => /data-status="([a-z_]+)"/.exec(chip)?.[1])).toEqual([
      "info",
      "not_done",
      "not_done",
    ]);
    const order = tagsWith(html, 'role="tab"').map((tab) => /data-section="([a-z_]+)"/.exec(tab)?.[1]);
    expect(order).toEqual(["header", "glove_info", "conclusion", "packing_config"]);
    expect(html).toContain(", switched off for this inspection");
  });

  it("moves with arrow keys, Home and End, wrapping", () => {
    expect(nextTabIndex("ArrowRight", 3, 4)).toBe(0);
    expect(nextTabIndex("ArrowLeft", 0, 4)).toBe(3);
    expect(nextTabIndex("Home", 2, 4)).toBe(0);
    expect(nextTabIndex("End", 0, 4)).toBe(3);
    expect(nextTabIndex("Enter", 0, 4)).toBeNull();
    expect(nextTabIndex("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("SaveIndicator", () => {
  it("shows Saved, Saving and Offline (will sync) through SaveStatus", () => {
    expect(renderToStaticMarkup(<SaveIndicator status="saved" pendingUploads={null} />)).toContain("Saved");
    expect(renderToStaticMarkup(<SaveIndicator status="saving" pendingUploads={0} />)).toContain("Saving");
    expect(renderToStaticMarkup(<SaveIndicator status="offline" pendingUploads={0} />)).toContain("Offline (will sync)");
  });

  it("turns red with Not saved when saving needs the inspector, keeping the upload badge", () => {
    const html = renderToStaticMarkup(<SaveIndicator status="error" pendingUploads={2} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('data-state="error"');
    expect(html).toContain("Not saved");
    expect(html).toContain("photos waiting to upload");
  });
});

describe("CaptureNotices", () => {
  it("announces errors as alerts and the rest as status, each with its action", () => {
    const html = renderToStaticMarkup(
      <CaptureNotices
        notices={[
          { key: "submitted", tone: "lock", message: "Submitted for review: read-only.", action: <a href="/review">Open the review</a> },
          { key: "save-error", tone: "error", message: "Not saved. The server refused the data." },
        ]}
      />,
    );
    expect(tagsWith(html, 'data-notice="submitted"')[0]).toContain('role="status"');
    expect(tagsWith(html, 'data-notice="save-error"')[0]).toContain('role="alert"');
    expect(html).toContain("Open the review");
  });

  it("renders nothing without notices", () => {
    expect(renderToStaticMarkup(<CaptureNotices notices={[]} />)).toBe("");
  });
});

describe("PhotoSlot (placeholder)", () => {
  it("shows both photo buttons, switched off, and says when photos arrive", () => {
    const html = renderToStaticMarkup(<PhotoSlot inspectionId="i" moduleKey="glove_info" focus={{ size: "M" }} />);
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(2);
    expect(html).toContain("Take photo");
    expect(html).toContain("Add from library");
    expect(html).toContain("Photos arrive in the next build");
  });

  it("takes the photo build's props: no focus yet, and the screen's read-only state", () => {
    const html = renderToStaticMarkup(<PhotoSlot inspectionId="i" moduleKey="header" focus={null} readOnly />);
    expect(html).toContain('data-module="header"');
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(2);
  });
});

describe("CaptureHeader", () => {
  it("names the inspection, its template version and status, and who and what it is about", () => {
    const html = renderToStaticMarkup(
      <CaptureHeader
        heading={{
          refNo: "INS-2026-0001",
          status: "reopened",
          templateName: "Standard examination gloves",
          templateVersion: 3,
          clientName: "Client A",
          manufacturerLabel: "Manufacturer A · Factory 1",
          inspectionDate: "2026-10-06",
          inspectorName: "Inspector A",
        }}
      />,
    );
    expect(html).toMatch(/<h1[^>]*>.*INS-2026-0001/);
    expect(html).toContain("Standard examination gloves · v3");
    expect(html).toContain('data-status="reopened"');
    for (const fact of ["Client A", "Manufacturer A · Factory 1", "6 Oct 2026", "Inspector A"]) expect(html).toContain(fact);
  });
});

describe("SectionFrame", () => {
  it("is a region named by its heading, with the result, the summary and the footer", () => {
    const html = renderToStaticMarkup(
      <SectionFrame id="panel" title="Glove Information" status="not_done" summary="Missing: Glove colour." footer={<p>Footer</p>}>
        <p>Body</p>
      </SectionFrame>,
    );
    expect(html).toContain('aria-labelledby="panel-title"');
    expect(html).toMatch(/<h2 id="panel-title" tabindex="-1"[^>]*>Glove Information<\/h2>/);
    // Focused by Previous, Next and issue links: an opaque ring for keyboard users, never a halo.
    expect(tagsWith(html, 'id="panel-title"')[0]).toContain("focus-ring");
    expect(html).toContain("Not done");
    expect(html).toContain("Missing: Glove colour.");
    expect(html).toContain("<footer");
  });
});

describe("FieldControl", () => {
  it("takes numbers on the decimal keypad, with the unit, marked for issue links", () => {
    const html = renderToStaticMarkup(
      <FieldControl
        field={{ key: "indicativeWeight", segments: ["indicativeWeight"], label: "Indicative weight", type: "number", unit: "g" }}
        value={3.5}
        onChange={noop}
        readOnly={false}
        issuePath={["indicativeWeight"]}
      />,
    );
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('value="3.5"');
    expect(html).toContain(">g</span>");
    expect(html).toContain(`data-issue-path="${JSON.stringify(["indicativeWeight"]).replaceAll('"', "&quot;")}"`);
  });

  it("puts a number cell into its column, so Enter walks down it and a paste fills it", () => {
    const html = renderToStaticMarkup(
      <FieldControl
        variant="cell"
        cellLabel="Size M, Weight"
        field={{ key: "weight", segments: ["weight"], label: "Weight", type: "number", unit: "g", required: true }}
        value={null}
        onChange={noop}
        readOnly={false}
        issuePath={["sizes", "M", "weight"]}
        group="weight"
        error="Weight: must be more than 0 g."
      />,
    );
    const input = tagsWith(html, "data-enter-field")[0];
    expect(input).toContain('data-enter-group="weight"');
    expect(input).toContain('aria-label="Size M, Weight (g)"');
    expect(html).toContain("Weight: must be more than 0 g.");
    expect(html).toContain(`data-issue-path="${JSON.stringify(["sizes", "M", "weight"]).replaceAll('"', "&quot;")}"`);
  });

  it("labels text fields, says required, and shows a problem with the stored value", () => {
    const html = renderToStaticMarkup(
      <FieldControl
        field={{ key: "colour", segments: ["colour"], label: "Glove colour", type: "text", required: true }}
        value={null}
        onChange={noop}
        readOnly
        issuePath={["colour"]}
        error="Glove colour is required."
      />,
    );
    const input = tagsWith(html, 'data-slot="input"')[0];
    const id = /id="([^"]+)"/.exec(input)?.[1];
    expect(html).toContain(`for="${id}"`);
    expect(input).toContain("readOnly");
    expect(html).toContain("(required)");
    expect(html).toContain("Glove colour is required.");
    expect(input).toContain('aria-invalid="true"');
  });

  it("asks yes or no with a choice, and counts with a stepper", () => {
    const yesNo = renderToStaticMarkup(
      <FieldControl
        field={{ key: "sealIntact", segments: ["sealIntact"], label: "Seal intact", type: "yes_no" }}
        value={true}
        onChange={noop}
        readOnly={false}
        issuePath={["sealIntact"]}
      />,
    );
    expect(yesNo).toContain('role="radiogroup"');
    expect(yesNo).toContain('aria-label="Seal intact"');
    expect(yesNo).toMatch(/aria-checked="true"[^>]*>Yes</);
    expect(yesNo).toMatch(/aria-checked="false"[^>]*>No</);

    const counter = renderToStaticMarkup(
      <FieldControl
        field={{ key: "boxes", segments: ["boxes"], label: "Boxes", type: "counter" }}
        value={null}
        onChange={noop}
        readOnly={false}
        issuePath={["boxes"]}
      />,
    );
    expect(counter).toContain('aria-label="Boxes"');
    expect(counter).toContain("Not counted yet");
  });
});

describe("plain forms", () => {
  it("draws a module without its own form from its canonical paths, in the template's wording", () => {
    const html = renderToStaticMarkup(
      <FallbackModuleForm
        definition={TEST_REGISTRY.glove_info}
        data={{ indicativeWeight: null, colour: "Blue" }}
        config={{ fields: { indicativeWeight: true, colour: true } }}
        labels={{ indicativeWeight: "Indicative weight (size M)", colour: "Glove colour" }}
        issues={[]}
        focusPath={null}
        readOnly={false}
        onChange={noop}
      />,
    );
    expect(html).toContain("Indicative weight (size M)");
    expect(html).toContain('value="Blue"');
    expect(html).toContain("A simplified form");
    // One run of fields: Enter moves from one number to the next, a pasted column fills down.
    expect(html).toContain('data-slot="enter-group"');
  });

  it("draws a custom table with one row per ordered size only", () => {
    const html = renderToStaticMarkup(
      <CustomModuleForm
        custom={SIZE_TABLE}
        value={{ sizes: { M: { requirement: "≥ 240 mm" }, XL: { requirement: "kept" } } }}
        mappedValues={{}}
        context={makeTestContext({ sizes: ["S", "M"] })}
        issues={[]}
        focusPath={null}
        readOnly={false}
        onChange={noop}
        onMappedChange={noop}
        onFocusChange={noop}
      />,
    );
    expect(html.match(/<th scope="row"/g)).toHaveLength(2);
    expect(html).toContain('value="≥ 240 mm"');
    expect(html).not.toContain("kept");
    expect(html).toContain('aria-label="Size M, Requirement"');
  });

  it("asks for the order first when no size is ordered", () => {
    const html = renderToStaticMarkup(
      <CustomModuleForm
        custom={SIZE_TABLE}
        value={{}}
        mappedValues={{}}
        context={makeTestContext()}
        issues={[]}
        focusPath={null}
        readOnly={false}
        onChange={noop}
        onMappedChange={noop}
        onFocusChange={noop}
      />,
    );
    expect(html).toContain("No sizes ordered yet.");
  });

  it("shows a mapped field with its module's value", () => {
    const html = renderToStaticMarkup(
      <CustomModuleForm
        custom={SITE_NOTES}
        value={{ weather: "Dry" }}
        mappedValues={{ colourAgain: "Blue" }}
        context={makeTestContext()}
        issues={[]}
        focusPath={null}
        readOnly={false}
        onChange={noop}
        onMappedChange={noop}
        onFocusChange={noop}
      />,
    );
    expect(html).toContain('value="Dry"');
    expect(html).toContain('value="Blue"');
  });
});

describe("SwitchedOffPanel", () => {
  const override = { reason: "Not in this order.", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" };

  it("says why, who and when; admins can switch it back on", () => {
    const html = renderToStaticMarkup(
      <SwitchedOffPanel
        inspectionId="i"
        moduleKey="packing_config"
        title="Packing configuration"
        override={override}
        author="Admin A"
        canSwitch
        onChanged={noop}
      />,
    );
    expect(html).toContain("Packing configuration is switched off for this inspection.");
    expect(html).toContain("Not in this order.");
    expect(html).toContain("Switched off by Admin A on 6 Oct 2026, 16:00.");
    expect(html).toContain("Switch back on");
  });

  it("names no one when the inspector may not read the admin's name, and offers no switch", () => {
    const html = renderToStaticMarkup(
      <SwitchedOffPanel
        inspectionId="i"
        moduleKey="packing_config"
        title="Packing configuration"
        override={override}
        author={null}
        canSwitch={false}
        onChanged={noop}
      />,
    );
    expect(html).toContain("Switched off by an admin");
    expect(html).not.toContain("Switch back on");
  });

  it("formats the time in Malaysia, whatever the device", () => {
    expect(formatOverrideTime("2026-10-06T23:30:00.000Z")).toBe("7 Oct 2026, 07:30");
    expect(formatOverrideTime("not a time")).toBe("not a time");
  });
});

describe("CaptureLoading", () => {
  it("tells screen readers the inspection is opening", () => {
    const html = renderToStaticMarkup(<CaptureLoading />);
    expect(html).toContain('role="status"');
    expect(html).toContain("Opening the inspection…");
  });
});
