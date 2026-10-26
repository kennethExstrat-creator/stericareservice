"use client";

// The Dimension body: one MeasurementGrid per ordered size, in size tabs.
// Gloves are rows (the sampling plan's n, else the template's), the measures
// on are columns in the template's wording; the footer shows calc's median
// or average, the spec and the verdict at the printed precision, as you
// type. Enter walks down a column and a pasted column fills down (the grid's
// own rules); every write goes through useDataUpdater, so a paste or two
// commits in one event all land. Issue links switch to the size and focus
// the cell; readings past the planned gloves, which have no row, can be
// removed from their warning. Read-only, the readings stay focusable. Photos
// are tagged with the size in view.
//
// In each size's grid (Kenneth, 26 October 2026: "put the edit icon into the
// table, not outside"), the pencil in a measure's Spec cell opens Change the
// Spec: its spec for this inspection, as the form's Spec row gives it (NA
// included), in place of the template's; the pencil in its P/F cell opens
// Change the P/F: its P/F set by hand, with a comment. The save records both
// in the audit log; the grid then judges by them and marks each in its cell
// with an amber dot, the template's spec or the comment as its title, and
// calc's warning about a P/F the readings do not give lands on its pencil.
import { useId, useRef, useState, type RefObject } from "react";
import {
  focusIssuePath,
  issueNoticeProps,
  MeasurementGrid,
  ModuleSection,
  SizeTabs,
  StatusIcon,
  useDataUpdater,
  useIssueFocus,
  type DataChange,
  type Measure as GridMeasure,
} from "@/components/qc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { formatSpec, type Spec } from "@/lib/stats";
import { cn } from "@/lib/utils";
import { initialSize, labelFor, sizeLabel, type CaptureProps, type Labels, type ValidationIssue } from "@/modules/_framework";
import { sizeOnTabs, useReportShownSize } from "@/modules/_framework/shown-size";
import { effectiveSpecFor, rowsFor, specFor, type DimensionsComputed, type MeasureOutcome } from "./calc";
import {
  cellPath,
  gridColumns,
  measureSummary,
  readingChanges,
  sizeHeading,
  withoutGlovesPast,
  withReadings,
} from "./capture-data";
import type { DimensionsConfig, Measure } from "./config";
import { fieldsOf, figuresOf, SPEC_KINDS, specFromFigures, type SpecFigures } from "./spec-entry";
import {
  MANUAL_COMMENT_MAX,
  sameSpec,
  specOverrideOf,
  withManualResult,
  withSpecOverride,
  type DimensionsData,
  type ManualResult,
} from "./schema";

type Props = CaptureProps<DimensionsData, DimensionsConfig, DimensionsComputed>;

export default function Capture(props: Props) {
  const { data, context, evaluation, focusPath, focus, onChange, onFocusChange } = props;
  const update = useDataUpdater(data, onChange);
  const root = useRef<HTMLDivElement>(null);
  // Opens on the size chosen in the last module (CaptureProps.focus). SizeTabs shows the first
  // ordered size while this is not one (6.2 rule 4) and says so through show.
  const [size, setSize] = useState(() => initialSize(context, focus));
  // The size on the tabs tags the photos taken now (BUILD_SPEC 8.1), from the moment the section opens.
  useReportShownSize(sizeOnTabs(context.sizes, size), onFocusChange);

  const show = (next: string) => {
    setSize(next);
    onFocusChange?.({ size: next });
  };

  useIssueFocus(focusPath, {
    root,
    reveal: (path) => {
      // size_not_ordered points at a size that is not on screen: stay put.
      if (path[0] === "sizes" && typeof path[1] === "string" && context.sizes.includes(path[1])) setSize(path[1]);
    },
  });

  return (
    <div ref={root} data-slot="dimensions-capture" className="min-w-0">
      <SizeTabs
        sizes={context.sizes}
        templateSizes={context.templateSizes}
        value={size}
        onValueChange={show}
        results={evaluation?.result.perSize}
      >
        {(current) => <SizeGrid {...props} size={current} root={root} update={update} />}
      </SizeTabs>
    </div>
  );
}

