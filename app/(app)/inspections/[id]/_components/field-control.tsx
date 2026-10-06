"use client";

// One field of a plain form (fields.ts): the control its type calls for,
// from the design system and the capture kit (docs/CAPTURE_KIT.md). Numbers
// are the kit's NumberField, so text such as "2 42" is rejected and never
// stored (BUILD_SPEC 6.2 rule 1), Enter moves on and a pasted column fills
// down inside an EnterGroup; counts are a Stepper, never typed (8); dates
// use the date picker (rule 3). Values are stored as
// lib/validation/custom.ts reads them: text, numbers, booleans and
// `YYYY-MM-DD`, or null when blank. Every control is marked for issue links
// with the kit's issuePathProps.
import { useId, type ReactNode } from "react";
import { issuePathProps, NumberField, Stepper } from "@/components/qc";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { dateValue, textValue, type FormField } from "@/lib/inspections/capture/fields";
import type { IssuePath } from "@/lib/validation";
import { cn } from "@/lib/utils";

type FieldControlProps = {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly: boolean;
  /** Where issues about this value point: the link target. */
  issuePath: IssuePath;
  /** A problem the checks found with the stored value. */
  error?: string | null;
  /** In a table cell the column heading names the field; the label stays for screen readers. */
  variant?: "field" | "cell";
  /** Read by screen readers in a cell: "Size M, Conclusion". */
  cellLabel?: string;
  /**
   * Number cells with the same group form one column inside the nearest
   * EnterGroup: Enter walks down it and a pasted column fills it.
   */
  group?: string;
  onFocus?: () => void;
};

const SELECTED = "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-brand-600";

