// The capture screen's parts as server-rendered markup: names, roles,
// states and wording. Behaviour in the browser (autosave, issue links,
// switching sections and modules) is covered by e2e/capture.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({
  saveCaptureData: vi.fn(),
  submitInspection: vi.fn(),
  switchModuleOff: vi.fn(),
  switchModuleOn: vi.fn(),
}));

import { SITE_NOTES, SIZE_TABLE, TEST_ADMIN_ID } from "@/lib/inspections/capture/__fixtures__/capture";
import { captureAccess } from "@/lib/inspections/capture/access";
import {
  AUDIT_LOG_KEY,
  capturePages,
  leadPagesFirst,
  REPORT_KEY,
  withAuditLog,
  withReport,
  withSourceDocuments,
  type CapturePage,
  type CaptureSection,
} from "@/lib/inspections/capture/sections";
import { SOURCE_DOCUMENTS_KEY, SOURCE_DOCUMENTS_TITLE } from "@/lib/inspections/source-documents";
import type { ValidationIssue } from "@/lib/validation";
import { TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { makeTestContext } from "@/modules/_framework/testing";
import CaptureLoading from "../loading";
import { CaptureHeader } from "./capture-header";
import { captureNotices, CaptureNotices, notOrderedNotice, submittedMessage, type CaptureNotice } from "./capture-notices";
import { FieldControl } from "./field-control";
import { TaskItem } from "./issues-sheet";
import { isLoadFailure, sectionFailure } from "./load-failure";
import { formatOverrideTime, SwitchedOffPanel } from "./module-switch";
import { CustomModuleForm, FallbackModuleForm } from "./plain-forms";
import { SaveIndicator } from "./save-indicator";
import { SectionErrorBoundary } from "./section-error-boundary";
import { PagePanel, SectionFrame } from "./section-frame";
import { SectionList, STEP_GROUP_LABEL } from "./section-list";
import { SubmitSummary } from "./submit-control";
import { nextTabIndex, SectionTabs, tabId } from "./section-tabs";
import { UnreadableData } from "./unreadable-data";
import { followStepGroup, initialStepGroup, stepGroupStorageKey } from "./use-step-group";

const noop = () => {};

/** Every opening tag that carries `attribute`. */
const tagsWith = (html: string, attribute: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<[^>]*${attribute}[^>]*>`, "g")), (match) => match[0]);

/** The packing module's title in the fixtures below. */
const PACKING_TITLE = "Packing Configuration";

/**
 * A step whose title and short name differ ("Dimensions", "Dimension"). Not
 * the header: General Information is on Source Documents' page, with no tab
 * or row of its own (Kenneth, 26 October 2026).
 */
const DIMENSIONS: CaptureSection = {
  kind: "module",
  key: "dimensions",
  title: "Dimensions",
  shortTitle: "Dimension",
  status: "info",
  summary: "",
  progress: "done",
  stub: false,
  errors: 0,
  warnings: 0,
};

const SECTIONS: CaptureSection[] = [
  DIMENSIONS,
  { kind: "module", key: "glove_info", title: "Glove Information", shortTitle: "Glove Information", status: "not_done", summary: "", progress: "in_progress", stub: false, errors: 0, warnings: 1 },
  { kind: "excluded", key: "packing_config", title: PACKING_TITLE, shortTitle: PACKING_TITLE, override: { reason: "Not ordered.", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" } },
  { kind: "module", key: "conclusion", title: "Conclusion", shortTitle: "Conclusion", status: "not_done", summary: "", progress: "not_started", stub: false, errors: 1, warnings: 0 },
];

/** The order filled in and packing configuration not adding up: one page, the order's, each module with its result. */
const ORDER_PAGE: CaptureSection[] = [
  DIMENSIONS,
  { kind: "module", key: "order_lots", title: "Order", shortTitle: "Order", status: "info", summary: "", progress: "done", stub: false, errors: 0, warnings: 0 },
  {
    kind: "module",
    key: "packing_config",
    title: PACKING_TITLE,
    shortTitle: PACKING_TITLE,
    status: "warn",
    summary: "",
    progress: "done",
    stub: false,
    shownWith: "order_lots",
    errors: 0,
    warnings: 1,
  },
  { kind: "module", key: "conclusion", title: "Conclusion", shortTitle: "Conclusion", status: "not_done", summary: "", progress: "not_started", stub: false, errors: 1, warnings: 0 },
];

describe("SectionTabs", () => {
  const html = renderToStaticMarkup(
    <SectionTabs pages={capturePages(SECTIONS)} activeKey="glove_info" onSelect={noop} panelId="panel" idPrefix="cap" />,
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
    // A section complete with nothing to pass or fail shows the tick (Kenneth, 26 October 2026), named Done.
    expect(tagsWith(html, 'data-slot="result-chip"').map((chip) => /data-status="([a-z_]+)"/.exec(chip)?.[1])).toEqual([
      "pass",
      "not_done",
      "not_done",
    ]);
    const order = tagsWith(html, 'role="tab"').map((tab) => /data-section="([a-z_]+)"/.exec(tab)?.[1]);
    expect(order).toEqual(["dimensions", "glove_info", "conclusion", "packing_config"]);
    expect(html).toContain(", switched off for this inspection");
  });

  it("puts the Audit Log after the Conclusion, before the switched-off sections, with no result chip (Kenneth, 26 October 2026)", () => {
    const markup = renderToStaticMarkup(
      <SectionTabs pages={withAuditLog(capturePages(SECTIONS))} activeKey={AUDIT_LOG_KEY} onSelect={noop} panelId="panel" idPrefix="cap" />,
    );
    const tabs = tagsWith(markup, 'role="tab"');
    expect(tabs.map((tab) => /data-section="([a-z_]+)"/.exec(tab)?.[1])).toEqual([
      "dimensions",
      "glove_info",
      "conclusion",
      AUDIT_LOG_KEY,
      "packing_config",
    ]);
    const audit = tabs[3];
    expect(audit).toContain('aria-selected="true"');
    expect(audit).toContain('title="Audit Log"');
    expect(audit).not.toContain("data-excluded");
    // The three steps' chips only: the Audit Log has no result.
    expect(tagsWith(markup, 'data-slot="result-chip"')).toHaveLength(3);
    expect(markup).toMatch(/data-section="audit_log"(?:(?!<\/button>).)*>Audit Log<\/span><\/button>/);
  });

  it("puts the Report page after the Conclusion and before the Audit Log, with no result chip (Kenneth, 27 October 2026)", () => {
    const markup = renderToStaticMarkup(
      <SectionTabs pages={withAuditLog(withReport(capturePages(SECTIONS)))} activeKey={REPORT_KEY} onSelect={noop} panelId="panel" idPrefix="cap" />,
    );
    const tabs = tagsWith(markup, 'role="tab"');
    expect(tabs.map((tab) => /data-section="([a-z_]+)"/.exec(tab)?.[1])).toEqual([
      "dimensions",
      "glove_info",
      "conclusion",
      REPORT_KEY,
      AUDIT_LOG_KEY,
      "packing_config",
    ]);
    const report = tabs[3];
    expect(report).toContain('aria-selected="true"');
    expect(report).toContain('aria-controls="panel"');
    expect(report).toContain(`id="${tabId("cap", REPORT_KEY)}"`);
    expect(report).toContain('title="Report"');
    expect(report).not.toContain("data-excluded");
    // The three steps' chips only: neither the Report page nor the Audit Log has a result.
    expect(tagsWith(markup, 'data-slot="result-chip"')).toHaveLength(3);
    expect(markup).toMatch(/data-section="report"(?:(?!<\/button>).)*lucide-file-text(?:(?!<\/button>).)*>Report<\/span><\/button>/);
  });

  it("names each tab by its short name, with its full title on hover (docs/DESIGN.md, Step Names)", () => {
    const dimensions = tagsWith(html, 'role="tab"').find((tab) => tab.includes('data-section="dimensions"')) ?? "";
    expect(dimensions).toContain('title="Dimensions"');
    expect(html).toMatch(/data-section="dimensions"[^>]*>(?:(?!<\/button>).)*>Dimension<\/span>/);
    expect(html).not.toContain(">Dimensions<");
    // A switched-off tab too.
    expect(tagsWith(html, 'role="tab"').find((tab) => tab.includes('data-section="packing_config"'))).toContain(
      `title="${PACKING_TITLE}"`,
    );
  });

  it("gives the order's page one tab, named by the order, with the worst result of the two and both keys", () => {
    const order = renderToStaticMarkup(
      <SectionTabs pages={capturePages(ORDER_PAGE)} activeKey="order_lots" onSelect={noop} panelId="panel" idPrefix="cap" />,
    );
    const tabs = tagsWith(order, 'role="tab"');
    expect(tabs.map((tab) => /data-sections="([a-z_ ]+)"/.exec(tab)?.[1])).toEqual([
      "dimensions",
      "order_lots packing_config",
      "conclusion",
    ]);
    const tab = tabs[1];
    expect(tab).toContain('data-section="order_lots"');
    expect(tab).toContain('aria-selected="true"');
    expect(tab).toContain(`id="${tabId("cap", "order_lots")}"`);
    expect(order).toMatch(/<button[^>]*data-section="order_lots"[^>]*>(?:(?!<\/button>).)*>Order<\/span>(?:(?!<\/button>).)*data-status="warn"/);
    expect(order).not.toContain(PACKING_TITLE);
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

describe("TaskItem (the Pending panel)", () => {
  const issue: ValidationIssue = { level: "warning", moduleKey: "weight", code: "module_not_done", message: "x", path: [] };
  const weight = renderToStaticMarkup(
    <TaskItem
      task={{
        key: "weight",
        title: "Weight",
        linkable: true,
        needed: false,
        status: "6 sizes not done",
        sizes: ["XS", "S", "M", "L", "XL", "XXL"],
        more: 1,
        first: issue,
      }}
      onGo={noop}
    />,
  );
  const needed = renderToStaticMarkup(
    <TaskItem
      task={{
        key: "conclusion",
        title: "Conclusion",
        linkable: true,
        needed: true,
        status: "Final result and date",
        sizes: [],
        more: 0,
        first: { ...issue, level: "error", moduleKey: "conclusion" },
      }}
      onGo={noop}
    />,
  );
  const text = (html: string) => html.replace(/<[^>]+>/g, "");

  it("is a button named with its section, status and sizes, showing the title over one short line", () => {
    expect(weight).toMatch(/^<button type="button"/);
    expect(weight).toContain('aria-label="Weight: 6 sizes not done: XS, S, M, L, XL and XXL, and 1 more."');
    expect(text(weight)).toBe("Weight6 sizes not doneXSSMLXL+1· 1 more");
    // One line: the status line never wraps, and long text is cut rather than pushed to a second line.
    expect(weight).toMatch(/data-slot="task-status"[^>]*class="[^"]*\bwhitespace-nowrap\b[^"]*\boverflow-hidden\b|data-slot="task-status"[^>]*class="[^"]*\boverflow-hidden\b[^"]*\bwhitespace-nowrap\b/);
    expect(weight).not.toContain("data-needed");
  });

  it("marks what submit needs with a brand circle, read out as needed before you submit", () => {
    expect(needed).toContain('aria-label="Conclusion: Final result and date. Needed before you submit."');
    expect(needed).toContain("data-needed");
    expect(needed).toMatch(/lucide-circle[^"]*text-primary/);
    expect(weight).toMatch(/lucide-circle[^"]*text-control/);
  });

  it("looks like a task, not a warning: a checklist circle, no red or amber", () => {
    for (const html of [weight, needed]) {
      expect(html).toContain("lucide-circle");
      expect(html).not.toMatch(/\b(text|bg|border)-(fail|warn)\b/);
      expect(html).not.toMatch(/lucide-(triangle-alert|circle-x)/);
    }
  });

  it("notes a section switched off in Title Case after its title, read out the same, and links nowhere", () => {
    const html = renderToStaticMarkup(
      <TaskItem
        task={{
          key: "packing_config",
          title: PACKING_TITLE,
          linkable: false,
          needed: true,
          status: "Not done yet",
          sizes: [],
          more: 0,
          first: { ...issue, level: "error", moduleKey: "packing_config" },
        }}
        onGo={noop}
      />,
    );
    expect(html).toMatch(/^<div role="group"/);
    expect(text(html)).toBe(`${PACKING_TITLE} (Switched Off)Not done yet`);
    expect(html).toContain(`aria-label="${PACKING_TITLE} (Switched Off): Not done yet. Needed before you submit."`);
  });
});

// The pill's words are the kit's (components/qc/save-status.tsx).
describe("SaveIndicator", () => {
  it("shows Saved, Saving and Offline (Will Sync) through SaveStatus", () => {
    expect(renderToStaticMarkup(<SaveIndicator status="saved" inspectionId="i" />)).toContain("Saved");
    expect(renderToStaticMarkup(<SaveIndicator status="saving" inspectionId="i" />)).toContain("Saving");
    expect(renderToStaticMarkup(<SaveIndicator status="offline" inspectionId="i" />)).toContain("Offline (Will Sync)");
  });

  it("says Not Saved in the kit's own red pill when saving needs the inspector", () => {
    const html = renderToStaticMarkup(<SaveIndicator status="error" inspectionId="i" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('data-state="error"');
    expect(html).toContain("Not Saved");
  });

  it("carries the upload badge, unknown rather than 0 until this device's queue is read", () => {
    const html = renderToStaticMarkup(<SaveIndicator status="saved" inspectionId="i" />);
    expect(tagsWith(html, 'data-slot="upload-badge"')[0]).toContain('data-state="checking"');
    expect(html).toContain("Checking for photos waiting on this device");
  });
});

describe("UnreadableData", () => {
  const definition = TEST_REGISTRY.glove_info;
  const tooHeavy = { path: ["indicativeWeight"], message: "Glove Information: Indicative weight is not a number." };
  const issue = (path: (string | number)[], message: string) =>
    ({ moduleKey: "glove_info", code: "invalid_data", level: "error", path, message }) as const;

  it("lists each value that cannot be read, as the checks word it, where an issue link lands", () => {
    const html = renderToStaticMarkup(
      <UnreadableData
        definition={definition}
        entry={{ value: { indicativeWeight: "2 42", colour: "Blue" }, comment: null, hasData: true }}
        issues={[issue(tooHeavy.path, tooHeavy.message)]}
        fallback={undefined}
        focusPath={null}
        readOnly={false}
        onRemove={noop}
      />,
    );
    expect(html).toContain("A value saved for this section cannot be read.");
    expect(html).toContain(tooHeavy.message);
    expect(tagsWith(html, "data-issue-path")[0]).toContain('tabindex="-1"');
    expect(html).toContain("Remove the Values That Cannot Be Read");
    expect(html).toContain("Everything else here is kept.");
  });

  it("reads its button out with its section's title on a page of two, and with its words alone otherwise", () => {
    const entry = { value: { indicativeWeight: "2 42", colour: "Blue" }, comment: null, hasData: true };
    const props = {
      definition,
      entry,
      issues: [issue(tooHeavy.path, tooHeavy.message)],
      fallback: undefined,
      focusPath: null,
      readOnly: false,
      onRemove: noop,
    };
    const named = renderToStaticMarkup(<UnreadableData {...props} nameContext="Glove Information" />);
    // Anchored, so the hidden title never escapes (docs/DESIGN.md, Do / Don't).
    expect(named).toMatch(
      /<button[^>]*class="[^"]*\brelative\b[^"]*"[^>]*>(?:(?!<\/button>).)*Remove the Values That Cannot Be Read<span class="sr-only">, Glove Information<\/span><\/button>/,
    );
    expect(renderToStaticMarkup(<UnreadableData {...props} />)).toContain("Remove the Values That Cannot Be Read</button>");
  });

  it("shows read-only viewers the list only", () => {
    const html = renderToStaticMarkup(
      <UnreadableData
        definition={definition}
        entry={{ value: { indicativeWeight: "2 42" }, comment: null, hasData: true }}
        issues={[]}
        fallback={{ path: ["indicativeWeight"], message: "Invalid input: expected number, received string" }}
        focusPath={null}
        readOnly
        onRemove={noop}
      />,
    );
    expect(html).toContain("indicativeWeight: Invalid input: expected number, received string");
    expect(html).not.toContain("<button");
  });
});

describe("CaptureNotices", () => {
  it("announces errors as alerts and the rest as status, each with its action", () => {
    const html = renderToStaticMarkup(
      <CaptureNotices
        notices={[
          { key: "submitted", tone: "lock", message: "Submitted for review: read-only.", action: <a href="/review">Open the Review</a> },
          { key: "save-error", tone: "error", message: "Not saved. The server refused the data." },
        ]}
      />,
    );
    expect(tagsWith(html, 'data-notice="submitted"')[0]).toContain('role="status"');
    expect(tagsWith(html, 'data-notice="save-error"')[0]).toContain('role="alert"');
    expect(html).toContain("Open the Review");
  });

  it("renders nothing without notices", () => {
    expect(renderToStaticMarkup(<CaptureNotices notices={[]} />)).toBe("");
  });
});

describe("notOrderedNotice (a step's values for sizes not on the order; Kenneth, 27 October 2026)", () => {
  const order = { title: "Order", href: "/inspections/x?module=order_lots", open: noop };
  const render = (notice: CaptureNotice | null) => (notice ? renderToStaticMarkup(<CaptureNotices notices={[notice]} />) : "");
  const text = (html: string) => html.replace(/<[^>]+>/g, "");
  const linkOf = (html: string) => tagsWith(html, "href=")[0] ?? "";

  it("names the size in the warning's amber, with Open Order to the order's page", () => {
    const html = render(notOrderedNotice({ sizes: ["L"], order, canAdd: true }));
    const box = tagsWith(html, 'data-notice="sizes-not-ordered"')[0];
    expect(box).toContain('role="status"');
    expect(box).toMatch(/\bborder-warn-border\b.*\bbg-warn-tint\b.*\btext-warn\b/);
    expect(html).toContain("lucide-triangle-alert");
    expect(text(html)).toBe("Saved for size L, which is not on the order: add L on the Order page to see it.Open Order");
    expect(linkOf(html)).toContain('href="/inspections/x?module=order_lots"');
  });

  it("names several sizes by the order's names for them, and the order's page by its short name", () => {
    const html = render(
      notOrderedNotice({
        sizes: ["L", "XL"],
        sizeName: (size) => (size === "L" ? "Large" : "Extra Large"),
        order: { ...order, title: "PO Info" },
        canAdd: true,
      }),
    );
    expect(text(html)).toBe(
      "Saved for sizes Large and Extra Large, which are not on the order: add Large and Extra Large on the PO Info page to see them.Open PO Info",
    );
  });

  it("is none while every size it holds is ordered", () => {
    expect(notOrderedNotice({ sizes: [], order, canAdd: true })).toBeNull();
  });

  it("opens the order on this screen, at the first size's quantity, never as a new request", () => {
    const open = vi.fn();
    const notice = notOrderedNotice({ sizes: ["L", "XL"], order: { ...order, open }, canAdd: true });
    type Navigate = { onNavigate: (event: { preventDefault: () => void }) => void; prefetch: boolean };
    const link = (notice?.action as ReactElement<{ children: ReactElement<Navigate> }>).props.children;
    expect(link.props.prefetch).toBe(false);
    const preventDefault = vi.fn();
    link.props.onNavigate({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith("L");
  });

  it("read-only, names the sizes alone and still opens the order's page; with no order page, has no button", () => {
    const readOnly = render(notOrderedNotice({ sizes: ["L"], order, canAdd: false }));
    expect(text(readOnly)).toBe("Saved for size L, which is not on the order.Open Order");
    expect(linkOf(readOnly)).toContain('href="/inspections/x?module=order_lots"');
    const nowhere = render(notOrderedNotice({ sizes: ["L"], order: null, canAdd: true }));
    expect(text(nowhere)).toBe("Saved for size L, which is not on the order.");
    expect(nowhere).not.toContain("<a");
  });

  it("gives Open Order 44 px on a touchscreen and a compact pill with a mouse", () => {
    const link = linkOf(render(notOrderedNotice({ sizes: ["L"], order, canAdd: true })));
    expect(link).toContain('data-size="sm"');
    expect(link).toMatch(/\bh-8\b/);
    expect(link).toMatch(/\btouch:h-11\b/);
  });
});

describe("captureNotices (who reads a read-only inspection)", () => {
  const INSPECTOR = "00000000-0000-4000-8000-000000000101";
  const LEAD = "00000000-0000-4000-8000-000000000103";
  const notice = (status: "submitted" | "approved" | "draft", role: "inspector" | "admin", userId: string) =>
    captureNotices({
      access: captureAccess({ status, role, userId, inspectorId: INSPECTOR }),
      role,
      inspectorName: "Ivan Inspector",
      reviewHref: "/inspections/x/review",
      lockedElsewhere: false,
      reopenNote: null,
      phase: "off",
      setAside: false,
      error: null,
      localCopy: true,
      pending: false,
      retry: noop,
      signInHref: "/login",
    })[0];

  it("tells the inspector an admin can send their own submitted inspection back", () => {
    expect(notice("submitted", "inspector", INSPECTOR)).toMatchObject({
      key: "submitted",
      message: "Submitted for review: read-only. An admin can send it back to you for changes.",
    });
  });

  it("tells a lead whose submitted inspection it is, never that it can be sent back to them", () => {
    const lead = notice("submitted", "inspector", LEAD);
    expect(lead).toMatchObject({ key: "submitted", message: "Submitted for review by Ivan Inspector: read-only." });
    expect(String(lead.message)).not.toContain("back to you");
    expect(renderToStaticMarkup(<>{lead.action}</>)).toContain("Open the Review");
    expect(submittedMessage({ role: "inspector", own: false, inspectorName: " " })).toBe(
      "Submitted for review by another inspector: read-only.",
    );
  });

  it("keeps the admin's wording, and a team member's draft says it belongs to another inspector", () => {
    expect(notice("submitted", "admin", LEAD).message).toBe(
      "Submitted for review: read-only here. To change it, reopen it from the review.",
    );
    expect(notice("draft", "inspector", LEAD)).toMatchObject({
      key: "not-yours",
      message: "This inspection belongs to another inspector: read-only.",
    });
    expect(notice("approved", "inspector", LEAD).message).toBe("Approved: this inspection is read-only.");
  });

  // Roles and permissions (migration 20261027150000): an admin-level role that does not approve or reopen.
  it("tells no role without Approve and Reopen to reopen it", () => {
    expect(submittedMessage({ role: "admin", own: false, inspectorName: "Ivan Inspector", canReopen: false })).toBe(
      "Submitted for review by Ivan Inspector: read-only.",
    );
  });
});

describe("SubmitSummary (the submit confirmation)", () => {
  const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  it("names the result in DESIGN.md's words, with nothing repeating it for a clean pass", () => {
    const html = renderToStaticMarkup(<SubmitSummary suggested={{ result: "pass", reasons: [] }} warningCount={0} />);
    expect(text(html)).toBe("Suggested Result Passed");
    expect(html).not.toContain('data-slot="suggested-reasons"');
    expect(html).not.toMatch(/>Pass\.?</);
  });

  it("says why under the pill, a line each, as the Conclusion section words it (submitReasons: short names)", () => {
    const html = renderToStaticMarkup(
      <SubmitSummary suggested={{ result: "pass", reasons: ["Warnings: Weight."] }} warningCount={1} />,
    );
    expect(text(html)).toBe("Suggested Result Passed Why Warnings: Weight. Warnings 1 warning goes into the report.");
    expect(text(renderToStaticMarkup(<SubmitSummary suggested={{ result: "hold", reasons: ["Not done: Visual Inspection."] }} warningCount={0} />))).toBe(
      "Suggested Result On Hold Why Not done: Visual Inspection.",
    );
    expect(text(renderToStaticMarkup(<SubmitSummary suggested={{ result: "fail", reasons: [] }} warningCount={0} />))).toBe(
      "Suggested Result Failed",
    );
  });
});

describe("SectionErrorBoundary (a section's form that did not show)", () => {
  const chunkError = Object.assign(new Error("Failed to load chunk /_next/static/chunks/abc.js from module 123"), {
    name: "ChunkLoadError",
  });
  const shown = (error: Error, online: boolean) => {
    const boundary = new SectionErrorBoundary({ title: "Visual Inspection", children: <p>Form</p> });
    boundary.state = { error, online };
    return renderToStaticMarkup(<>{boundary.render()}</>);
  };

  it("tells a form that could not download from one that crashed", () => {
    expect(isLoadFailure(chunkError)).toBe(true);
    expect(isLoadFailure(new TypeError("Failed to fetch dynamically imported module: https://x/_next/a.js"))).toBe(true);
    expect(isLoadFailure(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isLoadFailure(new TypeError("Cannot read properties of undefined (reading 'sizes')"))).toBe(false);
    expect(isLoadFailure("Failed to load chunk")).toBe(false);
    expect(sectionFailure(chunkError, false)).toBe("offline");
    expect(sectionFailure(new Error("boom"), false)).toBe("offline");
    expect(sectionFailure(chunkError, true)).toBe("not_loaded");
    expect(sectionFailure(new Error("boom"), true)).toBe("crashed");
  });

  it("says calmly that an offline section opens once the connection is back: no red, no developer", () => {
    const html = shown(chunkError, false);
    expect(html).toContain('role="status"');
    expect(html).toContain('data-failure="offline"');
    expect(html).toContain("This section opens once the connection is back.");
    expect(html).toContain("Nothing is lost.");
    expect(html).toContain("Try Again");
    expect(html).not.toMatch(/\b(text|bg|border)-fail/);
    expect(html).not.toContain("developer");
    expect(html).not.toContain("Reload");
  });

  it("offers Try Again and Reload for a download that failed online", () => {
    const html = shown(chunkError, true);
    expect(html).toContain('data-failure="not_loaded"');
    expect(html).toContain("The form for Visual Inspection did not load.");
    expect(html).toContain("Reload");
    expect(html).not.toContain("developer");
  });

  it("reads Try Again out with its section's title on a page of two, where the other form may not show either", () => {
    const boundary = new SectionErrorBoundary({ title: PACKING_TITLE, nameContext: PACKING_TITLE, children: <p>Form</p> });
    boundary.state = { error: chunkError, online: false };
    const html = renderToStaticMarkup(<>{boundary.render()}</>);
    expect(html).toMatch(
      /<button[^>]*class="[^"]*\brelative\b[^"]*"[^>]*>(?:(?!<\/button>).)*Try Again<span class="sr-only">, Packing Configuration<\/span><\/button>/,
    );
    expect(shown(chunkError, false)).toContain("Try Again</button>");
  });

  it("keeps the red alert for a form that crashed", () => {
    const html = shown(new TypeError("Cannot read properties of undefined"), true);
    expect(html).toContain('role="alert"');
    expect(html).toContain("The form for Visual Inspection could not be shown.");
    expect(html).toContain("report this to a developer");
  });

  it("shows the form while nothing failed", () => {
    expect(renderToStaticMarkup(<SectionErrorBoundary title="Visual Inspection">{<p>Form</p>}</SectionErrorBoundary>)).toBe(
      "<p>Form</p>",
    );
  });
});

describe("SectionList (the desktop sidebar)", () => {
  const long: CaptureSection[] = [
    { kind: "module", key: "dispensing_safedon", title: "Glove Dispensing Inspection", shortTitle: "Dispensing", status: "not_done", summary: "", progress: "not_started", stub: false, errors: 0, warnings: 0 },
    // A custom step's own title, as long as it is (no short name listed for it).
    { kind: "custom", key: "onsite", title: "Glove Dispensing Inspection: onsite notes", shortTitle: "Glove Dispensing Inspection: onsite notes", status: "not_done", summary: "", progress: "not_started", custom: { key: "onsite", title: "Glove Dispensing Inspection: onsite notes", after: "dispensing_safedon", layout: "fields", fields: [] }, errors: 0, warnings: 0 },
    { kind: "excluded", key: "labeling", title: "Packaging Labeling Inspection", shortTitle: "Labeling", override: { reason: "Not ordered.", by: TEST_ADMIN_ID, at: "2026-10-06T08:00:00.000Z" } },
  ];
  const html = renderToStaticMarkup(<SectionList pages={capturePages(long)} activeKey="onsite" onSelect={noop} />);
  /** The rows' titles, the Inspection Steps header (no title) left out. */
  const rowTitles = (markup: string) =>
    tagsWith(markup, `type="button"`)
      .filter((button) => !button.includes("aria-expanded"))
      .map((button) => /title="([^"]*)"/.exec(button)?.[1]);

  it("wraps a long title to two lines instead of cutting it to one, and names it in full on hover", () => {
    const buttons = tagsWith(html, `type="button"`);
    // The two steps' group header, its two rows and the switched-off row.
    expect(buttons).toHaveLength(4);
    expect(rowTitles(html)).toEqual([
      "Glove Dispensing Inspection",
      "Glove Dispensing Inspection: onsite notes",
      "Packaging Labeling Inspection",
    ]);
    // Rows grow from their 36 px (44 px on touch) instead of clipping the second line.
    for (const button of buttons) {
      expect(button).toMatch(/\bmin-h-9\b/);
      expect(button).toMatch(/touch:min-h-11/);
      expect(button).not.toMatch(/[\s"]h-9[\s"]/);
    }
    expect(html).toMatch(/class="line-clamp-2[^"]*">Glove Dispensing Inspection: onsite notes</);
    expect(html).not.toMatch(/\btruncate\b/);
  });

  it("names each row by its short name, a switched-off row too, with the full title on hover (docs/DESIGN.md, Step Names)", () => {
    expect(html).toMatch(/title="Glove Dispensing Inspection"[^>]*>(?:(?!<\/button>).)*class="line-clamp-2[^"]*">Dispensing</);
    expect(html).toMatch(/title="Packaging Labeling Inspection"[^>]*>(?:(?!<\/button>).)*class="line-clamp-2[^"]*">Labeling</);
    expect(html).not.toContain(">Glove Dispensing Inspection<");
    expect(html).not.toContain(">Packaging Labeling Inspection<");
  });

  it("marks each step's row with its key, for specs (data-step); a switched-off row keeps data-section", () => {
    expect(tagsWith(html, "data-step=").map((row) => /data-step="([a-z_]+)"/.exec(row)?.[1])).toEqual(["dispensing_safedon", "onsite"]);
    expect(tagsWith(html, 'data-section="labeling"')).toHaveLength(1);
  });

  it("lists the Audit Log under the Conclusion, a row with no progress or result, before the switched-off rows (Kenneth, 26 October 2026)", () => {
    const markup = renderToStaticMarkup(<SectionList pages={withAuditLog(capturePages(long))} activeKey={AUDIT_LOG_KEY} onSelect={noop} />);
    expect(rowTitles(markup)).toEqual([
      "Glove Dispensing Inspection",
      "Glove Dispensing Inspection: onsite notes",
      "Audit Log",
      "Packaging Labeling Inspection",
    ]);
    // Not a step: no data-step, no result chip, and the progress count leaves it out.
    expect(markup).not.toContain('data-step="audit_log"');
    expect(markup).toMatch(/<li aria-current="page"><button type="button" data-section="audit_log" title="Audit Log"/);
    expect(markup).not.toMatch(/data-section="audit_log"(?:(?!<\/button>).)*data-slot="result-chip"/);
  });

  it("lists the Report page under the Conclusion, above the Audit Log, a row with no progress or result (Kenneth, 27 October 2026)", () => {
    const markup = renderToStaticMarkup(
      <SectionList pages={withAuditLog(withReport(capturePages(long)))} activeKey={REPORT_KEY} onSelect={noop} />,
    );
    expect(rowTitles(markup)).toEqual([
      "Glove Dispensing Inspection",
      "Glove Dispensing Inspection: onsite notes",
      "Report",
      "Audit Log",
      "Packaging Labeling Inspection",
    ]);
    expect(markup).not.toContain('data-step="report"');
    expect(markup).toMatch(/<li aria-current="page"><button type="button" data-section="report" title="Report"/);
    expect(markup).toMatch(/data-section="report"(?:(?!<\/button>).)*lucide-file-text/);
    expect(markup).not.toMatch(/data-section="report"(?:(?!<\/button>).)*data-slot="result-chip"/);
  });

  it("lists the order's page once, under the order's title, with the worst result of the two", () => {
    const order = renderToStaticMarkup(<SectionList pages={capturePages(ORDER_PAGE)} activeKey="order_lots" onSelect={noop} />);
    expect(rowTitles(order)).toEqual(["Dimensions", "Order", "Conclusion"]);
    expect(order).toMatch(/title="Dimensions"[^>]*>(?:(?!<\/button>).)*>Dimension<\/span>/);
    expect(order).toMatch(/title="Order"(?:(?!<\/button>).)*data-status="warn"/);
    expect(order).not.toContain(PACKING_TITLE);
  });

  describe("Inspection Steps: the steps between the lead pages and the Conclusion, in a group that collapses", () => {
    // General Information is on Source Documents' page, no row of its own (Kenneth, 26 October 2026).
    const header: CaptureSection = {
      kind: "module",
      key: "header",
      title: "General Information",
      shortTitle: "General Information",
      status: "info",
      summary: "",
      progress: "done",
      stub: false,
      errors: 0,
      warnings: 0,
    };
    // Glove Information besides Dimensions: the order is a lead page now, and one step makes no group.
    const glove: CaptureSection = {
      kind: "module",
      key: "glove_info",
      title: "Glove Information",
      shortTitle: "Glove Information",
      status: "warn",
      summary: "",
      progress: "done",
      stub: false,
      errors: 0,
      warnings: 1,
    };
    const pages: CapturePage[] = withSourceDocuments(
      { key: SOURCE_DOCUMENTS_KEY, title: SOURCE_DOCUMENTS_TITLE, shortTitle: SOURCE_DOCUMENTS_TITLE, status: "pass", progress: "done" },
      leadPagesFirst(capturePages([header, ORDER_PAGE[0], glove, ...ORDER_PAGE.slice(1)])),
    );
    const list = (activeKey: string) =>
      renderToStaticMarkup(<SectionList pages={pages} activeKey={activeKey} onSelect={noop} viewerId={TEST_ADMIN_ID} />);
    /** The group's header and the list of its steps it controls. */
    const group = (markup: string) => {
      const header = tagsWith(markup, "aria-expanded")[0] ?? "";
      const id = (/aria-controls="([^"]+)"/.exec(header)?.[1] ?? "missing").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const steps = new RegExp(`<ol id="${id}"[^>]*>[\\s\\S]*?</ol>`).exec(markup)?.[0] ?? "";
      return { header, steps, button: /<button[^>]*aria-expanded[\s\S]*?<\/button>/.exec(markup)?.[0] ?? "" };
    };

    it("is collapsed by default, on Source Documents and on the Conclusion; the lead pages show outside it", () => {
      for (const activeKey of [SOURCE_DOCUMENTS_KEY, "conclusion"]) {
        const markup = list(activeKey);
        const { header, steps, button } = group(markup);
        expect(header).toContain('aria-expanded="false"');
        expect(steps).toMatch(/^<ol [^>]*hidden=""/);
        expect(steps).toContain('title="Dimensions"');
        expect(steps).toContain('title="Glove Information"');
        // The order comes straight after Source Documents, outside the group (Kenneth, 26 October 2026).
        expect(steps).not.toContain('title="Order"');
        expect(steps).not.toContain(SOURCE_DOCUMENTS_TITLE);
        expect(steps).not.toContain('title="Conclusion"');
        // General Information has no row: it is on Source Documents' page.
        expect(rowTitles(markup)).toEqual([SOURCE_DOCUMENTS_TITLE, "Order", "Dimensions", "Glove Information", "Conclusion"]);
        expect(markup).not.toContain('data-step="header"');
        // Its title, how many of its steps are done and the worst of their results (the glove information's warning).
        expect(button).toContain(`>${STEP_GROUP_LABEL}<`);
        expect(button).toContain("2 of 2 done");
        expect(button).toContain('data-status="warn"');
      }
    });

    it("opens when the page in view is one of its steps", () => {
      const { header, steps } = group(list("glove_info"));
      expect(header).toContain('aria-expanded="true"');
      expect(steps).not.toMatch(/^<ol [^>]*hidden/);
      expect(steps).toMatch(/<li aria-current="step"><button[^>]*title="Glove Information"/);
    });

    it("follows the open page: a step of it opening opens it, Source Documents or the Conclusion leave it as it is", () => {
      const collapsed = initialStepGroup(SOURCE_DOCUMENTS_KEY, false);
      expect(collapsed.open).toBe(false);
      // Next from the last lead page (or an issue link, the iPad's swipe) lands on a step: it opens.
      const landed = followStepGroup(collapsed, "dimensions", true, null);
      expect(landed.open).toBe(true);
      // On to the Conclusion: nothing moves under the pointer.
      expect(followStepGroup(landed, "conclusion", false, null).open).toBe(true);
      // Collapsed by choice on a step, then the next step: it opens again on it.
      expect(followStepGroup({ ...landed, open: false }, "glove_info", true, null).open).toBe(true);
      // Nothing changed: the same state.
      expect(followStepGroup(landed, "dimensions", true, null)).toBe(landed);
    });

    it("starts from the viewer's last choice, kept per user, unless the page in view is one of its steps", () => {
      expect(stepGroupStorageKey(TEST_ADMIN_ID)).toBe(`stericare:capture-steps:${TEST_ADMIN_ID}`);
      // The stored choice arrives after hydration.
      expect(followStepGroup(initialStepGroup(SOURCE_DOCUMENTS_KEY, false), SOURCE_DOCUMENTS_KEY, false, "open").open).toBe(true);
      expect(followStepGroup(initialStepGroup("conclusion", false), "conclusion", false, "closed").open).toBe(false);
      // ?module=visual with the group last collapsed: the step in view stays on the list.
      expect(followStepGroup(initialStepGroup("visual", true), "visual", true, "closed").open).toBe(true);
    });

    it("reads the stored choice once, where the screen starts: another tab's later choice never moves it", () => {
      // Hydration: not read yet, so nothing changes.
      const hydrating = initialStepGroup(SOURCE_DOCUMENTS_KEY, false);
      expect(followStepGroup(hydrating, SOURCE_DOCUMENTS_KEY, false, undefined)).toBe(hydrating);
      // Read after hydration: nothing kept, collapsed.
      const started = followStepGroup(hydrating, SOURCE_DOCUMENTS_KEY, false, null);
      expect(started.open).toBe(false);
      // Another tab opens its group: this one stays as it is at its next render.
      expect(followStepGroup(started, SOURCE_DOCUMENTS_KEY, false, "open").open).toBe(false);
      // The inspector's own toggle has set it before the choice comes back from storage.
      expect(followStepGroup({ ...started, open: true }, SOURCE_DOCUMENTS_KEY, false, "open").open).toBe(true);
    });
  });
});

describe("CaptureHeader", () => {
  it("names the inspection and its status, with one short line: the client and the manufacturer", () => {
    const html = renderToStaticMarkup(
      <CaptureHeader
        heading={{
          refNo: "INS-2026-0001",
          status: "reopened",
          templateName: "Standard examination gloves",
          templateVersion: 3,
          clientName: "Client A",
          manufacturerLabel: "Manufacturer A · Factory 1",
          manufacturerName: "Manufacturer A",
          inspectionDate: "2026-10-06",
          inspectorName: "Inspector A",
        }}
      />,
    );
    expect(html).toMatch(/<h1[^>]*>.*INS-2026-0001/);
    expect(html).toContain('data-status="reopened"');
    for (const fact of ["Client A", "Manufacturer A"]) expect(html).toContain(fact);
    // Kept short (Kenneth): no template line, factory, date or inspector in the header.
    for (const gone of ["Standard examination gloves", "Factory 1", "6 Oct 2026", "Inspector A"]) expect(html).not.toContain(gone);
    // The actions take a row of their own below 1280 px and sit beside the title from 1280 px.
    const header = tagsWith(html, 'data-slot="page-header"')[0];
    expect(header).toContain("md:flex-col");
    expect(header).toContain("xl:flex-row");
    expect(header).not.toContain("md:flex-row");
  });
});

describe("SectionFrame", () => {
  it("is the open tab's panel below 1280 px, named by that tab", () => {
    const html = renderToStaticMarkup(
      <SectionFrame id="panel" tabLabelledBy={tabId("cap", "glove_info")} title="Glove Information" status="not_done">
        <p>Body</p>
      </SectionFrame>,
    );
    const frame = tagsWith(html, 'id="panel"')[0];
    expect(frame).toContain('role="tabpanel"');
    expect(frame).toContain(`aria-labelledby="${tabId("cap", "glove_info")}"`);
  });

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
    expect(html).toContain("Not Done");
    expect(html).toContain("Missing: Glove colour.");
    expect(html).toContain("<footer");
  });

  it("carries its section's key, for landing spots and specs, and none when not given", () => {
    const keyed = renderToStaticMarkup(
      <SectionFrame id="panel" sectionKey="packing_config" title={PACKING_TITLE}>
        <p>Body</p>
      </SectionFrame>,
    );
    expect(tagsWith(keyed, 'id="panel"')[0]).toContain('data-section-key="packing_config"');
    const plain = renderToStaticMarkup(
      <SectionFrame id="panel" title="Glove Information">
        <p>Body</p>
      </SectionFrame>,
    );
    expect(plain).not.toContain("data-section-key");
  });
});

describe("PagePanel (a page of two sections: packing configuration below the order)", () => {
  const frames = (
    <>
      <SectionFrame id="panel-order_lots" sectionKey="order_lots" title="Order">
        <p>Order</p>
      </SectionFrame>
      <SectionFrame id="panel-packing_config" sectionKey="packing_config" title={PACKING_TITLE}>
        <p>Packing</p>
      </SectionFrame>
    </>
  );

  it("is the open tab's panel below 1280 px, named by the tab, each frame a region named by its title", () => {
    const html = renderToStaticMarkup(
      <PagePanel id="panel" tabLabelledBy={tabId("cap", "order_lots")}>
        {frames}
      </PagePanel>,
    );
    const panel = tagsWith(html, 'id="panel"')[0];
    expect(panel).toContain('data-slot="capture-page"');
    expect(panel).toContain('role="tabpanel"');
    expect(panel).toContain(`aria-labelledby="${tabId("cap", "order_lots")}"`);
    const sections = tagsWith(html, 'data-slot="section-frame"');
    expect(sections.map((frame) => /data-section-key="([a-z_]+)"/.exec(frame)?.[1])).toEqual(["order_lots", "packing_config"]);
    expect(sections.map((frame) => /aria-labelledby="([^"]+)"/.exec(frame)?.[1])).toEqual([
      "panel-order_lots-title",
      "panel-packing_config-title",
    ]);
    for (const frame of sections) expect(frame).not.toContain('role="tabpanel"');
  });

  it("is a plain block from 1280 px, beside the sidebar", () => {
    const panel = tagsWith(renderToStaticMarkup(<PagePanel id="panel">{frames}</PagePanel>), 'id="panel"')[0];
    expect(panel).not.toContain("role=");
    expect(panel).not.toContain("aria-labelledby");
  });

  it("around one section adds nothing to the page: the frame is the tab's panel", () => {
    const html = renderToStaticMarkup(
      <PagePanel id="panel" tabLabelledBy={tabId("cap", "glove_info")} single>
        <SectionFrame id="panel" sectionKey="glove_info" tabLabelledBy={tabId("cap", "glove_info")} title="Glove Information">
          <p>Glove</p>
        </SectionFrame>
      </PagePanel>,
    );
    // Still a div, as with two sections, so a page that gains or loses packing keeps the frame it shows.
    expect(html).toMatch(/^<div class="contents"><section /);
    expect(tagsWith(html, 'id="panel"')).toHaveLength(1);
    const frame = tagsWith(html, 'id="panel"')[0];
    expect(frame).toMatch(/^<section /);
    expect(frame).toContain('role="tabpanel"');
    expect(html).not.toContain("capture-page");
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
    expect(html).toContain("Weight: must be more than 0 g.");
    expect(html).toContain(`data-issue-path="${JSON.stringify(["sizes", "M", "weight"]).replaceAll('"', "&quot;")}"`);
  });

  it("draws a number cell as the bordered field beside the row's text inputs, named for screen readers", () => {
    const html = renderToStaticMarkup(
      <FieldControl
        variant="cell"
        cellLabel="Box weight, Box 1"
        field={{ key: "boxWeight", segments: ["boxWeight"], label: "Box weight", type: "number", unit: "g" }}
        value={12.5}
        onChange={noop}
        readOnly={false}
        issuePath={["boxWeight", 0]}
      />,
    );
    const input = tagsWith(html, 'data-slot="numeric-cell"')[0];
    // Not the kit's borderless grid cell, which only a framed grid shows (MeasurementGrid).
    expect(input).toContain('data-variant="field"');
    expect(input).toContain("border-input");
    expect(input).toContain('value="12.5"');
    const id = /id="([^"]+)"/.exec(input)?.[1];
    expect(html).toMatch(new RegExp(`<label[^>]*class="[^"]*sr-only[^"]*"[^>]*for="${id}"|<label[^>]*for="${id}"[^>]*class="[^"]*sr-only`));
    expect(html).toContain("Box weight, Box 1");
    expect(html).toContain(">g</span>");
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
    // The template's label as written, the app's note in Title Case.
    expect(html).toContain("Glove colour<span");
    expect(html).toContain("(Required)");
    expect(html).not.toContain("(required)");
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

  it("says required in Title Case in a table's column heading, and adds a grid column in the template's word", () => {
    const table = renderToStaticMarkup(
      <CustomModuleForm
        custom={SIZE_TABLE}
        value={{}}
        mappedValues={{}}
        context={makeTestContext({ sizes: ["M"] })}
        issues={[]}
        focusPath={null}
        readOnly={false}
        onChange={noop}
        onMappedChange={noop}
        onFocusChange={noop}
      />,
    );
    expect(table).toMatch(/<th scope="col"[^>]*>Requirement<span[^>]*> \(Required\)<\/span><\/th>/);

    const grid = renderToStaticMarkup(
      <CustomModuleForm
        custom={{
          key: "box_checks",
          title: "Box checks",
          after: "weight",
          layout: "grid",
          fields: [{ key: "boxWeight", label: "Box weight", type: "number", unit: "g" }],
          grid: { columns: { label: "Box", default: 2, addable: true } },
        }}
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
    expect(grid).toContain(">Box 1</th>");
    expect(grid).toMatch(/<\/svg>Add Box<\/button>/);
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
        title={PACKING_TITLE}
        override={override}
        author="Admin A"
        canSwitch
        onChanged={noop}
      />,
    );
    expect(html).toContain(`${PACKING_TITLE} is switched off for this inspection.`);
    expect(html).toContain("Not in this order.");
    expect(html).toContain("Switched off by Admin A on 6 Oct 2026, 16:00.");
    expect(html).toContain("Switch Back On");
  });

  it("names no one when the inspector may not read the admin's name, and offers no switch", () => {
    const html = renderToStaticMarkup(
      <SwitchedOffPanel
        inspectionId="i"
        moduleKey="packing_config"
        title={PACKING_TITLE}
        override={override}
        author={null}
        canSwitch={false}
        onChanged={noop}
      />,
    );
    expect(html).toContain("Switched off by an admin");
    expect(html).not.toMatch(/switch back on/i);
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
