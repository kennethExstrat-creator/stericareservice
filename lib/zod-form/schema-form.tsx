"use client";

// Draws a FormNode tree (describe.ts) with the app's own controls: objects as
// groups, booleans as switches, enums as selects, numbers with their unit,
// lists with add, move and remove, records keyed by what the caller offers
// (a template's sizes), tagged unions switched by their tag. Messages come
// from the zod schema by path (issues.ts). Every change hands the whole new
// value to onChange.
import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  JsonInput,
  NumberInput,
  OptionSelect,
  TextInput,
  type DraftText,
  type EmptyAs,
  type SelectOption,
} from "./controls";
import type {
  ArrayNode,
  EnumNode,
  FormNode,
  FormProperty,
  FormScalar,
  NullableNode,
  ObjectNode,
  RecordNode,
  UnionNode,
} from "./describe";
import { issuesAt, NO_ISSUES, type FormIssues, type FormPath } from "./issues";
import { humanize, numberRange, optionText } from "./labels";
import { emptyValue, emptyVariant, isPlainObject, moveItem, setAt, variantOf } from "./values";

export type KeyOption = { value: string; label: string };

/** What the page knows that the schema does not. Every hook is optional. */
export type SchemaFormHooks = {
  /** Words for a property or record key, e.g. the module's own label for that key; `node` is its value's. */
  labelForKey?: (key: string, path: FormPath, node: FormNode | undefined) => string | undefined;
  /** Words for an option of a select. */
  labelForOption?: (value: FormScalar, path: FormPath) => string | undefined;
  /** Choices for a string, or a record's keys, the schema marks (e.g. "size": the template's sizes). */
  markerOptions?: (marker: string, path: FormPath) => readonly KeyOption[] | undefined;
  /** Words for a union's variants, e.g. a spec's "min" as "Minimum (≥)". */
  variantLabel?: (marker: string | undefined, value: string) => string | undefined;
  /** Whether a setting or record entry may be removed (one the template inherits cannot). */
  canRemove?: (path: FormPath) => boolean;
  /** Set by this template, so it can be reset to what it inherits. */
  isOverridden?: (path: FormPath) => boolean;
  onReset?: (path: FormPath) => void;
  /** "Use default", "Use STD_EG's". */
  resetLabel?: string;
  /**
   * JSON text that is not a value yet, or null once it is. The page keeps it
   * when the field closes (it still stops a save) and hands it back through
   * `draftFor`. Numbers need neither: what is typed is stored, and the schema
   * says what is wrong with it.
   */
  onDraftError?: (path: FormPath, draft: DraftText | null) => void;
  draftFor?: (path: FormPath) => DraftText | undefined;
  /** Suggestions while typing into a text field, e.g. the defect codes for a `code`. */
  suggestionsFor?: (path: FormPath, node: FormNode) => readonly KeyOption[] | undefined;
  /** A note under a field that is valid but worth a look, e.g. a code that is not in the list. */
  noteFor?: (path: FormPath, value: unknown, node: FormNode) => string | undefined;
};

type FormContextValue = {
  idPrefix: string;
  issues: FormIssues;
  readOnly: boolean;
  hooks: SchemaFormHooks;
};

const FormContext = createContext<FormContextValue>({ idPrefix: "form", issues: NO_ISSUES, readOnly: false, hooks: {} });

/** In the second and later items of a list the descriptions are left out: the first one said it. */
const QuietContext = createContext(false);

export type SchemaFormProps = {
  node: FormNode;
  value: unknown;
  onChange: (next: unknown) => void;
  /** Field ids start with this; unique on the page. */
  idPrefix: string;
  issues?: FormIssues;
  readOnly?: boolean;
  hooks?: SchemaFormHooks;
  /** Name of the whole value when it is not an object of settings (an object's settings are named one by one). */
  label?: string;
  className?: string;
};

/** A form for any value a FormNode describes. */
export function SchemaForm({
  node,
  value,
  onChange,
  idPrefix,
  issues = NO_ISSUES,
  readOnly = false,
  hooks = {},
  label = "Value",
  className,
}: SchemaFormProps) {
  const context: FormContextValue = { idPrefix, issues, readOnly, hooks };
  return (
    <FormContext.Provider value={context}>
      <div data-slot="schema-form" className={cn("grid gap-5", className)}>
        <FieldErrors path={[]} />
        {node.kind === "object" ? (
          <ObjectFields node={node} value={value} onChange={onChange} path={[]} unit={false} />
        ) : (
          <NodeField node={node} value={value} onChange={onChange} path={[]} label={label} required unit={false} />
        )}
      </div>
    </FormContext.Provider>
  );
}

/* ------------------------------------------------------------------ *
 * Shared pieces
 * ------------------------------------------------------------------ */

function useForm() {
  return useContext(FormContext);
}

/** A stable, valid id for the field at a path. */
export function fieldId(idPrefix: string, path: FormPath): string {
  const parts = path.map((segment) => String(segment).replace(/[^A-Za-z0-9_-]/g, "_"));
  return [idPrefix, ...(parts.length > 0 ? parts : ["root"])].join("-");
}

