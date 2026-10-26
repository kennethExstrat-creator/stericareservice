// Markup of the label map. It is read only: no card links to a template
// editor, since Admin > Templates is gone (Kenneth, 26 October 2026). The one
// link a label can carry, Add This Code, is named by the words it shows first
// (WCAG 2.5.3, label in name), so a speech user can say "Add This Code" and
// still hears which code it adds.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { addCodeHref, type TemplateLabelMap } from "@/lib/admin/defects";
import { LabelMapView } from "./label-map-view";

const map: TemplateLabelMap = {
  id: "template-1",
  code: "STD_EG",
  version: 2,
  status: "active",
  name: "Examination gloves",
  resolved: true,
  sections: [
    {
      section: "visual",
      rows: [{ section: "visual", defectClass: "major", label: "Torn cuff", code: "torn_cuff", state: "unknown", codeName: null }],
    },
    {
      section: "watertight",
      rows: [{ section: "watertight", defectClass: null, label: "Palm", code: "hole_palm", state: "ok", codeName: "Hole in palm" }],
    },
  ],
  classesOff: [],
  classAql: {},
  attention: 1,
};

function render(): string {
  return renderToStaticMarkup(
    <LabelMapView maps={[map, { ...map, id: "template-2", code: "SAFEDON_EG", version: 1, resolved: false }]} initialQuery="" />,
  );
}

/** Every link: its href as the browser reads it, its opening tag and the text it shows (icons left out). */
function links(html: string): { href: string; tag: string; shown: string }[] {
  return [...html.matchAll(/(<a [^>]*href="([^"]+)"[^>]*>)([\s\S]*?)<\/a>/g)].map((match) => ({
    href: match[2].replace(/&amp;/g, "&"),
    tag: match[1],
    shown: match[3]
      .replace(/<svg[\s\S]*?<\/svg>/g, "")
      .replace(/<[^>]+>/g, "")
      .trim(),
  }));
}

describe("LabelMapView", () => {
  it("links to no template editor: a card's only link adds a missing code", () => {
    const html = render();
    expect(links(html).map((link) => link.href)).toEqual([addCodeHref("torn_cuff", "Torn cuff")]);
    expect(html).not.toMatch(/template editor|\/admin\/templates/i);
  });

  it("names Add This Code by its words first, then the code it adds", () => {
    const [add] = links(render());
    expect(add.shown).toBe("Add This Code");
    expect(add.tag).toContain('aria-label="Add This Code: torn_cuff"');
  });

  it("sends a label that needs attention to the Codes tab, and an unresolved version nowhere", () => {
    const html = render();
    expect(html).toContain("1 label needs attention: add or reactivate their codes on the Codes tab.");
    expect(html).toContain("This version has not resolved yet, so its labels cannot be read.</p>");
  });
});
