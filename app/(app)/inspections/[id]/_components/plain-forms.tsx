"use client";

// The forms the screen draws itself (lib/inspections/capture/fields.ts):
// custom modules in their three layouts, and the simplified form of a built
// module that has no capture form of its own yet. Labels come from the
// template (6.2 rule 11); values are stored where lib/validation reads
// them; every control is marked for issue links. Like a module's Capture,
// every write goes through the kit's useDataUpdater (docs/CAPTURE_KIT.md):
// each change starts from the latest value, so a pasted column of numbers
// or a value committed on blur as the section turns is never cut short.
import { useRef, type ReactNode } from "react";
import { PlusIcon } from "lucide-react";
import { EnterGroup, findIssue, useDataUpdater, useIssueFocus } from "@/components/qc";
import { Button } from "@/components/ui/button";
import {
  customFormField,
  fallbackFields,
  gridColumnCount,
  isPerSizeCustom,
  ownCustomFields,
  withGridCell,
  withGridColumn,
  type FormField,
} from "@/lib/inspections/capture/fields";
import type { CustomModule } from "@/lib/schemas/template";
import type { IssuePath, ValidationIssue } from "@/lib/validation";
import {
  readPath,
  sizeLabel,
  writePath,
  type AnyModuleDefinition,
  type CaptureFocus,
  type InspectionContext,
  type Labels,
} from "@/modules/_framework";
import { FieldControl } from "./field-control";

type Record_ = Record<string, unknown>;
type RecordChange = (current: Record_) => Record_;
type Update = (change: RecordChange) => void;

function asRecord(value: unknown): Record_ {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record_) : {};
}

/** The message of the issue that points exactly at `path`, errors first. */
function messageAt(issues: readonly ValidationIssue[], path: IssuePath): string | null {
  return findIssue(issues, path)?.message ?? null;
}

/** Changes to one size's record inside `{ sizes: { <size>: record } }`. */
function sizeScope(update: Update, size: string): Update {
  return (change) =>
    update((current) => {
      const sizes = asRecord(current.sizes);
      return { ...current, sizes: { ...sizes, [size]: change(asRecord(sizes[size])) } };
    });
}

/* ------------------------------------------------------------------ *
 * A built module without its own Capture
 * ------------------------------------------------------------------ */