function FieldErrors({ path, id }: { path: FormPath; id?: string }) {
  const { issues } = useForm();
  const messages = issuesAt(issues, path);
  if (messages.length === 0) return null;
  return (
    <div id={id} className="grid gap-1" data-slot="field-errors">
      {messages.map((message) => (
        <p key={message} className="text-sm text-destructive">
          {message}
        </p>
      ))}
    </div>
  );
}

type NodeProps<N extends FormNode = FormNode> = {
  node: N;
  value: unknown;
  onChange: (next: unknown) => void;
  path: FormPath;
  /**
   * Inside a list or a tagged union: the template replaces the whole list or
   * union, so its parts carry no reset of their own.
   */
  unit: boolean;
};

type FieldProps = NodeProps & {
  label: string;
  required: boolean;
  /** Shown next to the label: Remove, for an optional setting. */
  onRemove?: () => void;
  /** Label for screen readers only; "sm" from 640 px, where a compact row's header names the column. */
  hideLabel?: boolean | "sm";
};

function labelText(node: FormNode, key: string | number | undefined, path: FormPath, hooks: SchemaFormHooks): string {
  if (node.title) return node.title;
  if (typeof key === "string") return hooks.labelForKey?.(key, path, node) ?? humanize(key);
  return typeof key === "number" ? String(key + 1) : "Value";
}

function optionsOf(node: EnumNode, path: FormPath, hooks: SchemaFormHooks): SelectOption[] {
  return node.options.map((option) => ({
    value: option.value,
    label: option.label ?? hooks.labelForOption?.(option.value, path) ?? optionText(option.value),
  }));
}

/** The label row: name, unit, and the Reset and Remove actions. */
function FieldHeader({
  label,
  htmlFor,
  unitText,
  path,
  overridable,
  onRemove,
  as = "label",
  hidden = false,
}: {
  label: string;
  htmlFor?: string;
  unitText?: string;
  path: FormPath;
  overridable: boolean;
  onRemove?: () => void;
  as?: "label" | "legend" | "span";
  hidden?: boolean | "sm";
}) {
  const { hooks, readOnly } = useForm();
  const overridden = overridable && (hooks.isOverridden?.(path) ?? false);
  const hide = hidden === true ? "sr-only" : hidden === "sm" ? "sm:sr-only" : undefined;
  const name = (
    <>
      {label}
      {unitText && <span className="font-normal text-muted-foreground"> ({unitText})</span>}
    </>
  );
  const title =
    as === "label" ? (
      <Label htmlFor={htmlFor} className={cn("leading-snug", hide)}>
        {name}
      </Label>
    ) : as === "legend" ? (
      <legend className={cn("text-sm font-semibold text-foreground", hide)}>{name}</legend>
    ) : (
      <span className={cn("text-sm font-medium", hide)}>{name}</span>
    );
  if (!overridden && !onRemove) return title;
  return (
    <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-3 gap-y-1">
      {title}
      <span className="flex items-center gap-1">
        {overridden && (
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">Changed</span>
        )}
        {overridden && !readOnly && hooks.onReset && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => hooks.onReset?.(path)}
            aria-label={`${hooks.resetLabel ?? "Reset"}: ${label}`}
          >
            <RotateCcwIcon aria-hidden />
            {hooks.resetLabel ?? "Reset"}
          </Button>
        )}
        {onRemove && !readOnly && (
          <Button type="button" variant="ghost" size="xs" onClick={onRemove} aria-label={`Remove ${label}`}>
            <XIcon aria-hidden />
            Remove
          </Button>
        )}
      </span>
    </div>
  );
}

function Description({ id, text }: { id: string; text?: string }) {
  const quiet = useContext(QuietContext);
  if (!text || quiet) return null;
  return (
    <p id={id} className="text-sm text-muted-foreground">
      {text}
    </p>
  );
}

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

function NodeField(props: FieldProps) {
  const { node } = props;
  switch (node.kind) {
    case "object":
      return <ObjectGroup {...props} node={node} />;
    case "record":
      return <RecordGroup {...props} node={node} />;
    case "array":
      return <ArrayGroup {...props} node={node} />;
    case "union":
      return <UnionField {...props} node={node} />;
    case "nullable":
      return <NullableField {...props} node={node} />;
    case "boolean":
      return <BooleanField {...props} />;
    default:
      return <ScalarField {...props} />;
  }
}

/* ------------------------------------------------------------------ *
 * Scalars: text, numbers, options, JSON
 * ------------------------------------------------------------------ */

