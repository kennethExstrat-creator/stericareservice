"use client";

// One custom module (BUILD_SPEC 4.3 CustomModule): one-off fields a form
// needs and no module captures (4.2 rule 2). Key, title, where it sits,
// layout, and its fields with type, unit, options, limits, required, hint
// and mapsTo. CustomModuleSchema and the resolver judge it; their messages
// show on the field they are about.
import { useId, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FieldTypeSchema, UnitSchema, type FieldType } from "@/lib/schemas/common";
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { CustomModule, Field } from "@/lib/schemas/template";
import { cn } from "@/lib/utils";
import { deepEqual, moveItem, pathKey, type FormPath } from "@/lib/zod-form";
import { NumberInput, OptionSelect } from "@/lib/zod-form/controls";
import { canonicalPathOf, isMappableType } from "@/modules/_framework";
import { moduleOrder, moduleView } from "../_lib/model";
import { CUSTOM_FIELD_LABELS, CUSTOM_GRID_LABELS, CUSTOM_MODULE_LABELS } from "../_lib/names";
import type { EditorProblem } from "../_lib/problems";
import type { EditorApi } from "./editor-api";

export const FIELD_TYPE_LABEL: Readonly<Record<FieldType, string>> = {
  counter: "Count (Tap + and −)",
  number: "Number",
  text: "Text",
  textarea: "Long Text",
  select: "Choice From a List",
  yes_no: "Yes / No",
  date: "Date",
  photo: "Photo",
};

const LAYOUTS = [
  { value: "fields", label: "Fields", description: "A form: each field once." },
  { value: "table", label: "Table", description: "One row per ordered size, a column per field." },
  { value: "grid", label: "Grid", description: "A row per field and repeated columns, such as boxes." },
] as const;

const NUMERIC: ReadonlySet<FieldType> = new Set(["counter", "number"]);

/** Ids the problem list links to: `custom-0-fields-1-label`. */
export function customFieldId(index: number, path: FormPath): string {
  return ["custom", index, ...path].map((segment) => String(segment).replace(/[^A-Za-z0-9_-]/g, "_")).join("-");
}

