// The Audit Log page as server-rendered markup (Kenneth, 26 October 2026):
// its frame, its list and how a special action by the inspector stands out.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../audit-actions", () => ({ loadAuditLog: vi.fn() }));

import type { AuditLogEntry } from "@/lib/inspections/capture/audit-log";
import { AuditLogList, AuditLogPage } from "./audit-log-page";

const ENTRIES: AuditLogEntry[] = [
  {
    id: 3,
    at: "2026-10-26T04:00:00.000Z",
    when: "26 Oct 2026, 12:00",
    who: "Test Inspector",
    title: "P/F Changed by the Inspector",
    detail: "Dimension, Size M, Width: set to Failed; the readings give Passed. Comment: Torn cuffs on 3 gloves.",
    special: true,
  },
  {
    id: 2,
    at: "2026-10-26T03:00:00.000Z",
    when: "26 Oct 2026, 11:00",
    who: "Test Inspector",
    title: "Spec Changed",
    detail: "Size M Finger Thickness spec changed from 0.18 ± 0.04 to NA.",
    special: false,
  },
  { id: 1, at: "2026-10-26T01:00:00.000Z", when: "26 Oct 2026, 09:00", who: "Test Inspector", title: "Inspection Created", detail: null, special: false },
];

describe("the Audit Log page", () => {
  it("is a frame titled Audit Log that reads the log when it opens, with Refresh", () => {
    const html = renderToStaticMarkup(
      <AuditLogPage id="panel" tabLabelledBy="cap-tab-audit_log" titleRef={() => null} inspectionId="00000000-0000-4000-8000-000000000009" />,
    );
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-labelledby="cap-tab-audit_log"');
    expect(html).toContain('data-section-key="audit_log"');
    expect(html).toMatch(/<h2[^>]*>Audit Log<\/h2>/);
    expect(html).toContain("What was done on this inspection, newest first. Nobody can change it.");
    expect(html).toContain("Reading the audit log…");
    expect(html).toContain("Refresh");
    // No result: the Audit Log is no step.
    expect(html).not.toContain('data-slot="status-pill"');
  });

  it("lists each entry newest first: what, the particulars, when and who", () => {
    const html = renderToStaticMarkup(<AuditLogList entries={ENTRIES} />);
    expect(html).toContain('aria-label="Audit log, newest first"');
    const titles = Array.from(html.matchAll(/<p class="font-semibold[^"]*">([^<]+)<\/p>/g), (match) => match[1]);
    expect(titles).toEqual(["P/F Changed by the Inspector", "Spec Changed", "Inspection Created"]);
    expect(html).toContain('<time dateTime="2026-10-26T04:00:00.000Z">26 Oct 2026, 12:00</time> · Test Inspector');
    expect(html).toContain("Size M Finger Thickness spec changed from 0.18 ± 0.04 to NA.");
  });

  it("tints a P/F set by hand and marks it a special action by the inspector, with its comment", () => {
    const html = renderToStaticMarkup(<AuditLogList entries={ENTRIES} />);
    const special = Array.from(html.matchAll(/<li[^>]*data-special="true"[^>]*>/g));
    expect(special).toHaveLength(1);
    expect(special[0][0]).toContain("bg-warn-tint");
    expect(html.match(/Special Action by Inspector/g)).toHaveLength(1);
    expect(html).toContain("Comment: Torn cuffs on 3 gloves.");
  });
});
