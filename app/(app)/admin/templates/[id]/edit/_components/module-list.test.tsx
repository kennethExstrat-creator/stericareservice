// Markup of the template editor's module list: each module's Edit button is
// named by the title it shows first (WCAG 2.5.3, label in name), so a speech
// user can say "Visual Inspection" to open it; its key and tags describe it.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { ModuleView } from "../_lib/model";
import { ModuleList } from "./module-list";

const noop = () => {};
const TITLES: Partial<Record<ModuleKey, string>> = {
  header: "Header",
  visual: "Visual Inspection",
  watertight: "Freedom from Holes (Watertight Test)",
  conclusion: "Conclusion",
};
const ORDER: ModuleKey[] = ["header", "visual", "watertight", "conclusion"];
const titleOf = (key: ModuleKey) => TITLES[key] ?? key;
const viewOf = (key: ModuleKey): ModuleView => ({
  key,
  include: key !== "watertight",
  title: titleOf(key),
  labels: {},
  config: {},
  entry: undefined,
  inherited: { include: true, title: titleOf(key), labels: {}, config: {} },
  changed: false,
});

const render = (editable: boolean) =>
  renderToStaticMarkup(
    <ModuleList
      order={ORDER}
      viewOf={viewOf}
      unused={[]}
      titleOf={titleOf}
      stubs={new Set()}
      selected="visual"
      problemCounts={new Map([["visual", 2]])}
      editable={editable}
      onSelect={noop}
      onInclude={noop}
      onMove={noop}
      onAdd={noop}
    />,
  );

/** A module's Edit button: its opening tag and the title it shows first. */
function editButton(html: string, key: ModuleKey): { tag: string; title: string } {
  const match = new RegExp(`(<button[^>]*data-edit-module="${key}"[^>]*>)<span[^>]*><span[^>]*>([^<]*)</span>`).exec(html);
  return { tag: match?.[1] ?? "", title: match?.[2] ?? "" };
}

describe("ModuleList", () => {
  it("names each module's Edit button by the title it shows, then what it does", () => {
    for (const editable of [true, false]) {
      const html = render(editable);
      for (const key of ORDER) {
        const { tag, title } = editButton(html, key);
        expect(title).toBe(titleOf(key));
        expect(tag).toContain(`aria-label="${title}, edit"`);
        // The key and the tags (Off, 2 problems) describe it, after the name.
        expect(tag).toContain(`aria-describedby="module-meta-${key}"`);
      }
      expect(html).not.toMatch(/aria-label="Edit /);
    }
  });
});
