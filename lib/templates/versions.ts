// Template versions (BUILD_SPEC 4.2 rules 8 and 10). An edit makes a new
// version; an inspection keeps the version it started with. The database
// enforces the rest: a version in use is frozen (templates_guard) and a code
// has at most one active version. These helpers decide what to write.
import type { ResolvedTemplate, TemplateDefinition } from "@/lib/schemas/template";
import type { TablesInsert } from "@/lib/supabase/database.types";
import type { TemplateStatus } from "./select";

export function nextVersion(versions: readonly number[]): number {
  return versions.reduce((highest, version) => Math.max(highest, version), 0) + 1;
}

export type TemplateEditTarget = { id: string; status: TemplateStatus; inUse: boolean };

export type TemplateEditPlan = { kind: "update"; id: string } | { kind: "new_version"; version: number };

/**
 * A draft that no inspection uses is edited in place. Anything else (an
 * active or retired version, or one in use) gets a new draft version, so
 * what inspectors start from changes only when an admin activates it.
 */
export function planTemplateEdit(current: TemplateEditTarget, versionsOfCode: readonly number[]): TemplateEditPlan {
  if (current.status === "draft" && !current.inUse) return { kind: "update", id: current.id };
  return { kind: "new_version", version: nextVersion(versionsOfCode) };
}

export type VersionRow = {
  id: string;
  version: number;
  status: TemplateStatus;
  coverageConfirmedAt: string | null;
  resolved: unknown;
};

export type ActivationPlan = { ok: true; retire: string[]; activate: string } | { ok: false; message: string };

/**
 * Activating a version: the field coverage checklist must be confirmed
 * first (rule 10) and the version must have resolved. The code's active
 * version is retired first, since the database allows one at a time.
 */
export function planActivation(versionsOfCode: readonly VersionRow[], targetId: string): ActivationPlan {
  const target = versionsOfCode.find((row) => row.id === targetId);
  if (!target) return { ok: false, message: "That template version was not found." };
  if (target.resolved === null || target.resolved === undefined) {
    return { ok: false, message: `Version ${target.version} has not resolved. Fix its problems and save it again.` };
  }
  if (target.coverageConfirmedAt === null) {
    return {
      ok: false,
      message: `Confirm the field coverage checklist for version ${target.version} before activating it.`,
    };
  }
  const retire = versionsOfCode.filter((row) => row.status === "active" && row.id !== targetId).map((row) => row.id);
  return { ok: true, retire, activate: targetId };
}

export type TemplateRowFields = Pick<
  TablesInsert<"templates">,
  | "code"
  | "extends_code"
  | "product_type"
  | "standard"
  | "client_id"
  | "manufacturer_id"
  | "definition"
  | "resolved"
  | "source_file_path"
>;

/** The `templates` columns that come from a definition and its resolution. */
export function templateRowFields(definition: TemplateDefinition, resolved: ResolvedTemplate): TemplateRowFields {
  return {
    code: definition.code,
    extends_code: definition.extends ?? null,
    product_type: definition.scope.productType,
    standard: definition.scope.standard,
    client_id: definition.scope.clientId ?? null,
    manufacturer_id: definition.scope.manufacturerId ?? null,
    definition,
    resolved,
    source_file_path: definition.sourceFile ?? null,
  };
}
