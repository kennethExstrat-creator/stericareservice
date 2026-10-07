// Markup of the label map: each template's link to the template editor is
// named by the words it shows first (WCAG 2.5.3, label in name), so a speech
// user can say "Open in Template Editor" and still hears which version opens.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { templateEditorHref, type TemplateLabelMap } from "@/lib/admin/defects";
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
      section: "watertight",
      rows: [{ section: "watertight", defectClass: null, label: "Palm", code: "hole_palm", state: "ok", codeName: "Hole in palm" }],
    },
  ],
  classesOff: [],
  classAql: {},
  attention: 0,
};

/** The editor link of a template: its opening tag and the text it shows (icons and screen-reader text left out). */
function editorLink(html: string, templateId: string): { tag: string; shown: string } {
  const href = templateEditorHref(templateId).replace(/[/]/g, "\\/");
  const match = new RegExp(`(<a[^>]*href="${href}"[^>]*>)([\\s\\S]*?)</a>`).exec(html);
  const shown = (match?.[2] ?? "")
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<span class="sr-only">[\s\S]*?<\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
  return { tag: match?.[1] ?? "", shown };
}

describe("LabelMapView", () => {
  it("names each template's editor link by its words first, then the version it opens", () => {
    const html = renderToStaticMarkup(
      <LabelMapView maps={[map, { ...map, id: "template-2", code: "SAFEDON_EG", version: 1, resolved: false }]} initialQuery="" />,
    );
    const first = editorLink(html, "template-1");
    expect(first.shown).toBe("Open in Template Editor");
    expect(first.tag).toContain('aria-label="Open in Template Editor: STD_EG v2"');
    // A version that has not resolved yet links to the editor the same way.
    expect(editorLink(html, "template-2").tag).toContain('aria-label="Open in Template Editor: SAFEDON_EG v1"');
    expect(html).not.toMatch(/aria-label="Open (STD|SAFEDON)_EG/);
  });
});