function SizeGrid({
  size,
  root,
  update,
  data,
  config,
  labels,
  context,
  evaluation,
  readOnly,
  onFocusChange,
}: Props & {
  size: string;
  root: RefObject<HTMLDivElement | null>;
  update: (change: DataChange<DimensionsData>) => void;
}) {
  const { rows } = rowsFor(context, size, config);
  const sizeName = sizeLabel(context, size);
  const heading = sizeHeading(labelFor(labels, "sizeHeading"), sizeName);
  const status = evaluation?.result.perSize?.[size]?.status;
  // A module whose config or data is broken comes back with no computed values.
  const computed: Partial<DimensionsComputed> | undefined = evaluation?.computed;
  const calculated = computed?.calculated?.[size] ?? {};
  const manual = computed?.manual?.[size] ?? {};
  // Issues about a reading of this size; the screen's issue list carries the rest.
  const issues = (evaluation?.issues ?? []).filter(
    (issue) => issue.size === size && issue.path[0] === "sizes" && issue.path[1] === size && issue.path.length > 2,
  );
  // The dialog a pencil in the grid's Spec or P/F cell opened.
  const [editing, setEditing] = useState<{ cell: "spec" | "result"; measure: Measure } | null>(null);
  const edit = (cell: "spec" | "result", key: string) => {
    const measure = config.measures.find((candidate) => candidate === key);
    if (measure) setEditing({ cell, measure });
  };
  const template = (measure: Measure) => specFor(config, size, measure) ?? null;

  const measures: GridMeasure[] = config.measures.map((measure) => {
    const byHand = manual[measure];
    return {
      key: measure,
      label: labelFor(labels, measure),
      unit: "mm",
      decimals: config.decimals[measure],
      // The spec set for this inspection, else the template's: what calc judges by.
      spec: effectiveSpecFor(config, data, size, measure),
      // calc refuses a reading of 0 mm or less: so does the cell.
      min: 0,
      minExclusive: true,
      summary: measureSummary(computed, size, measure),
      specNote: specOverrideOf(data, size, measure)
        ? `Set for this inspection; template: ${specWords(template(measure))}`
        : undefined,
      resultNote: byHand
        ? `Set by the inspector; the readings give ${verdictWord(calculated[measure], labels)}. Comment: ${byHand.comment}`
        : undefined,
    };
  });

  return (
    <ModuleSection
      title={heading}
      description={`${labelFor(labels, "statistic")} of ${rows} ${rows === 1 ? "glove" : "gloves"}`}
      status={status}
      statusLabel={status === "pass" || status === "fail" ? labelFor(labels, status) : undefined}
      issuePath={["sizes", size]}
    >
      <div
        // Tag photos with the size when focus enters the grid, not on every move between its cells.
        onFocus={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) onFocusChange?.({ size });
        }}
      >
        <MeasurementGrid
          caption={heading}
          measures={measures}
          rows={rows}
          values={gridColumns(data, size, config.measures, rows)}
          onCellsChange={(changes) =>
            update((current) => withReadings(current, size, readingChanges(changes, config.measures)))
          }
          statistic={config.statistic}
          labels={gridLabels(labels)}
          readOnly={readOnly}
          cellIssuePath={(cell) => cellPath(size, cell)}
          onEditSpec={(key) => edit("spec", key)}
          onEditResult={(key) => edit("result", key)}
          // calc's warning about a P/F set by hand points here.
          resultIssuePath={(measure) => ["sizes", size, "manualResults", measure]}
        />
      </div>
      {editing?.cell === "spec" && (
        <ChangeSpecDialog
          key={editing.measure}
          measureName={labelFor(labels, editing.measure)}
          sizeName={sizeName}
          template={template(editing.measure)}
          current={specOverrideOf(data, size, editing.measure)}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            const { measure } = editing;
            // The template's own spec changes nothing for this inspection.
            const spec = next && sameSpec(next, template(measure)) ? null : next;
            update((current) => withSpecOverride(current, size, measure, spec));
            setEditing(null);
          }}
        />
      )}
      {editing?.cell === "result" && (
        <ChangeResultDialog
          key={editing.measure}
          measureName={labelFor(labels, editing.measure)}
          sizeName={sizeName}
          labels={labels}
          calculated={calculated[editing.measure]}
          current={manual[editing.measure] ?? null}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            const { measure } = editing;
            update((current) => withManualResult(current, size, measure, next));
            setEditing(null);
          }}
        />
      )}
      <IssueLinks
        issues={issues}
        root={root}
        onRemoveUncounted={readOnly ? undefined : () => update((current) => withoutGlovesPast(current, size, rows))}
      />
    </ModuleSection>
  );
}