export function FieldControl({
  field,
  value,
  onChange,
  readOnly,
  issuePath,
  error,
  variant = "field",
  cellLabel,
  group,
  onFocus,
}: FieldControlProps) {
  const id = useId();
  const inputId = `${id}-input`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const cell = variant === "cell";
  const label = cell ? (cellLabel ?? field.label) : field.label;
  const describedBy = [!cell && field.hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  if (field.type === "number") {
    // The kit's field draws its own label, hint, error and issue mark. In a
    // table cell too it is the bordered field, its label kept for screen
    // readers: the kit's borderless cell needs a grid that frames each cell
    // (MeasurementGrid), and these tables frame rows only, beside the
    // bordered text inputs of the same row.
    return (
      <NumberField
        id={inputId}
        variant="field"
        hideLabel={cell}
        label={cell ? label : <LabelText label={field.label} required={field.required} />}
        value={typeof value === "number" ? value : null}
        onValueChange={(next) => onChange(next)}
        unit={field.unit}
        min={field.min}
        max={field.max}
        hint={cell ? undefined : field.hint}
        error={error}
        group={group}
        readOnly={readOnly}
        issuePath={issuePath}
        onFocus={onFocus}
      />
    );
  }

  const control = (() => {
    switch (field.type) {
      case "counter": {
        const count = typeof value === "number" ? value : null;
        return (
          <div className="flex flex-wrap items-center gap-3">
            <Stepper
              id={inputId}
              label={label}
              value={count ?? 0}
              onValueChange={(next) => onChange(next)}
              min={field.min ?? 0}
              max={field.max}
              disabled={readOnly}
            />
            {count === null && <span className="text-sm text-muted-foreground touch:text-base">Not counted yet</span>}
          </div>
        );
      }
      case "textarea":
        return (
          <Textarea
            id={inputId}
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(textValue(event.target.value))}
            readOnly={readOnly}
            rows={3}
            maxLength={2000}
            aria-label={cell ? label : undefined}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            onFocus={onFocus}
          />
        );
      case "date":
        return (
          <Input
            id={inputId}
            type="date"
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(dateValue(event.target.value))}
            readOnly={readOnly}
            aria-label={cell ? label : undefined}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            onFocus={onFocus}
            className="w-auto min-w-44"
          />
        );
      case "yes_no":
        return (
          <ToggleGroup
            type="single"
            variant="outline"
            spacing={0}
            value={value === true ? "yes" : value === false ? "no" : ""}
            onValueChange={(next) => onChange(next === "yes" ? true : next === "no" ? false : null)}
            disabled={readOnly}
            aria-label={label}
            aria-describedby={describedBy}
            onFocus={onFocus}
          >
            <ToggleGroupItem value="yes" className={cn("min-w-16 px-4", SELECTED)}>
              Yes
            </ToggleGroupItem>
            <ToggleGroupItem value="no" className={cn("min-w-16 px-4", SELECTED)}>
              No
            </ToggleGroupItem>
          </ToggleGroup>
        );
      case "select": {
        const options = field.options ?? [];
        const selected = typeof value === "string" ? value : "";
        if (options.length <= 4) {
          return (
            <ToggleGroup
              type="single"
              variant="outline"
              spacing={0}
              value={selected}
              onValueChange={(next) => onChange(next === "" ? null : next)}
              disabled={readOnly}
              aria-label={label}
              aria-describedby={describedBy}
              onFocus={onFocus}
              className="flex-wrap"
            >
              {options.map((option) => (
                <ToggleGroupItem key={option} value={option} className={cn("px-4", SELECTED)}>
                  {option}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          );
        }
        return (
          <Select
            value={selected}
            onValueChange={(next) => onChange(next === "" ? null : next)}
            disabled={readOnly}
          >
            <SelectTrigger
              id={inputId}
              className="w-full min-w-48 sm:w-auto"
              aria-label={cell ? label : undefined}
              aria-describedby={describedBy}
              onFocus={onFocus}
            >
              <SelectValue placeholder="Choose…" />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }
      case "photo":
        return <p className="text-sm text-muted-foreground touch:text-base">Photos for this field arrive in the next build.</p>;
      case "text":
      default:
        return (
          <Input
            id={inputId}
            type="text"
            value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(textValue(event.target.value))}
            readOnly={readOnly}
            maxLength={2000}
            autoComplete="off"
            aria-label={cell ? label : undefined}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            onFocus={onFocus}
          />
        );
    }
  })();

  const errorLine = error ? (
    <p id={errorId} className="text-sm text-fail touch:text-base">
      {error}
    </p>
  ) : null;

  if (cell) {
    return (
      <div data-field={field.key} className="min-w-0 space-y-1" {...issuePathProps(issuePath)}>
        {control}
        {errorLine}
      </div>
    );
  }

  // Grouped controls (a stepper, a choice) are named by their own label; the rest by <label for>.
  const grouped = field.type === "counter" || field.type === "yes_no" || (field.type === "select" && (field.options?.length ?? 0) <= 4);
  return (
    <div data-field={field.key} className="min-w-0 space-y-1.5" {...issuePathProps(issuePath)}>
      <FieldLabel htmlFor={grouped || field.type === "photo" ? undefined : inputId}>
        <LabelText label={field.label} unit={field.unit} required={field.required} />
      </FieldLabel>
      {control}
      {field.hint && (
        <p id={hintId} className="text-sm text-muted-foreground touch:text-base">
          {field.hint}
        </p>
      )}
      {errorLine}
    </div>
  );
}

/** "Container seal intact (required)", "Length (mm)". */
function LabelText({ label, unit, required }: { label: string; unit?: string; required?: boolean }) {
  return (
    <>
      {label}
      {unit ? ` (${unit})` : ""}
      {required && <span className="font-normal text-muted-foreground"> (required)</span>}
    </>
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  if (htmlFor) {
    return (
      <Label htmlFor={htmlFor} className="leading-snug touch:text-base">
        {children}
      </Label>
    );
  }
  return <p className="text-sm leading-snug font-medium text-foreground touch:text-base">{children}</p>;
}
