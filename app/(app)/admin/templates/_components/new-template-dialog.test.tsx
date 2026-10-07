// The New template form, drawn in place (a portal draws nothing on the
// server): it asks for the base, code, name and scope, and is submitted by
// hand, so a refused attempt keeps every Select as chosen (lib/admin/submit.ts).
// e2e/admin-template-flow refuses a taken code in the browser and checks.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ createTemplate: vi.fn() }));
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
    DialogTrigger: Part,
  };
});

import { NewTemplateDialog } from "./new-template-dialog";

/** What React draws for `<form action={fn}>` on the server: such a form is reset after every action. */
const FUNCTION_ACTION = "React form unexpectedly submitted";

describe("NewTemplateDialog", () => {
  const html = renderToStaticMarkup(
    <NewTemplateDialog
      bases={[
        {
          code: "STD_EG",
          name: "Standard examination gloves (EN 455)",
          version: 2,
          productType: "examination",
          standard: "EN455",
          sizes: "XS, S, M, L, XL",
          unit: "pcs",
        },
      ]}
      clients={[{ id: "20000000-0000-4000-8000-000000000001", name: "Client A" }]}
      manufacturers={[]}
      takenCodes={["STD_EG"]}
    />,
  );

  it("submits by hand, so a refused attempt keeps every choice", () => {
    expect(html).toContain('data-testid="new-template-form"');
    expect(html).not.toContain(FUNCTION_ACTION);
  });

  it("asks for the base, the code, the name and where it applies, each value sent in a field of its own", () => {
    for (const label of ["Build On", "Code", "Name", "Product Type", "Standard", "Client", "Manufacturer"]) {
      expect(html).toContain(`>${label}</label>`);
    }
    for (const name of ["base", "productType", "standard", "clientId", "manufacturerId"]) {
      expect(html).toContain(`type="hidden" name="${name}"`);
    }
    // A client and a manufacturer are optional: any, to start with.
    expect(html).toContain('name="clientId" value="any"');
    expect(html).toContain('name="code"');
    expect(html).toContain("Create and Edit");
  });
});
