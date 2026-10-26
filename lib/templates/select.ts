// Choosing a template for a new inspection (BUILD_SPEC 4.4). Every client
// uses the standard template of the product type: the active template for it
// with no client and no manufacturer. Kenneth, 26 October 2026: "all the
// inspection flow will be standardized". Until then a template scoped to the
// client, the manufacturer or both won over the standard one. A scoped
// template (SAFEDON_EG, retired) now never applies, whoever the inspection is
// for. Client and manufacturer are still asked for: they go into the header,
// not into the choice. An admin can override the choice with any template
// that is not retired.
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
  /** Admin override: this template id, whatever its scope. */
  overrideTemplateId?: string | null;
};

/** How the rule found a template: only the standard one applies (26 October 2026). */
export const SPECIFICITY = ["standard"] as const;
export type Specificity = (typeof SPECIFICITY)[number];

export type RankedTemplate = { template: TemplateCandidate; specificity: Specificity };

export type TemplateSelection =
  | {
      ok: true;
      template: TemplateCandidate;
      specificity: Specificity | "override";
      /** Other active standard templates for the product type: the choice was a tie broken by code. Show it to an admin. */
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

/**
 * How a template fits the criteria: "standard" for a template of the
 * product type with no client and no manufacturer, else null (it never
 * applies).
 */
export function specificityOf(template: TemplateCandidate, criteria: SelectionCriteria): Specificity | null {
  if (template.productType !== criteria.productType) return null;
  return template.clientId === null && template.manufacturerId === null ? "standard" : null;
}

/** Active templates that apply, by code, then the higher version first. */
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
    .sort((a, b) => a.template.code.localeCompare(b.template.code) || b.template.version - a.template.version);
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
      message: `No active template for ${criteria.productType} gloves yet.`,
    };
  }
  const ties = ranked.slice(1).map((entry) => entry.template);
  return { ok: true, template: best.template, specificity: best.specificity, ties };
}