export function CustomModuleForm({
  api,
  index,
  custom,
  problems,
  onChange,
}: {
  api: EditorApi;
  index: number;
  custom: CustomModule;
  problems: readonly EditorProblem[];
  onChange: (next: CustomModule) => void;
}) {
  const readOnly = !api.editable;
  const idOf = (path: FormPath) => customFieldId(index, path);
  const messagesAt = (path: FormPath) =>
    problems.filter((problem) => problem.place.area === "custom" && pathKey(problem.place.path) === pathKey(path));
  const order = moduleOrder(api.draft, api.context);
  const afterOptions = order
    .filter((key) => key !== "conclusion" || custom.after === "conclusion")
    .map((key) => {
      const view = moduleView(api.draft, api.context, key);
      return { value: key, label: view.include ? view.title : `${view.title} (Off)` };
    });
  const set = <K extends keyof CustomModule>(name: K, value: CustomModule[K] | undefined) => {
    const next = { ...custom } as Record<string, unknown>;
    if (value === undefined) delete next[name];
    else next[name] = value;
    onChange(next as CustomModule);
  };
  const setField = (position: number, field: Field) =>
    set(
      "fields",
      custom.fields.map((entry, at) => (at === position ? field : entry)),
    );

  return (
    <div className="grid gap-5" data-testid="custom-module-form">
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          id={idOf(["title"])}
          label={CUSTOM_MODULE_LABELS.title}
          hint="The section heading in the form's wording."
          value={custom.title}
          readOnly={readOnly}
          problems={messagesAt(["title"])}
          onChange={(title) => set("title", title)}
        />
        <TextField
          id={idOf(["key"])}
          label={CUSTOM_MODULE_LABELS.key}
          hint="Where its values are stored: lower case, digits and _."
          value={custom.key}
          readOnly={readOnly}
          monospace
          problems={messagesAt(["key"])}
          onChange={(key) => set("key", key)}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={idOf(["after"])}>{CUSTOM_MODULE_LABELS.after}</Label>
        <OptionSelect
          id={idOf(["after"])}
          value={custom.after}
          options={afterOptions}
          readOnly={readOnly}
          invalid={messagesAt(["after"]).length > 0}
          describedBy={describedBy(idOf(["after"]), messagesAt(["after"]))}
          onChange={(after) => set("after", after as ModuleKey)}
        />
        <Messages id={`${idOf(["after"])}-errors`} problems={messagesAt(["after"])} />
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">{CUSTOM_MODULE_LABELS.layout}</legend>
        <RadioGroup
          value={custom.layout}
          disabled={readOnly}
          aria-describedby={describedBy(idOf(["layout"]), messagesAt(["layout"]))}
          onValueChange={(layout) => {
            const next: Record<string, unknown> = { ...custom, layout };
            if (layout === "grid" && !custom.grid) next.grid = { columns: { label: "Box #", default: 13, addable: true } };
            if (layout !== "grid") delete next.grid;
            // Tables and grids hold many values: none of their fields can show a module's one.
            if (layout !== "fields") next.fields = custom.fields.map((field) => without(field, "mapsTo"));
            onChange(next as CustomModule);
          }}
          className="grid gap-2 sm:grid-cols-3"
        >
          {LAYOUTS.map((layout) => (
            <Label
              key={layout.value}
              htmlFor={idOf(["layout", layout.value])}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 leading-snug font-normal",
                custom.layout === layout.value && "border-brand-500 bg-brand-50",
              )}
            >
              <RadioGroupItem id={idOf(["layout", layout.value])} value={layout.value} className="mt-0.5" />
              <span className="grid gap-0.5">
                <span className="font-semibold">{layout.label}</span>
                <span className="text-sm text-muted-foreground">{layout.description}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
        <Messages id={`${idOf(["layout"])}-errors`} problems={messagesAt(["layout"])} />
      </fieldset>

      {custom.layout === "grid" && custom.grid && (
        <fieldset className="grid gap-4 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-semibold">{CUSTOM_MODULE_LABELS.grid}</legend>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              id={idOf(["grid", "columns", "label"])}
              label={CUSTOM_GRID_LABELS.label}
              hint="Numbered on screen: Box # 1, Box # 2…"
              value={custom.grid.columns.label}
              readOnly={readOnly}
              problems={messagesAt(["grid", "columns", "label"])}
              onChange={(label) => set("grid", { ...custom.grid!, columns: { ...custom.grid!.columns, label } })}
            />
            <div className="grid gap-1.5">
              <Label htmlFor={idOf(["grid", "columns", "default"])}>{CUSTOM_GRID_LABELS.default}</Label>
              <NumberInput
                id={idOf(["grid", "columns", "default"])}
                value={custom.grid.columns.default}
                integer
                // Required: emptied, it is empty (and asked for), not gone.
                emptyAs="null"
                readOnly={readOnly}
                invalid={messagesAt(["grid", "columns", "default"]).length > 0}
                describedBy={describedBy(idOf(["grid", "columns", "default"]), messagesAt(["grid", "columns", "default"]))}
                onChange={(value) =>
                  set("grid", {
                    ...custom.grid!,
                    // What was typed, number or not: CustomModuleSchema says what is wrong with it.
                    columns: { ...custom.grid!.columns, default: value as number },
                  })
                }
              />
              <Messages
                id={`${idOf(["grid", "columns", "default"])}-errors`}
                problems={messagesAt(["grid", "columns", "default"])}
              />
            </div>
          </div>
          <SwitchField
            id={idOf(["grid", "columns", "addable"])}
            label={CUSTOM_GRID_LABELS.addable}
            checked={custom.grid.columns.addable}
            readOnly={readOnly}
            onChange={(addable) => set("grid", { ...custom.grid!, columns: { ...custom.grid!.columns, addable } })}
          />
          <SwitchField
            id={idOf(["grid", "repeatPer"])}
            label={CUSTOM_GRID_LABELS.repeatPer}
            checked={custom.grid.repeatPer === "size"}
            readOnly={readOnly}
            onChange={(perSize) => {
              const rest = without(custom.grid!, "repeatPer");
              set("grid", perSize ? { ...rest, repeatPer: "size" } : rest);
            }}
          />
        </fieldset>
      )}

      <fieldset className="grid gap-3" aria-describedby={describedBy(idOf(["fields"]), messagesAt(["fields"]))}>
        <legend className="mb-2 text-base font-bold">{CUSTOM_MODULE_LABELS.fields}</legend>
        <Messages id={`${idOf(["fields"])}-errors`} problems={messagesAt(["fields"])} />
        <ol className="grid gap-3">
          {custom.fields.map((field, position) => (
            <FieldEditor
              key={position}
              api={api}
              index={index}
              custom={custom}
              field={field}
              position={position}
              count={custom.fields.length}
              messagesAt={messagesAt}
              onChange={(next) => setField(position, next)}
              onMove={(to) => set("fields", moveItem(custom.fields, position, to))}
              onRemove={() =>
                set(
                  "fields",
                  custom.fields.filter((_, at) => at !== position),
                )
              }
            />
          ))}
        </ol>
        {!readOnly && (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const taken = new Set(custom.fields.map((field) => field.key));
                let number = custom.fields.length + 1;
                while (taken.has(`field${number}`)) number += 1;
                set("fields", [...custom.fields, { key: `field${number}`, label: "New field", type: "text" }]);
              }}
            >
              <PlusIcon aria-hidden />
              Add Field
            </Button>
          </div>
        )}
      </fieldset>
    </div>
  );
}

