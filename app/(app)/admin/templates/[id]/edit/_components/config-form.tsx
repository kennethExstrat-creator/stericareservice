"use client";

// A module's settings (BUILD_SPEC 4.3 ModuleConfig.config), as a form
// generated from the module's own config schema (lib/zod-form). The form
// shows the config the module will run with: its defaults, what the bases
// set, then this template. Only what this template sets is written, and
// each such value can be reset to what it inherits. Settings are named as
// the problem list names them (../_lib/settings.ts).
import { useMemo, type ReactNode } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addCodeHref } from "@/lib/admin/defects";
import type { ModuleKey } from "@/lib/schemas/module-result";
import { getAt, humanizeValue, type FormNode, type FormPath } from "@/lib/zod-form";
import { SchemaForm, type SchemaFormHooks } from "@/lib/zod-form/schema-form";
import { canRemoveConfigAt, isConfigOverridden, resetConfigAt, setConfig, type ModuleView } from "../_lib/model";
import { configIssues } from "../_lib/problems";
import { configNodeOf, settingNaming, specUnit } from "../_lib/settings";
import type { EditorApi } from "./editor-api";

const DEFECT_CODE = /^[a-z][a-z0-9_]*$/;

export function ConfigForm({ api, view }: { api: EditorApi; view: ModuleView }) {
  const key = view.key;
  const definition = api.context.registry[key];
  const node = useMemo(() => configNodeOf(definition), [definition]);
  const issues = useMemo(() => configIssues(api.problems, key), [api.problems, key]);
  const knownCodes = useMemo(() => new Set(api.defectCodes.map((entry) => entry.code)), [api.defectCodes]);
  const codeOptions = useMemo(
    () => api.defectCodes.filter((entry) => entry.active).map((entry) => ({ value: entry.code, label: entry.name })),
    [api.defectCodes],
  );

  const hooks: SchemaFormHooks = {
    ...settingNaming(key, view.labels, api.sizes),
    labelForOption: (value) => (typeof value === "string" ? view.labels[value] : undefined),
    canRemove: (path) => canRemoveConfigAt(view.inherited.config, path),
    isOverridden: (path) => isConfigOverridden(api.draft, key, path),
    onReset: (path) => api.update((draft, context) => resetConfigAt(draft, context, key, path)),
    resetLabel: api.resetLabel,
    onDraftError: (path: FormPath, draft) =>
      api.reportDraftError({ area: "module", moduleKey: key, part: "config", path }, draft),
    draftFor: (path) => api.draftFor({ area: "module", moduleKey: key, part: "config", path }),
    suggestionsFor: (path, field) => (isDefectCodeField(path, field) ? codeOptions : undefined),
    unitFor: (path, field) => specUnit(key, path, field),
    noteFor: (path, value, field) =>
      isDefectCodeField(path, field) &&
      typeof value === "string" &&
      DEFECT_CODE.test(value) &&
      !knownCodes.has(value) &&
      knownCodes.size > 0 ? (
        <UnknownCodeNote code={value} name={codeName(view.config, path, value)} />
      ) : undefined,
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

/**
 * A code the template lists that defect_codes does not have (BUILD_SPEC 4.2
 * rule 4): allowed, counted apart and flagged. The link opens the defects
 * screen in a new tab with the add panel filled in, so the draft stays open
 * here; the editor knows the new code once it is opened again.
 */
function UnknownCodeNote({ code, name }: { code: string; name: string }): ReactNode {
  return (
    <span className="grid justify-items-start gap-1.5" data-unknown-code={code}>
      <span>Not one of the defect codes: inspections count it apart, and it is flagged for an admin to map.</span>
      <Button asChild variant="outline" size="xs" className="text-foreground">
        <a href={addCodeHref(code, name)} target="_blank" rel="noopener noreferrer">
          Add {code} as a Defect Code
          <ExternalLinkIcon aria-hidden />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </Button>
    </span>
  );
}

/**
 * What a listed code is called: the label next to it in its list item (locations, defects), else its key in
 * words. A name for the new code, so worded as a value ("Torn cuff"), not as a label.
 */
function codeName(config: unknown, path: FormPath, code: string): string {
  const label = path.at(-1) === "code" ? getAt(config, [...path.slice(0, -1), "label"]) : undefined;
  return typeof label === "string" && label.trim() !== "" ? label.trim() : humanizeValue(code);
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
