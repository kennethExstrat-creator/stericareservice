"use client";

// A module's settings (BUILD_SPEC 4.3 ModuleConfig.config), as a form
// generated from the module's own config schema (lib/zod-form). The form
// shows the config the module will run with: its defaults, what the bases
// set, then this template. Only what this template sets is written, and
// each such value can be reset to what it inherits.
import { useMemo } from "react";
import { CanonicalSizeSchema } from "@/lib/sizes";
import type { ModuleKey } from "@/lib/schemas/module-result";
import { describeSchema, type FormMarker, type FormNode, type FormPath } from "@/lib/zod-form";
import { SchemaForm, type SchemaFormHooks } from "@/lib/zod-form/schema-form";
import { SpecSchema } from "@/modules/_framework";
import { canRemoveConfigAt, isConfigOverridden, resetConfigAt, setConfig, type ModuleView } from "../_lib/model";
import { configIssues } from "../_lib/problems";
import type { EditorApi } from "./editor-api";

const MARKERS: readonly FormMarker[] = [
  { name: "size", schema: CanonicalSizeSchema },
  { name: "spec", schema: SpecSchema },
];

const SPEC_KINDS: Readonly<Record<string, string>> = {
  min: "Minimum (≥)",
  max: "Maximum (≤)",
  range: "Range (min – max)",
  tolerance: "Nominal ± tolerance",
  na: "NA (not judged)",
};

/** Settings of a stub: any JSON until the module is built. */
const STUB_NODE: FormNode = {
  kind: "json",
  reason: "Not built yet",
  description: "Free-form until the module is built; its own settings check them then.",
  meta: {},
};

const DEFECT_CODE = /^[a-z][a-z0-9_]*$/;

export function ConfigForm({ api, view }: { api: EditorApi; view: ModuleView }) {
  const key = view.key;
  const definition = api.context.registry[key];
  const node = useMemo(
    () => (definition.stub ? STUB_NODE : describeSchema(definition.configSchema, { markers: MARKERS })),
    [definition],
  );
  const issues = useMemo(() => configIssues(api.problems, key), [api.problems, key]);
  const knownCodes = useMemo(() => new Set(api.defectCodes.map((entry) => entry.code)), [api.defectCodes]);
  const codeOptions = useMemo(
    () => api.defectCodes.filter((entry) => entry.active).map((entry) => ({ value: entry.code, label: entry.name })),
    [api.defectCodes],
  );

  const hooks: SchemaFormHooks = {
    labelForKey: (name) => view.labels[name],
    labelForOption: (value) => (typeof value === "string" ? view.labels[value] : undefined),
    markerOptions: (marker) => (marker === "size" ? api.sizes : undefined),
    variantLabel: (marker, value) => (marker === "spec" ? SPEC_KINDS[value] : undefined),
    canRemove: (path) => canRemoveConfigAt(view.inherited.config, path),
    isOverridden: (path) => isConfigOverridden(api.draft, key, path),
    onReset: (path) => api.update((draft, context) => resetConfigAt(draft, context, key, path)),
    resetLabel: api.resetLabel,
    onDraftError: (path: FormPath, message) =>
      api.reportDraftError({ area: "module", moduleKey: key, part: "config", path }, message),
    suggestionsFor: (path, field) => (isDefectCodeField(path, field) ? codeOptions : undefined),
    noteFor: (path, value, field) =>
      isDefectCodeField(path, field) &&
      typeof value === "string" &&
      DEFECT_CODE.test(value) &&
      !knownCodes.has(value) &&
      knownCodes.size > 0
        ? "Not one of the defect codes: inspections count it apart, and it is flagged for an admin to map."
        : undefined,
  };

  const empty = node.kind === "object" && node.properties.length === 0;
  return (
    <div className="grid gap-4">
      {/* The schema's own word on the whole: "No settings: cartons are checked the same way everywhere." */}
      {!definition.stub && node.description && <p className="text-sm text-muted-foreground">{node.description}</p>}
      {empty ? (
        !node.description && <p className="text-sm text-muted-foreground">This module has no settings.</p>
      ) : (
        <SchemaForm
          node={node}
          value={definition.stub ? (Object.keys(view.config).length > 0 ? view.config : undefined) : view.config}
          onChange={(next) => api.update((draft, context) => setConfig(draft, context, key, next ?? {}))}
          idPrefix={configFieldPrefix(key)}
          issues={issues}
          readOnly={!api.editable}
          hooks={hooks}
          label="Settings as JSON"
        />
      )}
    </div>
  );
}

/** Ids of the config fields of a module: `config-weight-n`. */
export function configFieldPrefix(key: ModuleKey): string {
  return `config-${key}`;
}

/**
 * A defect code (BUILD_SPEC 4.2 rule 4): a snake-case text field in a list,
 * as `locations[2].code` or `classes.major.defects[0].code`, or an item of a
 * list of defects. Other codes (stickiness A, B1) have patterns of their own.
 */
function isDefectCodeField(path: FormPath, node: FormNode): boolean {
  if (node.kind !== "string" || node.pattern !== DEFECT_CODE.source) return false;
  if (!path.some((segment) => typeof segment === "number")) return false;
  return path.at(-1) === "code" || path.some((segment) => typeof segment === "string" && /defect|location/i.test(segment));
}
