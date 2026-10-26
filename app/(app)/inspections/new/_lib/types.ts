// What the server hands the new-inspection form: small, display-ready
// summaries, never whole template rows (the resolved templates stay on the
// server, where the Server Action reads them again).
import type { PreviousCopies } from "@/lib/inspections/create";
import type { ProductType, Standard } from "@/lib/schemas/common";
import type { TemplateCandidate, TemplateStatus } from "@/lib/templates/select";

export type Option = { id: string; label: string };

/** A template version the form can choose (active ones; drafts too for an admin's override). */
export type TemplateOption = TemplateCandidate & {
  status: Exclude<TemplateStatus, "retired">;
  name: string;
  /** False when its resolution is missing or no longer reads: nothing can start from it. */
  ready: boolean;
  unit: "pcs" | "pairs";
  /** Size labels, in the template's order. */
  sizes: string[];
  /** Titles of the sections an inspector fills in, in order: included modules and custom modules. */
  sections: string[];
  /**
   * The fields it switches off in the header, glove information and packing
   * configuration (copiedFieldsOff): the form reads from it whether the header
   * records a product name (headerHidesProductName).
   */
  fieldsOff: PreviousCopies;
};

export type NewInspectionOptions = {
  clients: Option[];
  manufacturers: Option[];
  templates: TemplateOption[];
};

export const STANDARD_LABEL: Readonly<Record<Standard, string>> = {
  EN455: "EN 455",
  ASTM_D6319: "ASTM D6319",
  ASTM_D3578: "ASTM D3578",
  ASTM_D3577: "ASTM D3577",
  custom: "Standard to Be Confirmed",
};

export type { ProductType };