function ScalarField({ node, value, onChange, path, label, required, onRemove, hideLabel, unit }: FieldProps) {
  const { idPrefix, issues, readOnly, hooks } = useForm();
  const quiet = useContext(QuietContext);
  const id = fieldId(idPrefix, path);
  const descriptionId = `${id}-description`;
  const errorId = `${id}-errors`;
  const errors = issuesAt(issues, path);
  // What a number accepts, from the schema's limits: "0 to 100." (left out in later list items, as descriptions are).
  const range = node.kind === "number" && !quiet ? numberRange(node) : undefined;
  const rangeId = `${id}-range`;
  const describedBy = [
    range ? rangeId : null,
    node.description && !quiet ? descriptionId : null,
    errors.length > 0 ? errorId : null,
  ]
    .filter(Boolean)
    .join(" ") || undefined;
  const emptyAs: EmptyAs = required ? "empty" : "missing";

  let control: ReactNode;
  switch (node.kind) {
    case "number":
      control = (
        <NumberInput
          id={id}
          value={value}
          onChange={onChange}
          integer={node.integer}
          unit={node.unit}
          // Emptied, a required number stays the template's own, empty: the schema asks for a number, and the
          // value it inherits does not come back in its place. "Use default" goes back to that one.
          emptyAs={required ? "null" : "missing"}
          describedBy={describedBy}
          invalid={errors.length > 0}
          readOnly={readOnly}
        />
      );
      break;
    case "string": {
      const marked = node.marker ? hooks.markerOptions?.(node.marker, path) : undefined;
      control = marked ? (
        <OptionSelect
          id={id}
          value={value}
          options={withCurrent(
            marked.map((option) => ({ value: option.value, label: option.label })),
            value,
          )}
          onChange={onChange}
          describedBy={describedBy}
          invalid={errors.length > 0}
          readOnly={readOnly}
        />
      ) : (
        <TextInput
          id={id}
          value={value}
          onChange={onChange}
          emptyAs={emptyAs}
          maxLength={node.maxLength}
          suggestions={hooks.suggestionsFor?.(path, node)}
          describedBy={describedBy}
          invalid={errors.length > 0}
          readOnly={readOnly}
          className={node.maxLength !== undefined && node.maxLength <= 40 ? "max-w-80" : undefined}
        />
      );
      break;
    }
    case "enum":
      control = (
        <OptionSelect
          id={id}
          value={value}
          options={optionsOf(node, path, hooks)}
          onChange={onChange}
          describedBy={describedBy}
          invalid={errors.length > 0}
          readOnly={readOnly}
        />
      );
      break;
    case "literal":
      control = (
        <p id={id} className="text-sm text-foreground">
          {optionText(node.value)}
        </p>
      );
      break;
    default:
      control = (
        <JsonInput
          id={id}
          value={value}
          onChange={onChange}
          describedBy={describedBy}
          invalid={errors.length > 0}
          readOnly={readOnly}
          onDraftError={hooks.onDraftError ? (draft) => hooks.onDraftError?.(path, draft) : undefined}
          restore={hooks.draftFor?.(path)}
        />
      );
  }

  const note = hooks.noteFor?.(path, value, node);
  return (
    <div className="grid gap-1.5" data-slot="form-field" data-kind={node.kind}>
      <FieldHeader
        label={label}
        htmlFor={node.kind === "literal" ? undefined : id}
        as={node.kind === "literal" ? "span" : "label"}
        unitText={node.kind === "number" ? undefined : node.unit}
        path={path}
        overridable={!unit}
        onRemove={onRemove}
        hidden={hideLabel}
      />
      {control}
      {range && (
        <p id={rangeId} className="text-sm text-muted-foreground">
          {range}
        </p>
      )}
      {note && <p className="text-sm text-warn">{note}</p>}
      <Description id={descriptionId} text={node.description} />
      {errors.length > 0 && (
        <div id={errorId} className="grid gap-1">
          {errors.map((message) => (
            <p key={message} className="text-sm text-destructive">
              {message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** The current value stays choosable even when it is not one of the offered options. */
function withCurrent(options: SelectOption[], value: unknown): SelectOption[] {
  if (typeof value !== "string" || value === "" || options.some((option) => option.value === value)) return options;
  return [...options, { value, label: value }];
}

function BooleanField({ node, value, onChange, path, label, onRemove, hideLabel, unit }: FieldProps) {
  const { idPrefix, issues, readOnly } = useForm();
  const quiet = useContext(QuietContext);
  const id = fieldId(idPrefix, path);
  const descriptionId = `${id}-description`;
  const errors = issuesAt(issues, path);
  return (
    <div className="grid gap-1.5" data-slot="form-field" data-kind="boolean">
      <div className={cn("flex gap-3", hideLabel ? "min-h-9 items-center touch:min-h-11" : "items-start")}>
        <Switch
          id={id}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked)}
          disabled={readOnly}
          aria-describedby={node.description && !quiet ? descriptionId : undefined}
          aria-invalid={errors.length > 0 ? true : undefined}
          className="mt-0.5 touch:mt-0"
        />
        <div className="grid min-w-0 flex-1 gap-1">
          <FieldHeader label={label} htmlFor={id} path={path} overridable={!unit} onRemove={onRemove} hidden={hideLabel} />
          <Description id={descriptionId} text={node.description} />
        </div>
      </div>
      <FieldErrors path={path} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Objects
 * ------------------------------------------------------------------ */

/** The settings of an object, one after the other; optional ones can be added and removed. */
function ObjectFields({ node, value, onChange, path, unit, columns = false }: NodeProps<ObjectNode> & { columns?: boolean }) {
  const { hooks, readOnly } = useForm();
  const object = isPlainObject(value) ? value : {};
  const onlySwitches = node.properties.length > 1 && node.properties.every((property) => property.node.kind === "boolean");
  // A few short plain settings, such as decimals per measure, sit side by side.
  const terse =
    node.properties.length >= 3 &&
    node.properties.every(
      (property) =>
        isPlain(property.node) &&
        (property.required || inlineOptional(property.node)) &&
        (property.node.description ?? "").length <= 60,
    );

  return (
    <div
      className={cn(
        "grid gap-5",
        onlySwitches && "gap-x-6 gap-y-4 sm:grid-cols-2",
        !onlySwitches && (columns || terse) && "gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]",
      )}
    >
      {node.properties.map((property) => {
        const childPath = [...path, property.key];
        const childValue = object[property.key];
        const present = childValue !== undefined;
        const label = labelText(property.node, property.key, childPath, hooks);
        const set = (next: unknown) => onChange(setAt(object, [property.key], next));
        const removable =
          !property.required && present && !readOnly && (hooks.canRemove?.(childPath) ?? true) && !inlineOptional(property.node);
        if (!property.required && !present && !inlineOptional(property.node)) {
          return (
            <NotSet
              key={property.key}
              label={label}
              description={property.node.description}
              path={childPath}
              onSet={() => set(emptyValue(property.node))}
            />
          );
        }
        return (
          <NodeField
            key={property.key}
            node={property.node}
            value={childValue}
            onChange={set}
            path={childPath}
            label={label}
            required={property.required}
            onRemove={removable ? () => set(undefined) : undefined}
            unit={unit}
          />
        );
      })}
    </div>
  );
}

/** Optional text and numbers need no Add: leaving them empty leaves them out. */
function inlineOptional(node: FormNode): boolean {
  return node.kind === "string" || node.kind === "number";
}

function NotSet({
  label,
  description,
  path,
  onSet,
}: {
  label: string;
  description?: string;
  path: FormPath;
  onSet: () => void;
}) {
  const { readOnly } = useForm();
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-dashed border-border px-3 py-2"
      data-slot="form-field"
      data-kind="not-set"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-sm text-muted-foreground">{description ? `Not set. ${description}` : "Not set."}</p>
      </div>
      {!readOnly && (
        <Button type="button" variant="outline" size="sm" onClick={onSet} aria-label={`Add ${label}`}>
          <PlusIcon aria-hidden />
          Add
        </Button>
      )}
      <FieldErrors path={path} />
    </div>
  );
}

function ObjectGroup({ node, value, onChange, path, label, onRemove, hideLabel, unit }: FieldProps & { node: ObjectNode }) {
  const { idPrefix } = useForm();
  const id = fieldId(idPrefix, path);
  return (
    <fieldset
      className="grid min-w-0 gap-4 rounded-lg border border-border p-3"
      data-slot="form-group"
      aria-describedby={node.description ? `${id}-description` : undefined}
    >
      <FieldHeader label={label} as="legend" path={path} overridable={false} onRemove={onRemove} hidden={hideLabel} />
      <Description id={`${id}-description`} text={node.description} />
      <FieldErrors path={path} />
      <ObjectFields node={node} value={value} onChange={onChange} path={path} unit={unit} />
    </fieldset>
  );
}

/* ------------------------------------------------------------------ *
 * Records: entries keyed by size, or by any key
 * ------------------------------------------------------------------ */

function RecordGroup({ node, value, onChange, path, label, onRemove, unit }: FieldProps & { node: RecordNode }) {
  const { idPrefix, hooks, readOnly } = useForm();
  const id = fieldId(idPrefix, path);
  const object = isPlainObject(value) ? value : {};
  const keys = Object.keys(object);
  const offered = node.key.marker ? hooks.markerOptions?.(node.key.marker, path) : undefined;
  const keyLabel = (key: string) =>
    offered?.find((option) => option.value === key)?.label ?? hooks.labelForKey?.(key, [...path, key], node.value) ?? key;
  const available = offered?.filter((option) => !keys.includes(option.value));

  return (
    <fieldset className="grid min-w-0 gap-4 rounded-lg border border-border p-3" data-slot="form-group" data-kind="record">
      <FieldHeader label={label} as="legend" path={path} overridable={false} onRemove={onRemove} />
      <Description id={`${id}-description`} text={node.description} />
      <FieldErrors path={path} />
      {keys.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
      {keys.map((key) => {
        const entryPath = [...path, key];
        const removable = !readOnly && (hooks.canRemove?.(entryPath) ?? true);
        const remove = () => {
          const next = { ...object };
          delete next[key];
          onChange(next);
        };
        const entryLabel = keyLabel(key);
        return (
          <div key={key} className="grid gap-3 rounded-md bg-slate-50 p-3 ring-1 ring-border" data-record-key={key}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">{entryLabel}</p>
              {removable && (
                <Button type="button" variant="ghost" size="xs" onClick={remove} aria-label={`Remove ${entryLabel}`}>
                  <XIcon aria-hidden />
                  Remove
                </Button>
              )}
            </div>
            <FieldErrors path={entryPath} />
            {node.value.kind === "object" ? (
              <ObjectFields
                node={node.value}
                value={object[key]}
                onChange={(next) => onChange({ ...object, [key]: next })}
                path={entryPath}
                unit={unit}
              />
            ) : (
              <NodeField
                node={node.value}
                value={object[key]}
                onChange={(next) => onChange({ ...object, [key]: next })}
                path={entryPath}
                label={entryLabel}
                required
                hideLabel={node.value.kind !== "boolean"}
                unit={unit}
              />
            )}
          </div>
        );
      })}
      {!readOnly && (
        <AddEntry
          id={`${id}-new-key`}
          label={label}
          noun={node.key.marker === "size" ? "size" : "entry"}
          options={available}
          pattern={node.key.pattern}
          taken={keys}
          onAdd={(key) => onChange({ ...object, [key]: emptyValue(node.value) })}
        />
      )}
    </fieldset>
  );
}

function AddEntry({
  id,
  label,
  noun,
  options,
  pattern,
  taken,
  onAdd,
}: {
  id: string;
  label: string;
  /** What a key is, for "Add a size". */
  noun: string;
  options?: readonly KeyOption[];
  pattern?: string;
  taken: readonly string[];
  onAdd: (key: string) => void;
}) {
  if (options) {
    if (options.length === 0) return null;
    return (
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor={id}>
            Add {noun === "entry" ? "an" : "a"} {noun}
            <span className="sr-only"> to {label}</span>
          </Label>
          <OptionSelect
            id={id}
            value={undefined}
            placeholder="Choose…"
            options={options.map((option) => ({ value: option.value, label: option.label }))}
            onChange={(next) => {
              if (typeof next === "string") onAdd(next);
            }}
            className="min-w-40"
          />
        </div>
      </div>
    );
  }
  return <AddKeyForm id={id} label={label} pattern={pattern} taken={taken} onAdd={onAdd} />;
}

function AddKeyForm({
  id,
  label,
  pattern,
  taken,
  onAdd,
}: {
  id: string;
  label: string;
  pattern?: string;
  taken: readonly string[];
  onAdd: (key: string) => void;
}) {
  // Uncontrolled on purpose: the key is only read when Add is pressed.
  return (
    <div className="flex flex-wrap items-end gap-2" data-slot="add-key">
      <div className="grid gap-1.5">
        <Label htmlFor={id}>New key in {label.toLowerCase()}</Label>
        <Input
          id={id}
          className="w-48 font-mono"
          autoComplete="off"
          spellCheck={false}
          pattern={pattern}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const key = event.currentTarget.value.trim();
            if (key !== "" && !taken.includes(key)) {
              onAdd(key);
              event.currentTarget.value = "";
            }
          }}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={(event) => {
          const input = event.currentTarget.parentElement?.querySelector("input");
          const key = input?.value.trim() ?? "";
          if (input && key !== "" && !taken.includes(key)) {
            onAdd(key);
            input.value = "";
          }
        }}
      >
        <PlusIcon aria-hidden />
        Add
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Lists
 * ------------------------------------------------------------------ */

function ArrayGroup({ node, value, onChange, path, label, onRemove, unit }: FieldProps & { node: ArrayNode }) {
  const { idPrefix, readOnly } = useForm();
  const id = fieldId(idPrefix, path);
  const list = Array.isArray(value) ? value : [];
  const items = node.items;

  if (items.kind === "enum") {
    return (
      <EnumSet
        node={node}
        items={items}
        list={list}
        onChange={onChange}
        path={path}
        label={label}
        onRemove={onRemove}
        unit={unit}
      />
    );
  }

  const itemLabel = humanize(singularLabel(label));
  const flat = items.kind !== "object" && items.kind !== "union" && items.kind !== "array" && items.kind !== "record";
  const canAdd = !readOnly && (node.maxItems === undefined || list.length < node.maxItems);
  const addButton = canAdd && (
    <div>
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...list, emptyValue(items)])}>
        <PlusIcon aria-hidden />
        Add {itemLabel.toLowerCase()}
      </Button>
    </div>
  );

  if (items.kind === "object" && isCompactRow(items)) {
    return (
      <fieldset className="grid min-w-0 gap-3 rounded-lg border border-border p-3" data-slot="form-group" data-kind="rows">
        <FieldHeader label={label} as="legend" path={path} overridable={!unit} onRemove={onRemove} />
        <Description id={`${id}-description`} text={node.description} />
        <FieldErrors path={path} />
        {list.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
        <CompactRows items={items} list={list} onChange={onChange} path={path} itemLabel={itemLabel} />
        {addButton}
      </fieldset>
    );
  }

  return (
    <fieldset className="grid min-w-0 gap-3 rounded-lg border border-border p-3" data-slot="form-group" data-kind="array">
      <FieldHeader label={label} as="legend" path={path} overridable={!unit} onRemove={onRemove} />
      <Description id={`${id}-description`} text={node.description} />
      <FieldErrors path={path} />
      {list.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
      <ol className="grid gap-3">
        {list.map((item, index) => {
          const itemPath = [...path, index];
          const name = `${itemLabel} ${index + 1}`;
          const actions = !readOnly && (
            <ItemActions
              name={name}
              first={index === 0}
              last={index === list.length - 1}
              onMove={(to) => onChange(moveItem(list, index, to === "up" ? index - 1 : index + 1))}
              onRemove={() => onChange(list.filter((_, position) => position !== index))}
            />
          );
          if (flat) {
            return (
              <li key={index} className="flex flex-wrap items-end gap-2" data-item={index}>
                <div className="min-w-0 flex-1">
                  <QuietContext.Provider value={index > 0}>
                    <NodeField
                      node={items}
                      value={item}
                      onChange={(next) => onChange(list.map((entry, position) => (position === index ? next : entry)))}
                      path={itemPath}
                      label={name}
                      required
                      hideLabel={items.kind !== "boolean"}
                      unit
                    />
                  </QuietContext.Provider>
                </div>
                {actions}
              </li>
            );
          }
          return (
            <li key={index} className="grid gap-3 rounded-md bg-slate-50 p-3 ring-1 ring-border" data-item={index}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">
                  {name}
                  <ItemSummary value={item} />
                </p>
                {actions}
              </div>
              <FieldErrors path={itemPath} />
              {items.kind === "object" ? (
                <QuietContext.Provider value={index > 0}>
                  <ObjectFields
                    node={items}
                    value={item}
                    onChange={(next) => onChange(list.map((entry, position) => (position === index ? next : entry)))}
                    path={itemPath}
                    unit
                    columns={isFlat(items)}
                  />
                </QuietContext.Provider>
              ) : (
                <NodeField
                  node={items}
                  value={item}
                  onChange={(next) => onChange(list.map((entry, position) => (position === index ? next : entry)))}
                  path={itemPath}
                  label={name}
                  required
                  hideLabel
                  unit
                />
              )}
            </li>
          );
        })}
      </ol>
      {addButton}
    </fieldset>
  );
}

/**
 * Small objects whose settings are all plain and always there (a size and its
 * label; a code, its wording and whether it passes): one compact row each.
 */
function isCompactRow(node: ObjectNode): boolean {
  return isFlat(node) && node.properties.every((property) => property.required || inlineOptional(property.node));
}

/** How much of a compact row a setting takes: codes and numbers little, wording more, a switch least. */
function columnWidth(property: FormProperty): string {
  const node = property.node.kind === "nullable" ? property.node.inner : property.node;
  switch (node.kind) {
    case "boolean":
      return "minmax(0,0.6fr)";
    case "string":
      // Codes such as embedded_insect need room; wording more.
      return /(code|key|value)$/i.test(property.key) || node.pattern !== undefined || (node.maxLength ?? Infinity) <= 40
        ? "minmax(0,1.4fr)"
        : "minmax(0,2fr)";
    case "enum":
      return "minmax(0,1.2fr)";
    default:
      return "minmax(0,1fr)";
  }
}

/** Width of a row's move and remove buttons, kept free in the header so the columns line up. */
const ROW_ACTIONS = "w-[6.5rem] touch:w-[8.75rem]";

/**
 * A list of small objects as rows under one header (DESIGN.md: compact rows):
 * the header names each column once, with its description and range; each row
 * is a group named by its item ("Stickiness code 2"), its fields labelled for
 * screen readers, and its move and remove buttons at the end.
 */
function CompactRows({
  items,
  list,
  onChange,
  path,
  itemLabel,
}: {
  items: ObjectNode;
  list: readonly unknown[];
  onChange: (next: unknown) => void;
  path: FormPath;
  itemLabel: string;
}) {
  const { readOnly, hooks, issues } = useForm();
  const columns = items.properties.map((property) => {
    const inner = property.node.kind === "nullable" ? property.node.inner : property.node;
    return {
      key: property.key,
      label: labelText(property.node, property.key, [...path, 0, property.key], hooks),
      note: [property.node.description, inner.kind === "number" ? numberRange(inner) : undefined].filter(Boolean).join(" "),
    };
  });
  const template = { "--row-columns": items.properties.map(columnWidth).join(" ") } as CSSProperties;
  const notes = columns.filter((column) => column.note !== "");
  if (list.length === 0) return null;

  return (
    <div className="grid gap-2" style={template}>
      {/* What each column takes, once: a column is too narrow for a sentence. */}
      {notes.length > 0 && (
        <ul className="grid gap-0.5 text-sm text-muted-foreground" data-slot="row-notes">
          {notes.map((column) => (
            <li key={column.key}>
              <span className="font-medium text-foreground">{column.label}:</span> {column.note}
            </li>
          ))}
        </ul>
      )}
      <div className="hidden items-end gap-2 px-2 sm:flex" data-slot="row-header" aria-hidden>
        <div className="grid min-w-0 flex-1 grid-cols-(--row-columns) gap-x-3">
          {columns.map((column) => (
            <span key={column.key} className="truncate text-sm font-medium text-foreground">
              {column.label}
            </span>
          ))}
        </div>
        {!readOnly && <span className={cn("shrink-0", ROW_ACTIONS)} />}
      </div>
      <ol className="grid gap-2">
        {list.map((item, index) => {
          const itemPath = [...path, index];
          const name = `${itemLabel} ${index + 1}`;
          const object = isPlainObject(item) ? item : {};
          const setItem = (next: unknown) => onChange(list.map((entry, position) => (position === index ? next : entry)));
          return (
            <li key={index} data-item={index}>
              <fieldset className="flex min-w-0 items-start gap-2 rounded-md bg-slate-50 px-2 py-1.5 ring-1 ring-border">
                <legend className="sr-only">{name}</legend>
                <div className="grid min-w-0 flex-1 gap-x-3 gap-y-2 sm:grid-cols-(--row-columns)">
                  <QuietContext.Provider value>
                    {items.properties.map((property, column) => (
                      <NodeField
                        key={property.key}
                        node={property.node}
                        value={object[property.key]}
                        onChange={(next) => setItem(setAt(object, [property.key], next))}
                        path={[...itemPath, property.key]}
                        label={columns[column].label}
                        required={property.required}
                        hideLabel="sm"
                        unit
                      />
                    ))}
                  </QuietContext.Provider>
                  {issuesAt(issues, itemPath).length > 0 && (
                    <div className="sm:col-span-full">
                      <FieldErrors path={itemPath} />
                    </div>
                  )}
                </div>
                {!readOnly && (
                  <span className={cn("flex min-h-9 shrink-0 items-center justify-end touch:min-h-11", ROW_ACTIONS)}>
                    <ItemActions
                      name={name}
                      first={index === 0}
                      last={index === list.length - 1}
                      onMove={(to) => onChange(moveItem(list, index, to === "up" ? index - 1 : index + 1))}
                      onRemove={() => onChange(list.filter((_, position) => position !== index))}
                    />
                  </span>
                )}
              </fieldset>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A value with one plain control: text, a number, a switch, a select, a fixed value. */
function isPlain(child: FormNode): boolean {
  return (
    child.kind === "string" ||
    child.kind === "number" ||
    child.kind === "boolean" ||
    child.kind === "enum" ||
    child.kind === "literal" ||
    (child.kind === "nullable" && isPlain(child.inner))
  );
}

/** An object of plain values only (a size and its label, a code, its label and pass): its fields fit side by side. */
function isFlat(node: ObjectNode): boolean {
  return node.properties.length <= 4 && node.properties.every((property) => isPlain(property.node));
}

/** "Hole locations" names one item "hole location". */
function singularLabel(label: string): string {
  if (/ies$/i.test(label)) return `${label.slice(0, -3)}y`;
  if (/(ss|us)$/i.test(label)) return label;
  if (/s$/i.test(label)) return label.slice(0, -1);
  return label;
}

/** A short reminder of what an item is, from its first text values: "A · Non sticky". */
function ItemSummary({ value }: { value: unknown }) {
  if (!isPlainObject(value)) return null;
  const words = Object.values(value)
    .filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    .slice(0, 2);
  if (words.length === 0) return null;
  return <span className="font-normal text-muted-foreground"> · {words.join(" · ")}</span>;
}

function ItemActions({
  name,
  first,
  last,
  onMove,
  onRemove,
}: {
  name: string;
  first: boolean;
  last: boolean;
  onMove: (direction: "up" | "down") => void;
  onRemove: () => void;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Button type="button" variant="ghost" size="icon-sm" disabled={first} onClick={() => onMove("up")} aria-label={`Move ${name} up`}>
        <ArrowUpIcon aria-hidden />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" disabled={last} onClick={() => onMove("down")} aria-label={`Move ${name} down`}>
        <ArrowDownIcon aria-hidden />
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${name}`}>
        <XIcon aria-hidden />
      </Button>
    </span>
  );
}

/**
 * A list of options (the measures on): one checkbox per option. A ticked
 * option goes in at its place in the option order; the order of the rest is
 * kept as it is.
 */
function EnumSet({
  node,
  items,
  list,
  onChange,
  path,
  label,
  onRemove,
  unit,
}: {
  node: ArrayNode;
  items: EnumNode;
  list: readonly unknown[];
  onChange: (next: unknown) => void;
  path: FormPath;
  label: string;
  onRemove?: () => void;
  unit: boolean;
}) {
  const { idPrefix, hooks, readOnly } = useForm();
  const id = fieldId(idPrefix, path);
  const options = optionsOf(items, path, hooks);
  const extra = list.filter((entry) => !options.some((option) => option.value === entry));

  const toggle = (option: FormScalar, on: boolean) => {
    if (!on) return onChange(list.filter((entry) => entry !== option));
    if (list.includes(option)) return;
    const order = options.map((entry) => entry.value);
    const rank = order.indexOf(option);
    const before = list.findIndex((entry) => order.indexOf(entry as FormScalar) > rank);
    const next = [...list];
    next.splice(before === -1 ? next.length : before, 0, option);
    onChange(next);
  };

  return (
    <fieldset className="grid min-w-0 gap-3 rounded-lg border border-border p-3" data-slot="form-group" data-kind="set">
      <FieldHeader label={label} as="legend" path={path} overridable={!unit} onRemove={onRemove} />
      <Description id={`${id}-description`} text={node.description} />
      <FieldErrors path={path} />
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {options.map((option, index) => {
          const optionId = `${id}-${index}`;
          return (
            <div key={optionId} className="flex items-center gap-3">
              <Checkbox
                id={optionId}
                checked={list.includes(option.value)}
                disabled={readOnly}
                onCheckedChange={(checked) => toggle(option.value, checked === true)}
              />
              <Label htmlFor={optionId} className="font-normal">
                {option.label}
              </Label>
            </div>
          );
        })}
      </div>
      {extra.length > 0 && (
        <p className="text-sm text-destructive">Not an option: {extra.map((entry) => String(entry)).join(", ")}.</p>
      )}
    </fieldset>
  );
}

/* ------------------------------------------------------------------ *
 * Tagged unions and nullable values
 * ------------------------------------------------------------------ */

function UnionField({ node, value, onChange, path, label, onRemove, hideLabel, unit }: FieldProps & { node: UnionNode }) {
  const { idPrefix, hooks, readOnly, issues } = useForm();
  const id = fieldId(idPrefix, path);
  const tag = variantOf(node, value);
  const variant = node.variants.find((entry) => entry.value === tag);
  const tagPath = [...path, node.discriminator];
  const tagErrors = issuesAt(issues, tagPath);
  const options: SelectOption[] = node.variants.map((entry) => ({
    value: entry.value,
    label: hooks.variantLabel?.(node.marker, entry.value) ?? optionText(entry.value),
  }));
  const object = isPlainObject(value) ? value : {};
  const fields = variant?.node.properties.filter((property) => property.key !== node.discriminator) ?? [];

  return (
    <fieldset className="grid min-w-0 gap-3" data-slot="form-group" data-kind="union">
      <FieldHeader label={label} as="legend" path={path} overridable={!unit} onRemove={onRemove} hidden={hideLabel} />
      <div className="flex flex-wrap items-start gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-type`} className="text-muted-foreground">
            Type
          </Label>
          <OptionSelect
            id={`${id}-type`}
            value={tag}
            options={options}
            onChange={(next) => onChange(emptyVariant(node, String(next), value))}
            invalid={tagErrors.length > 0}
            readOnly={readOnly}
            className="min-w-44"
          />
        </div>
        <QuietContext.Provider value>
          {fields.map((property) => {
            const childPath = [...path, property.key];
            return (
              <div key={property.key} className="min-w-32">
                <NodeField
                  node={property.node}
                  value={object[property.key]}
                  onChange={(next) => onChange(setAt(object, [property.key], next))}
                  path={childPath}
                  label={labelText(property.node, property.key, childPath, hooks)}
                  required={property.required}
                  unit
                />
              </div>
            );
          })}
        </QuietContext.Provider>
      </div>
      {tagErrors.map((message) => (
        <p key={message} className="text-sm text-destructive">
          {message}
        </p>
      ))}
      <FieldErrors path={path} />
      <Description id={`${id}-description`} text={node.description} />
    </fieldset>
  );
}

function NullableField(props: FieldProps & { node: NullableNode }) {
  const { node, value, onChange, path, label, onRemove, hideLabel, unit } = props;
  const { idPrefix, issues, readOnly, hooks } = useForm();
  const quiet = useContext(QuietContext);
  const inner = node.inner;
  const id = fieldId(idPrefix, path);
  const descriptionId = `${id}-description`;
  const errors = issuesAt(issues, path);
  const range = inner.kind === "number" && !quiet ? numberRange(inner) : undefined;
  const rangeId = `${id}-range`;
  const describedBy = [
    range ? rangeId : null,
    node.description && !quiet ? descriptionId : null,
    errors.length > 0 ? `${id}-errors` : null,
  ]
    .filter(Boolean)
    .join(" ") || undefined;

  // Numbers and text: empty means none. Options: "None" is one of them.
  if (inner.kind === "number" || inner.kind === "string" || inner.kind === "enum") {
    let control: ReactNode;
    if (inner.kind === "number") {
      control = (
        <NumberInput
          id={id}
          value={value}
          onChange={onChange}
          integer={inner.integer}
          unit={inner.unit ?? node.unit}
          emptyAs="null"
          placeholder="None"
          describedBy={describedBy}
          invalid={errors.length > 0}
          readOnly={readOnly}
        />
      );
    } else if (inner.kind === "string") {
      control = (
        <TextInput
          id={id}
          value={value}
          onChange={onChange}
          emptyAs="null"
          placeholder="None"
          describedBy={describedBy}
          invalid={errors.length > 0}
          readOnly={readOnly}
        />
      );
    } else {
      control = (
        <OptionSelect
          id={id}
          value={value}
          options={[{ value: null, label: "None" }, ...optionsOf(inner, path, hooks)]}
          onChange={onChange}
          describedBy={describedBy}
          invalid={errors.length > 0}
          readOnly={readOnly}
        />
      );
    }
    return (
      <div className="grid gap-1.5" data-slot="form-field" data-kind={`nullable-${inner.kind}`}>
        <FieldHeader label={label} htmlFor={id} path={path} overridable={!unit} onRemove={onRemove} hidden={hideLabel} />
        {control}
        {range && (
          <p id={rangeId} className="text-sm text-muted-foreground">
            {range}
          </p>
        )}
        <Description id={descriptionId} text={node.description} />
        {errors.length > 0 && (
          <div id={`${id}-errors`} className="grid gap-1">
            {errors.map((message) => (
              <p key={message} className="text-sm text-destructive">
                {message}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Anything else: a switch between none and a value.
  const on = value !== null && value !== undefined;
  return (
    <div className="grid gap-3" data-slot="form-field" data-kind="nullable">
      <div className="flex items-start gap-3">
        <Switch
          id={`${id}-on`}
          checked={on}
          disabled={readOnly}
          onCheckedChange={(checked) => onChange(checked ? emptyValue(inner) : null)}
          aria-describedby={node.description && !quiet ? descriptionId : undefined}
          className="mt-0.5 touch:mt-0"
        />
        <div className="grid min-w-0 flex-1 gap-1">
          <FieldHeader label={label} htmlFor={`${id}-on`} path={path} overridable={!unit} onRemove={onRemove} />
          <Description id={descriptionId} text={node.description} />
        </div>
      </div>
      {on ? (
        <NodeField node={inner} value={value} onChange={onChange} path={path} label={label} required hideLabel unit={unit} />
      ) : (
        <FieldErrors path={path} />
      )}
    </div>
  );
}
