// The version page's modules list, server-rendered: a placeholder module and
// a custom module's fields in the words the template editor uses for them.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CustomModuleView, ModuleView } from "@/lib/admin/templates";
import { ModulesList } from "./modules-list";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const stub: ModuleView = {
  kind: "module",
  key: "dye_leak",
  position: 1,
  title: "Dye Leak",
  defaultTitle: null,
  include: true,
  alwaysOn: false,
  notBuilt: true,
  labels: [],
  fieldsOff: [],
};

const custom: CustomModuleView = {
  kind: "custom",
  key: "glove_type",
  title: "Glove Type",
  after: "dye_leak",
  afterTitle: "Dye Leak",
  layout: "fields",
  fields: [
    { key: "note", label: "Note", type: "textarea", unit: null, required: true, options: [], mapsTo: null },
    { key: "done", label: "Done", type: "yes_no", unit: null, required: false, options: [], mapsTo: null },
  ],
};

describe("ModulesList", () => {
  it("marks a placeholder module as the editor does", () => {
    const html = text(renderToStaticMarkup(<ModulesList sections={[stub]} />));
    expect(html).toContain("Dye Leak On Not Built Yet");
    expect(html).not.toContain("Module Not Built Yet");
  });

  it("names a custom field's type as the editor's Type select does, never by its key", () => {
    const html = text(renderToStaticMarkup(<ModulesList sections={[stub, custom]} />));
    expect(html).toContain("Note · Long Text · required");
    expect(html).toContain("Done · Yes / No");
    expect(html).not.toContain("textarea");
    expect(html).not.toContain("yes_no");
  });
});
