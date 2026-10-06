// Choosing a template for a new inspection (BUILD_SPEC 4.4). The inspector
// picks client, manufacturer and product type; the most specific active
// template wins:
//   1. scoped to that client and that manufacturer,
//   2. scoped to that client only,
//   3. scoped to that manufacturer only,
//   4. the standard template for the product type (no client, no manufacturer).
// A template scoped to another client or manufacturer never applies. An
// admin can override the choice with any template that is not retired.
import type { ProductType, Standard } from "@/lib/schemas/common";
import type { Tables } from "@/lib/supabase/database.types";

export type TemplateStatus = Tables<"templates">["status"];

export type TemplateCandidate = {
  id: string;
  code: string;
  version: number;
  status: TemplateStatus;
  productType: ProductType;
  standard: Standard;
  clientId: string | null;
  manufacturerId: string | null;
};

export type SelectionCriteria = {
  productType: ProductType;
  clientId?: string | null;
  manufacturerId?: string | null;
  /** Admin override: this template id, whatever its scope. */
  overrideTemplateId?: string | null;
};

export const SPECIFICITY = ["client_manufacturer", "client", "manufacturer", "standard"] as const;
export type Specificity = (typeof SPECIFICITY)[number];

export type RankedTemplate = { template: TemplateCandidate; specificity: Specificity };

export type TemplateSelection =
  | {
      ok: true;
      template: TemplateCandidate;
      specificity: Specificity | "override";
      /** Other active templates just as specific: the choice was a tie broken by code. Show it to an admin. */
      ties: TemplateCandidate[];
    }
  | { ok: false; reason: "none" | "override_not_found" | "override_retired"; message: string };

export function templateCandidateFromRow(
  row: Pick<
    Tables<"templates">,
    "id" | "code" | "version" | "status" | "product_type" | "standard" | "client_id" | "manufacturer_id"
  >,
): TemplateCandidate {
  return {
    id: row.id,
    code: row.code,
    version: row.version,
    status: row.status,
    productType: row.product_type,
    standard: row.standard,
    clientId: row.client_id,
    manufacturerId: row.manufacturer_id,
  };
}

/** How specifically a template fits the criteria, or null when it does not apply. */
export function specificityOf(template: TemplateCandidate, criteria: SelectionCriteria): Specificity | null {
  if (template.productType !== criteria.productType) return null;
  const clientId = criteria.clientId ?? null;
  const manufacturerId = criteria.manufacturerId ?? null;
  const client = template.clientId === null ? "any" : template.clientId === clientId ? "match" : "other";
  const manufacturer =
    template.manufacturerId === null ? "any" : template.manufacturerId === manufacturerId ? "match" : "other";
  if (client === "other" || manufacturer === "other") return null;
  if (client === "match" && manufacturer === "match") return "client_manufacturer";
  if (client === "match") return "client";
  if (manufacturer === "match") return "manufacturer";
  return "standard";
}

/** Active templates that apply, most specific first; ties by code, then the higher version. */
export function rankTemplates(
  candidates: readonly TemplateCandidate[],
  criteria: SelectionCriteria,
): RankedTemplate[] {
  return candidates
    .filter((template) => template.status === "active")
    .flatMap((template) => {
      const specificity = specificityOf(template, criteria);
      return specificity ? [{ template, specificity }] : [];
    })
    .sort(
      (a, b) =>
        SPECIFICITY.indexOf(a.specificity) - SPECIFICITY.indexOf(b.specificity) ||
        a.template.code.localeCompare(b.template.code) ||
        b.template.version - a.template.version,
    );
}

export function selectTemplate(
  candidates: readonly TemplateCandidate[],
  criteria: SelectionCriteria,
): TemplateSelection {
  if (criteria.overrideTemplateId) {
    const chosen = candidates.find((template) => template.id === criteria.overrideTemplateId);
    if (!chosen) return { ok: false, reason: "override_not_found", message: "The chosen template was not found." };
    if (chosen.status === "retired") {
      return {
        ok: false,
        reason: "override_retired",
        message: `${chosen.code} version ${chosen.version} is retired. Pick an active or draft version.`,
      };
    }
    return { ok: true, template: chosen, specificity: "override", ties: [] };
  }

  const ranked = rankTemplates(candidates, criteria);
  const best = ranked[0];
  if (!best) {
    return {
      ok: false,
      reason: "none",
      message: `No active template for ${criteria.productType} gloves. An admin needs to activate one.`,
    };
  }
  const ties = ranked
    .slice(1)
    .filter((entry) => entry.specificity === best.specificity)
    .map((entry) => entry.template);
  return { ok: true, template: best.template, specificity: best.specificity, ties };
}