function FieldEditor({
  api,
  index,
  custom,
  field,
  position,
  count,
  messagesAt,
  onChange,
  onMove,
  onRemove,
}: {
  api: EditorApi;
  index: number;
  custom: CustomModule;
  field: Field;
  position: number;
  count: number;
  messagesAt: (path: FormPath) => EditorProblem[];
  onChange: (next: Field) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const readOnly = !api.editable;
  const at = (...path: (string | number)[]): FormPath => ["fields", position, ...path];
  const idOf = (...path: (string | number)[]) => customFieldId(index, at(...path));
  const numeric = NUMERIC.has(field.type);
  const name = field.label.trim() || `Field ${position + 1}`;
  const set = <K extends keyof Field>(key: K, value: Field[K] | undefined) => {
    const next = { ...field } as Record<string, unknown>;
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next as Field);
  };
  const mapOptions = mappableFor(api, field.type);

  return (
    <li className="grid gap-4 rounded-lg bg-slate-50 p-4 ring-1 ring-border" data-field-key={field.key}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">
          {position + 1}. {name}
        </p>
        {!readOnly && (
          <span className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon-sm" disabled={position === 0} onClick={() => onMove(position - 1)} aria-label={`Move ${name} up`}>
              <ArrowUpIcon aria-hidden />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" disabled={position === count - 1} onClick={() => onMove(position + 1)} aria-label={`Move ${name} down`}>
              <ArrowDownIcon aria-hidden />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" disabled={count === 1} onClick={onRemove} aria-label={`Remove ${name}`}>
              <XIcon aria-hidden />
            </Button>
          </span>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TextField id={idOf("label")} label={CUSTOM_FIELD_LABELS.label} value={field.label} readOnly={readOnly} problems={messagesAt(at("label"))} onChange={(label) => set("label", label)} />
        <TextField id={idOf("key")} label={CUSTOM_FIELD_LABELS.key} value={field.key} readOnly={readOnly} monospace problems={messagesAt(at("key"))} onChange={(key) => set("key", key)} />
        <div className="grid gap-1.5">
          <Label htmlFor={idOf("type")}>{CUSTOM_FIELD_LABELS.type}</Label>
          <OptionSelect
            id={idOf("type")}
            value={field.type}
            options={FieldTypeSchema.options.map((type) => ({ value: type, label: FIELD_TYPE_LABEL[type] }))}
            readOnly={readOnly}
            invalid={messagesAt(at("type")).length > 0}
            describedBy={describedBy(idOf("type"), messagesAt(at("type")))}
            onChange={(type) => onChange(retype(field, type as FieldType))}
          />
          <Messages id={`${idOf("type")}-errors`} problems={messagesAt(at("type"))} />
        </div>
        {numeric && (
          <div className="grid gap-1.5">
            <Label htmlFor={idOf("unit")}>{CUSTOM_FIELD_LABELS.unit}</Label>
            <OptionSelect
              id={idOf("unit")}
              value={field.unit ?? null}
              options={[{ value: null, label: "None" }, ...UnitSchema.options.map((unit) => ({ value: unit, label: unit }))]}
              readOnly={readOnly}
              invalid={messagesAt(at("unit")).length > 0}
              describedBy={describedBy(idOf("unit"), messagesAt(at("unit")))}
              onChange={(unit) => set("unit", unit === null ? undefined : (unit as Field["unit"]))}
            />
            <Messages id={`${idOf("unit")}-errors`} problems={messagesAt(at("unit"))} />
          </div>
        )}
        {numeric &&
          (["min", "max"] as const).map((bound) => (
            <div key={bound} className="grid gap-1.5">
              <Label htmlFor={idOf(bound)}>{CUSTOM_FIELD_LABELS[bound]}</Label>
              <NumberInput
                id={idOf(bound)}
                value={field[bound]}
                unit={field.unit}
                emptyAs="missing"
                placeholder="No limit"
                readOnly={readOnly}
                invalid={messagesAt(at(bound)).length > 0}
                describedBy={describedBy(idOf(bound), messagesAt(at(bound)))}
                // What was typed, number or not: CustomModuleSchema says what is wrong with "2 40".
                onChange={(value) => set(bound, (value ?? undefined) as number | undefined)}
              />
              <Messages id={`${idOf(bound)}-errors`} problems={messagesAt(at(bound))} />
            </div>
          ))}
        {field.type === "select" && (
          <div className="grid gap-1.5 md:col-span-2">
            <Label htmlFor={idOf("options")}>{CUSTOM_FIELD_LABELS.options}</Label>
            <LinesInput
              id={idOf("options")}
              value={field.options ?? []}
              readOnly={readOnly}
              invalid={messagesAt(at("options")).length > 0}
              errorsId={messagesAt(at("options")).length > 0 ? `${idOf("options")}-errors` : undefined}
              onChange={(options) => set("options", options)}
            />
            <Messages id={`${idOf("options")}-errors`} problems={messagesAt(at("options"))} />
          </div>
        )}
        <TextField
          id={idOf("hint")}
          label={CUSTOM_FIELD_LABELS.hint}
          hint="Shown under the field on the capture screen."
          value={field.hint ?? ""}
          readOnly={readOnly}
          problems={messagesAt(at("hint"))}
          onChange={(hint) => set("hint", hint.trim() === "" ? undefined : hint)}
        />
        {custom.layout === "fields" && (
          <div className="grid gap-1.5">
            <Label htmlFor={idOf("mapsTo")}>{CUSTOM_FIELD_LABELS.mapsTo}</Label>
            <OptionSelect
              id={idOf("mapsTo")}
              value={field.mapsTo ?? null}
              options={withCurrentPath([{ value: null, label: "No: Keeps Its Own Value" }, ...mapOptions], field.mapsTo)}
              readOnly={readOnly}
              invalid={messagesAt(at("mapsTo")).length > 0}
              describedBy={describedBy(idOf("mapsTo"), messagesAt(at("mapsTo")), true)}
              onChange={(mapsTo) => set("mapsTo", typeof mapsTo === "string" ? mapsTo : undefined)}
            />
            <p id={`${idOf("mapsTo")}-hint`} className="text-sm text-muted-foreground">
              Entered once, in the module, and shown here in this form&apos;s wording.
            </p>
            <Messages id={`${idOf("mapsTo")}-errors`} problems={messagesAt(at("mapsTo"))} />
          </div>
        )}
      </div>
      <SwitchField
        id={idOf("required")}
        label={CUSTOM_FIELD_LABELS.required}
        checked={field.required === true}
        readOnly={readOnly}
        onChange={(required) => set("required", required ? true : undefined)}
      />
    </li>
  );
}

/** A copy without one key. */
function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

/** A field changed to another type keeps only what that type can have. */
function retype(field: Field, type: FieldType): Field {
  const { unit, min, max, options, mapsTo, ...rest } = field;
  return {
    ...rest,
    type,
    ...(NUMERIC.has(type) ? { ...(unit ? { unit } : {}), ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) } : {}),
    ...(type === "select" ? { options: options ?? [] } : {}),
    ...(mapsTo !== undefined ? { mapsTo } : {}),
  };
}

/** Module values a field of this type can show (Field.mapsTo): the canonical paths of the template's modules. */
function mappableFor(api: EditorApi, type: FieldType): { value: string; label: string }[] {
  return moduleOrder(api.draft, api.context).flatMap((key) => {
    const view = moduleView(api.draft, api.context, key);
    if (!view.include) return [];
    return api.context.registry[key].canonicalPaths
      .filter((path) => isMappableType(type, path.type))
      .map((path) => ({
        value: canonicalPathOf(key, path.path),
        label: `${view.title}: ${view.labels[path.path] ?? path.label}`,
      }));
  });
}

function withCurrentPath(
  options: { value: string | null; label: string }[],
  current: string | undefined,
): { value: string | null; label: string }[] {
  if (current === undefined || options.some((option) => option.value === current)) return options;
  return [...options, { value: current, label: current }];
}

function TextField({
  id,
  label,
  hint,
  value,
  readOnly,
  monospace,
  problems,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  readOnly: boolean;
  monospace?: boolean;
  problems: readonly EditorProblem[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        readOnly={readOnly}
        autoComplete="off"
        spellCheck={!monospace}
        autoCapitalize={monospace ? "none" : undefined}
        className={cn(monospace && "font-mono")}
        aria-invalid={problems.length > 0 ? true : undefined}
        aria-describedby={describedBy(id, problems, Boolean(hint))}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      <Messages id={`${id}-errors`} problems={problems} />
    </div>
  );
}

function SwitchField({
  id,
  label,
  checked,
  readOnly,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  readOnly: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Switch id={id} checked={checked} disabled={readOnly} onCheckedChange={onChange} />
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
    </div>
  );
}

/** A list of words as lines of text; blank lines are dropped from the value, not from what is being typed. */
function LinesInput({
  id,
  value,
  readOnly,
  invalid,
  errorsId,
  onChange,
}: {
  id: string;
  value: readonly string[];
  readOnly: boolean;
  invalid: boolean;
  /** The id of its messages, when it has any. */
  errorsId?: string;
  onChange: (lines: string[]) => void;
}) {
  const [draft, setDraft] = useState<{ text: string; lines: string[] } | null>(null);
  const current = draft !== null && deepEqual(draft.lines, value) ? draft.text : value.join("\n");
  const hintId = useId();
  return (
    <>
      <Textarea
        id={id}
        value={current}
        readOnly={readOnly}
        rows={Math.max(3, value.length + 1)}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={[hintId, errorsId].filter(Boolean).join(" ")}
        onChange={(event) => {
          const text = event.target.value;
          const lines = text
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line !== "");
          setDraft({ text, lines });
          onChange(lines);
        }}
      />
      <p id={hintId} className="sr-only">
        One option per line.
      </p>
    </>
  );
}

/** A control's hint and messages, for aria-describedby: `custom-0-fields-1-min-errors`. */
function describedBy(id: string, problems: readonly EditorProblem[], hint = false): string | undefined {
  return [hint ? `${id}-hint` : null, problems.length > 0 ? `${id}-errors` : null].filter(Boolean).join(" ") || undefined;
}

function Messages({ id, problems }: { id: string; problems: readonly EditorProblem[] }) {
  if (problems.length === 0) return null;
  return (
    <div id={id} className="grid gap-1">
      {problems.map((problem) => (
        <p key={problem.id} className="text-sm text-destructive">
          {problem.message}
        </p>
      ))}
    </div>
  );
}