/** "Passed", "Failed" in the template's words (SAFEDON_EG: "A", "Rej."); "not done" while readings are missing. */
function verdictWord(outcome: MeasureOutcome | undefined, labels: Labels): string {
  if (outcome === "pass" || outcome === "fail") return labelFor(labels, outcome);
  return outcome === "na" ? "NA" : "not done";
}

/** "≥ 240", "NA"; "no spec" where there is none. */
function specWords(spec: Spec | null | undefined): string {
  return spec ? formatSpec(spec) : "no spec";
}

/**
 * A spec for this inspection in any kind the template takes, NA included;
 * Use Template Spec gives the measure back to the template's.
 */
function ChangeSpecDialog({
  measureName,
  sizeName,
  template,
  current,
  onClose,
  onSave,
}: {
  measureName: string;
  sizeName: string;
  template: Spec | null;
  current: Spec | null;
  onClose: () => void;
  onSave: (spec: Spec | null) => void;
}) {
  const ids = useId();
  const start = current ?? template;
  const [kind, setKind] = useState<Spec["kind"]>(start?.kind ?? "min");
  const [figures, setFigures] = useState<SpecFigures>(() => figuresOf(start));
  const [error, setError] = useState<string | null>(null);
  const fields = fieldsOf(kind);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="grid gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const made = specFromFigures(kind, figures);
            if ("error" in made) setError(made.error);
            else onSave(made.spec);
          }}
        >
          <DialogHeader>
            <DialogTitle>Change the Spec</DialogTitle>
            <DialogDescription>
              {measureName}, Size {sizeName}. Template: {specWords(template)}. The spec is changed for this inspection
              only, and the change is recorded in the Audit Log.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup
            value={kind}
            onValueChange={(value) => {
              const next = SPEC_KINDS.find((entry) => entry.kind === value);
              if (next) setKind(next.kind);
              setError(null);
            }}
            aria-label="Kind of spec"
            className="grid gap-2 sm:grid-cols-2"
          >
            {SPEC_KINDS.map((entry) => (
              <Label
                key={entry.kind}
                htmlFor={`${ids}-${entry.kind}`}
                className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-accent"
              >
                <RadioGroupItem id={`${ids}-${entry.kind}`} value={entry.kind} />
                {entry.label}
              </Label>
            ))}
          </RadioGroup>
          {fields.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((name, index) => {
                const key = index === 0 ? "first" : "second";
                return (
                  <div key={name} className="grid gap-1.5">
                    <Label htmlFor={`${ids}-${key}`}>{name} (mm)</Label>
                    <Input
                      id={`${ids}-${key}`}
                      inputMode="decimal"
                      autoComplete="off"
                      value={figures[key]}
                      aria-invalid={error !== null || undefined}
                      aria-describedby={error ? `${ids}-error` : undefined}
                      onChange={(event) => {
                        const value = event.target.value;
                        setFigures((before) => ({ ...before, [key]: value }));
                        setError(null);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground touch:text-base">
              No spec to judge by: the column is Passed once its readings are complete.
            </p>
          )}
          {error && (
            <p id={`${ids}-error`} role="alert" className="text-sm text-fail touch:text-base">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2 sm:justify-between">
            {current ? (
              <Button type="button" variant="ghost" onClick={() => onSave(null)}>
                Use Template Spec
              </Button>
            ) : (
              <span aria-hidden />
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit">Save</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Passed or Failed, and why: the comment is required, and the save records both in the audit log. */
function ChangeResultDialog({
  measureName,
  sizeName,
  labels,
  calculated,
  current,
  onClose,
  onSave,
}: {
  measureName: string;
  sizeName: string;
  labels: Labels;
  calculated: MeasureOutcome | undefined;
  current: ManualResult | null;
  onClose: () => void;
  onSave: (manual: ManualResult | null) => void;
}) {
  const ids = useId();
  const [result, setResult] = useState<ManualResult["result"]>(current?.result ?? (calculated === "pass" ? "fail" : "pass"));
  const [comment, setComment] = useState(current?.comment ?? "");
  const ready = comment.trim() !== "";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) onSave({ result, comment: comment.trim() });
          }}
        >
          <DialogHeader>
            <DialogTitle>Change the P/F</DialogTitle>
            <DialogDescription>
              {measureName}, Size {sizeName}. The readings give {verdictWord(calculated, labels)}. Your choice and comment are
              recorded in the Audit Log.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup
            value={result}
            onValueChange={(value) => setResult(value === "fail" ? "fail" : "pass")}
            aria-label="P/F"
            className="grid gap-2 sm:grid-cols-2"
          >
            {(["pass", "fail"] as const).map((choice) => (
              <Label
                key={choice}
                htmlFor={`${ids}-${choice}`}
                className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-accent"
              >
                <RadioGroupItem id={`${ids}-${choice}`} value={choice} />
                {labelFor(labels, choice)}
              </Label>
            ))}
          </RadioGroup>
          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-comment`}>Comment</Label>
            <Textarea
              id={`${ids}-comment`}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={MANUAL_COMMENT_MAX}
              required
              rows={3}
              placeholder="Why the result is changed"
            />
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {current ? (
              <Button type="button" variant="ghost" onClick={() => onSave(null)}>
                Use the Readings&apos; Result
              </Button>
            ) : (
              <span aria-hidden />
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={!ready}>
                Change Result
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function gridLabels(labels: Labels) {
  return {
    row: labelFor(labels, "rowNo"),
    statistic: labelFor(labels, "statistic"),
    spec: labelFor(labels, "specRow"),
    result: labelFor(labels, "measureResult"),
    pass: labelFor(labels, "pass"),
    fail: labelFor(labels, "fail"),
  };
}

/**
 * calc's issues for the size in view: a reading's problem is a link back to
 * its cell; readings past the planned gloves have no cell, so their warning
 * is where an issue link lands, with the way to remove them.
 */
function IssueLinks({
  issues,
  root,
  onRemoveUncounted,
}: {
  issues: readonly ValidationIssue[];
  root: RefObject<HTMLElement | null>;
  /**
   * Removes the gloves past the grid's rows. The grid has no row for them
   * (the sampling plan's n went down), so this is the only way to clear
   * calc's warning that they are not counted.
   */
  onRemoveUncounted?: () => void;
}) {
  const idBase = useId();
  if (issues.length === 0) return null;
  const tone = (issue: ValidationIssue) =>
    issue.level === "error" ? "border-fail-border bg-fail-tint text-fail" : "border-warn-border bg-warn-tint text-warn";
  const icon = (issue: ValidationIssue) => (
    <StatusIcon status={issue.level === "error" ? "fail" : "warn"} className="mt-0.5 size-4 shrink-0" />
  );
  return (
    <ul className="space-y-1.5" aria-label="Problems in this size">
      {issues.map((issue, index) =>
        issue.code === "dimension_beyond_sample" ? (
          <li key={`${issue.code}-${index}`} className={cn("relative space-y-2 rounded-md border px-3 py-2", tone(issue))}>
            <p
              {...issueNoticeProps(issue.path)}
              className="flex items-start gap-2 rounded-sm text-sm outline-none focus-ring touch:text-base"
            >
              {icon(issue)}
              <span id={`${idBase}-${index}`}>{issue.message}</span>
            </p>
            {onRemoveUncounted && (
              // Described by the warning, which names the size and the gloves.
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-foreground touch:text-base"
                aria-describedby={`${idBase}-${index}`}
                onClick={onRemoveUncounted}
              >
                Remove the Readings That Are Not Counted
              </Button>
            )}
          </li>
        ) : (
          <li key={`${issue.code}-${index}`}>
            <button
              type="button"
              onClick={() => root.current && focusIssuePath(root.current, issue.path)}
              className={cn(
                "flex min-h-9 w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-sm outline-none focus-ring-inset touch:min-h-11 touch:text-base",
                tone(issue),
              )}
            >
              {icon(issue)}
              <span id={`${idBase}-${index}`}>{issue.message}</span>
            </button>
          </li>
        ),
      )}
    </ul>
  );
}
