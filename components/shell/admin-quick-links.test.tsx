// Markup of the admin home's shortcuts: every admin screen is linked, nothing
// is announced as coming, and the inspections awaiting approval read right
// whatever their count, including when it could not be read.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFECTS_PATH, TEMPLATES_PATH as DEFECTS_TEMPLATES_PATH, UNMAPPED_PATH } from "@/lib/admin/defects";
import { TEMPLATES_PATH } from "@/lib/admin/templates";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import { parseInspectionSearchParams } from "@/lib/inspections/search-params";
import { AdminScreenLinks, AWAITING_APPROVAL_HREF, InspectionShortcuts, UNMAPPED_LABELS_HREF } from "./admin-quick-links";

function render(element: ReactElement) {
  const html = renderToStaticMarkup(element);
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return { html, text };
}

/** Each link as [href, the text it is read out with]. */
function links(html: string): [string, string][] {
  return [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g)].map((match) => [
    match[1].replace(/&amp;/g, "&"),
    match[2]
      .replace(/<span aria-hidden="true"[^>]*>[^<]*<\/span>/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  ]);
}

describe("AdminScreenLinks", () => {
  it("links every admin screen, in the nav's order, with unmapped labels beside the codes", () => {
    const { html } = render(<AdminScreenLinks />);
    expect(links(html).map(([href]) => href)).toEqual([
      "/admin/users",
      "/admin/manufacturers",
      "/admin/clients",
      "/admin/defects",
      "/admin/defects/unmapped",
      "/admin/templates",
      "/admin/ai",
    ]);
    expect(links(html).map(([, name]) => name.split(" ")[0])).toEqual([
      "Users",
      "Manufacturers",
      "Clients",
      "Defect",
      "Unmapped",
      "Templates",
      "Steri-AI",
    ]);
  });

  it("goes where the defects and template screens live", () => {
    const hrefs = links(render(<AdminScreenLinks />).html).map(([href]) => href);
    expect(hrefs).toContain(DEFECTS_PATH);
    expect(UNMAPPED_LABELS_HREF).toBe(UNMAPPED_PATH);
    expect(hrefs).toContain(TEMPLATES_PATH);
    expect(DEFECTS_TEMPLATES_PATH).toBe(TEMPLATES_PATH);
  });

  it("announces nothing as coming later", () => {
    const { text } = render(<AdminScreenLinks />);
    expect(text).not.toMatch(/Coming|Phase \d|next build/i);
  });

  it("titles every card in Title Case (docs/DESIGN.md, Capitalisation)", () => {
    const html = render(<AdminScreenLinks />).html + render(<InspectionShortcuts awaitingApproval={2} />).html;
    const titles = [...html.matchAll(/<span class="font-display[^"]*">([^<]+)<\/span>/g)].map((match) => match[1]);
    expect(titles).toEqual([
      "Users",
      "Manufacturers",
      "Clients",
      "Defect Codes",
      "Unmapped Labels",
      "Templates",
      "Steri-AI Settings",
      "Awaiting Approval",
      "All Inspections",
    ]);
    for (const title of titles) expect(lowerCaseWords(title), title).toEqual([]);
  });
});

describe("InspectionShortcuts", () => {
  it("links the submitted inspections, filtered in the list", () => {
    const { html } = render(<InspectionShortcuts awaitingApproval={3} />);
    expect(AWAITING_APPROVAL_HREF).toBe("/inspections?status=submitted");
    expect(parseInspectionSearchParams({ status: "submitted" })).toMatchObject({ status: "submitted", page: 1 });
    expect(links(html)).toEqual([
      ["/inspections?status=submitted", "Awaiting Approval 3 submitted inspections to approve or reopen."],
      ["/inspections", "All Inspections Every inspection, from every inspector, newest first."],
    ]);
    // The number beside the title is for the eye; the sentence says it.
    expect(html).toMatch(/<span aria-hidden="true" data-slot="quick-link-count"[^>]*>3<\/span>/);
  });

  it.each([
    [1, "1 submitted inspection to approve or reopen.", true],
    [0, "Nothing to approve: no inspection is submitted.", false],
    [null, "Submitted inspections, for you to approve or reopen.", false],
  ] as const)("with %s waiting it says %j", (count, sentence, badge) => {
    const { html, text } = render(<InspectionShortcuts awaitingApproval={count} />);
    expect(text).toContain(sentence);
    expect(html.includes('data-slot="quick-link-count"')).toBe(badge);
    // Still a way to the filtered list, even when the count is unknown.
    expect(links(html)[0][0]).toBe(AWAITING_APPROVAL_HREF);
  });

  it("reads 16 px on touch, and keeps keyboard focus visible", () => {
    const { html } = render(<InspectionShortcuts awaitingApproval={2} />);
    expect(html).toMatch(/class="block text-sm text-muted-foreground touch:text-base"/);
    expect(html.match(/<a [^>]*class="[^"]*\bfocus-ring\b/g)).toHaveLength(2);
  });
});