export function FallbackModuleForm({
  definition,
  data,
  config,
  labels,
  issues,
  focusPath,
  readOnly,
  onChange,
}: {
  definition: AnyModuleDefinition;
  data: unknown;
  config: unknown;
  labels: Labels;
  issues: readonly ValidationIssue[];
  focusPath: IssuePath | null;
  readOnly: boolean;
  onChange: (next: Record_) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useIssueFocus(focusPath, { root });
  const record = asRecord(data);
  const update = useDataUpdater(record, onChange);
  const fields = fallbackFields(definition, config, labels);
  if (fields.length === 0) {
    return <Hint>This section has no form yet. It arrives in a later build.</Hint>;
  }
  return (
    <div ref={root} className="space-y-5">
      <EnterGroup className="grid gap-5 md:grid-cols-2">
        {fields.map((field) => (
          <FieldControl
            key={field.key}
            field={field}
            value={readPath(record, field.segments) ?? null}
            onChange={(value) => update((current) => asRecord(writePath(current, field.segments, value)))}
            readOnly={readOnly}
            issuePath={field.segments}
            error={messageAt(issues, field.segments)}
          />
        ))}
      </EnterGroup>
      <Hint>A simplified form: this section&apos;s full form arrives in a later build.</Hint>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Custom modules (BUILD_SPEC 4.3)
 * ------------------------------------------------------------------ */

export function CustomModuleForm({
  custom,
  value,
  mappedValues,
  context,
  issues,
  focusPath,
  readOnly,
  onChange,
  onMappedChange,
  onFocusChange,
}: {
  custom: CustomModule;
  /** `data.custom.<key>` without its comment. */
  value: unknown;
  /** Values of fields mapped to modules (Field.mapsTo), as the engine read them. */
  mappedValues: Readonly<Record<string, unknown>>;
  context: InspectionContext;
  issues: readonly ValidationIssue[];
  focusPath: IssuePath | null;
  readOnly: boolean;
  onChange: (next: Record_) => void;
  /** Writes a mapped field's value into its module. */
  onMappedChange: (mapsTo: string, value: unknown) => void;
  onFocusChange: (focus: CaptureFocus) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useIssueFocus(focusPath, { root });
  const record = asRecord(value);
  const update = useDataUpdater(record, onChange);

  let body: ReactNode;
  if (custom.layout === "fields") {
    body = (
      <EnterGroup className="grid gap-5 md:grid-cols-2">
        {custom.fields.map((field) => {
          const form = customFormField(field);
          const mapped = field.mapsTo;
          return (
            <FieldControl
              key={field.key}
              field={form}
              value={mapped ? (mappedValues[field.key] ?? null) : (record[field.key] ?? null)}
              onChange={(next) =>
                mapped ? onMappedChange(mapped, next) : update((current) => ({ ...current, [field.key]: next }))
              }
              readOnly={readOnly}
              issuePath={[field.key]}
              error={messageAt(issues, [field.key])}
            />
          );
        })}
      </EnterGroup>
    );
  } else if (custom.layout === "table") {
    body = (
      <PerSize context={context}>
        {(sizes) => (
          <SizeTable
            custom={custom}
            sizes={sizes}
            context={context}
            record={record}
            issues={issues}
            readOnly={readOnly}
            update={update}
            onFocusChange={onFocusChange}
          />
        )}
      </PerSize>
    );
  } else if (isPerSizeCustom(custom)) {
    const sizes = asRecord(record.sizes);
    body = (
      <PerSize context={context}>
        {(ordered) => (
          <div className="space-y-6">
            {ordered.map((size) => (
              <section key={size} aria-label={`Size ${sizeLabel(context, size)}`} className="space-y-2">
                <h3 className="text-base font-semibold text-foreground">Size {sizeLabel(context, size)}</h3>
                <Grid
                  custom={custom}
                  record={asRecord(sizes[size])}
                  root={["sizes", size]}
                  size={size}
                  issues={issues}
                  readOnly={readOnly}
                  update={sizeScope(update, size)}
                  onFocusChange={onFocusChange}
                />
              </section>
            ))}
          </div>
        )}
      </PerSize>
    );
  } else {
    body = (
      <Grid
        custom={custom}
        record={record}
        root={[]}
        size={undefined}
        issues={issues}
        readOnly={readOnly}
        update={update}
        onFocusChange={onFocusChange}
      />
    );
  }

  return (
    <div ref={root} className="min-w-0 space-y-4">
      {body}
    </div>
  );
}

/** Per-size layouts show only ordered sizes (6.2 rule 4). */
function PerSize({ context, children }: { context: InspectionContext; children: (sizes: readonly string[]) => ReactNode }) {
  if (context.sizes.length === 0) {
    return <Hint>No sizes ordered yet. Add them to the order first.</Hint>;
  }
  return <>{children(context.sizes)}</>;
}

/** A row per ordered size, a column per field. Enter walks down a column of numbers. */
function SizeTable({
  custom,
  sizes,
  context,
  record,
  issues,
  readOnly,
  update,
  onFocusChange,
}: {
  custom: CustomModule;
  sizes: readonly string[];
  context: InspectionContext;
  record: Record_;
  issues: readonly ValidationIssue[];
  readOnly: boolean;
  update: Update;
  onFocusChange: (focus: CaptureFocus) => void;
}) {
  const fields = ownCustomFields(custom).map(customFormField);
  const bySize = asRecord(record.sizes);
  return (
    <EnterGroup className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-max border-collapse text-sm touch:text-base">
        <caption className="sr-only">{custom.title}, one row per size</caption>
        <thead className="bg-slate-50 text-left">
          <tr>
            <th scope="col" className="w-24 px-3 py-2 font-semibold text-foreground">
              Size
            </th>
            {fields.map((field) => (
              <th key={field.key} scope="col" className="px-3 py-2 font-semibold text-foreground">
                {field.label}
                {field.unit && field.type !== "number" ? ` (${field.unit})` : ""}
                {field.required && <span className="font-normal text-muted-foreground"> (required)</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sizes.map((size) => {
            const row = asRecord(bySize[size]);
            const updateRow = sizeScope(update, size);
            return (
              <tr key={size} className="border-t border-border align-top">
                <th scope="row" className="px-3 py-2.5 text-left font-semibold whitespace-nowrap text-foreground">
                  {sizeLabel(context, size)}
                </th>
                {fields.map((field) => (
                  <td key={field.key} className="min-w-44 px-3 py-2">
                    <FieldControl
                      variant="cell"
                      cellLabel={`Size ${sizeLabel(context, size)}, ${field.label}`}
                      field={field}
                      value={row[field.key] ?? null}
                      onChange={(next) => updateRow((current) => ({ ...current, [field.key]: next }))}
                      readOnly={readOnly}
                      issuePath={["sizes", size, field.key]}
                      error={messageAt(issues, ["sizes", size, field.key])}
                      group={field.key}
                      onFocus={() => onFocusChange({ size })}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </EnterGroup>
  );
}

/** A row per field, repeated columns (boxes). Enter walks along a row of numbers. */
function Grid({
  custom,
  record,
  root,
  size,
  issues,
  readOnly,
  update,
  onFocusChange,
}: {
  custom: CustomModule;
  record: Record_;
  root: IssuePath;
  size: string | undefined;
  issues: readonly ValidationIssue[];
  readOnly: boolean;
  update: Update;
  onFocusChange: (focus: CaptureFocus) => void;
}) {
  const fields = ownCustomFields(custom).map(customFormField);
  const columns = custom.grid?.columns;
  const count = gridColumnCount(custom, record);
  const columnLabel = columns?.label ?? "Column";
  const cells = (field: FormField): readonly unknown[] => {
    const stored = record[field.key];
    return Array.isArray(stored) ? stored : [];
  };

  return (
    <div className="space-y-3">
      <EnterGroup className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-max border-collapse text-sm touch:text-base">
          <caption className="sr-only">
            {custom.title}
            {size ? `, size ${size}` : ""}
          </caption>
          <thead className="bg-slate-50 text-left">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold text-foreground">
                <span className="sr-only">Field</span>
              </th>
              {Array.from({ length: count }, (_, column) => (
                <th key={column} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap text-foreground">
                  {columnLabel} {column + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.key} className="border-t border-border align-top">
                <th scope="row" className="px-3 py-2.5 text-left font-semibold text-foreground">
                  {field.label}
                  {field.unit && field.type !== "number" ? ` (${field.unit})` : ""}
                </th>
                {Array.from({ length: count }, (_, column) => {
                  const path = [...root, field.key, column];
                  return (
                    <td key={column} className="min-w-36 px-3 py-2">
                      <FieldControl
                        variant="cell"
                        cellLabel={`${field.label}, ${columnLabel} ${column + 1}${size ? `, size ${size}` : ""}`}
                        field={field}
                        value={cells(field)[column] ?? null}
                        onChange={(next) => update((current) => withGridCell(current, field.key, column, next))}
                        readOnly={readOnly}
                        issuePath={path}
                        error={messageAt(issues, path)}
                        group={field.key}
                        onFocus={() => onFocusChange(size ? { size } : {})}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </EnterGroup>
      {columns?.addable && !readOnly && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => update((current) => withGridColumn(custom, current))}
        >
          <PlusIcon aria-hidden />
          Add {columnLabel.toLowerCase()}
        </Button>
      )}
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground touch:text-base">{children}</p>;
}
