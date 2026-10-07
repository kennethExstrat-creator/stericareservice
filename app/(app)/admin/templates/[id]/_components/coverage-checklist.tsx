"use client";

import { memo, useActionState, useCallback, useId, useState } from "react";
import { CheckIcon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/qc";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { submitAction } from "@/lib/admin/submit";
import type {
  ActionResult,
  CoverageChecklist as Checklist,
  CoverageDocument,
  CoverageRow,
  CoverageSection,
} from "@/lib/admin/templates";
import { cn } from "@/lib/utils";
import { confirmCoverage } from "./actions";

export type CoverageChecklistProps = {
  templateId: string;
  /** `updated_at` as the page read it: the confirmation is for this version as shown. */
  seen: string;
  code: string;
  /** Null until the version resolves. */
  checklist: Checklist | null;
  /** Who confirmed it and when, already in words; null while unconfirmed. */
  confirmed: { by: string; at: string } | null;
  /** Why it cannot be confirmed yet (no source file, a field lost), or null. */
  blocker: string | null;
  /** What to do while the version has not resolved: in the editor, or through a new version. */
  unresolvedAdvice: string;
  sourceFileName: string | null;
};

const IDLE: ActionResult = { status: "idle" };

const UNREACHABLE = "Could not reach the server. Check the connection, then reload the page and try again.";

function sectionName(name: string): string {
  return name.replace(/\s>\s/g, " › ");
}

/** "Report · STD_EG" from "reports/STD_EG.md". */
function documentTab(document: CoverageDocument): string {
  const file = document.file.split("/").pop()?.replace(/\.md$/, "") ?? document.file;
  return `${document.kind === "report" ? "Report" : "Onsite Form"} · ${file}`;
}

function countText(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The field coverage checklist (BUILD_SPEC 4.2 rules 2 and 10, 4.5 step 4):
 * every field of the version's source forms with where this version keeps
 * it, a tick per section, and a last tick for the uploaded file itself. Once
 * every box is ticked, Confirm coverage records who checked it and when;
 * only then can the version be activated.
 */
export function CoverageChecklist({
  templateId,
  seen,
  code,
  checklist,
  confirmed,
  blocker,
  unresolvedAdvice,
  sourceFileName,
}: CoverageChecklistProps) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  const [attested, setAttested] = useState(false);
  const attestId = useId();
  const statusId = useId();
  // Stable, so a tick re-renders only its own section (Section is memoised).
  const toggle = useCallback(
    (key: string, on: boolean) =>
      setTicked((current) => {
        const next = new Set(current);
        if (on) next.add(key);
        else next.delete(key);
        return next;
      }),
    [],
  );

  const [state, formAction, pending] = useActionState(async (previous: ActionResult, formData: FormData) => {
    const result = await confirmCoverage(previous, formData).catch((): ActionResult => ({ status: "error", message: UNREACHABLE }));
    if (result.status === "success") toast.success(result.message);
    return result;
  }, IDLE);

  if (!checklist) {
    return (
      <p className="text-sm text-muted-foreground touch:text-base">
        This version has not resolved, so there is nothing to check yet. {unresolvedAdvice}
      </p>
    );
  }

  const readOnly = confirmed !== null;
  const sections = checklist.sectionKeys.length;
  const checked = checklist.sectionKeys.filter((key) => ticked.has(key)).length;
  const ready = blocker === null && checked === sections && attested;

  return (
    <div className="flex flex-col gap-5">
      <Intro checklist={checklist} code={code} />

      {confirmed ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusPill status="pass" label="Coverage Confirmed" />
          <p className="text-sm text-muted-foreground">
            By {confirmed.by} on {confirmed.at}.
          </p>
        </div>
      ) : null}

      {checklist.documents.length > 0 && (
        <Tabs defaultValue={checklist.documents[0].id} className="gap-4">
          <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
            {checklist.documents.map((document) => {
              const done = document.sections.every((section) => ticked.has(section.key));
              return (
                <TabsTrigger key={document.id} value={document.id} className="flex-none">
                  {!readOnly && done && <CheckIcon aria-hidden className="text-pass" />}
                  {documentTab(document)}
                  <span className="text-muted-foreground tabular-nums">({document.fields})</span>
                  {!readOnly && done && <span className="sr-only">, every section checked</span>}
                </TabsTrigger>
              );
            })}
          </TabsList>
          {checklist.documents.map((document) => (
            <TabsContent key={document.id} value={document.id} className="flex flex-col gap-4">
              <DocumentSummary document={document} mode={checklist.mode} ticked={readOnly ? null : ticked} />
              {document.sections.map((section) => (
                <Section
                  key={section.key}
                  section={section}
                  mode={checklist.mode}
                  ticked={ticked.has(section.key)}
                  onToggle={readOnly ? null : toggle}
                />
              ))}
            </TabsContent>
          ))}
        </Tabs>
      )}

      {!readOnly && (
        // Submitted by hand: React resets a form after its action, and the last tick would clear itself on that
        // reset, so a refused confirmation keeps it (lib/admin/submit.ts).
        <form
          onSubmit={submitAction(formAction, pending)}
          className="flex flex-col gap-4 rounded-lg border border-border bg-slate-50 p-4"
        >
          <input type="hidden" name="templateId" value={templateId} />
          <input type="hidden" name="seen" value={seen} />
          {[...ticked].map((key) => (
            <input key={key} type="hidden" name="section" value={key} />
          ))}
          <div className="flex items-start gap-3">
            <Checkbox
              id={attestId}
              name="attested"
              value="yes"
              checked={attested}
              onCheckedChange={(value) => setAttested(value === true)}
              className="mt-0.5 touch:mt-0"
            />
            <label htmlFor={attestId} className="text-sm leading-snug text-foreground touch:text-base">
              {sourceFileName ? (
                <>
                  I have checked <span className="font-medium break-all">{sourceFileName}</span> field by field: every
                  field on it is kept by this version, in a module field or a custom field.
                </>
              ) : (
                <>I have checked the source file field by field: every field on it is kept by this version.</>
              )}
            </label>
          </div>

          {blocker && (
            <Alert className="border-warn-border bg-warn-tint text-warn">
              <TriangleAlertIcon aria-hidden />
              <AlertDescription className="text-warn">{blocker}</AlertDescription>
            </Alert>
          )}
          {/* role="alert": read out as soon as it appears. */}
          {state.status === "error" && (
            <Alert variant="destructive">
              <OctagonXIcon aria-hidden />
              <AlertDescription className="text-destructive">{state.message}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button type="submit" disabled={!ready || pending}>
              {pending && <Spinner aria-hidden />}
              {pending ? "Confirming…" : "Confirm Coverage"}
            </Button>
            <p id={statusId} aria-live="polite" className="text-sm text-muted-foreground tabular-nums">
              {sections > 0 ? `${checked} of ${countText(sections, "section", "sections")} checked. ` : ""}
              {ready ? "Ready to confirm." : attested ? "" : "Tick the last box once you have checked the file."}
            </p>
          </div>
        </form>
      )}
    </div>
  );
}

function Intro({ checklist, code }: { checklist: Checklist; code: string }) {
  switch (checklist.mode) {
    case "own":
      return (
        <p className="max-w-3xl text-sm text-muted-foreground touch:text-base">
          Every field of the forms {code} is built from, and where this version keeps it. Nothing may be lost (BUILD_SPEC
          4.2): a field this version leaves out stops the confirmation. Tick each section once you have checked it against
          the source file.
        </p>
      );
    case "base":
      return (
        <p className="max-w-3xl text-sm text-muted-foreground touch:text-base">
          {code}&rsquo;s own form is not in the field inventory, so this list holds the fields of the forms its base{" "}
          {checklist.inventoryCode} is built from, as this version keeps them. A field marked Left Out is one this version
          drops: tick its section once you are sure that is meant. Then check the uploaded file itself against the modules
          above.
        </p>
      );
    case "none":
      return (
        <p className="max-w-3xl text-sm text-muted-foreground touch:text-base">
          {code}&rsquo;s form is not in the field inventory, so there is no field list to tick. Check the uploaded file field
          by field against the modules and custom modules above: each field must be kept by one of them.
        </p>
      );
  }
}

function DocumentSummary({
  document,
  mode,
  ticked,
}: {
  document: CoverageDocument;
  mode: Checklist["mode"];
  ticked: ReadonlySet<string> | null;
}) {
  const checked = ticked ? document.sections.filter((section) => ticked.has(section.key)).length : null;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <p className="text-sm text-foreground">
        <span className="font-medium">{document.title}</span>{" "}
        <span className="text-muted-foreground">docs/forms/{document.file}</span>
      </p>
      <p className="text-sm text-muted-foreground tabular-nums">
        {countText(document.fields, "field", "fields")}
        {document.missing > 0
          ? ` · ${document.missing} ${mode === "own" ? "missing" : "left out"}`
          : " · all kept"}
        {checked !== null && ` · ${checked} of ${countText(document.sections.length, "section", "sections")} checked`}
      </p>
    </div>
  );
}

/** One section of a source form with its tick. Memoised: ticking one section leaves the others alone. */
const Section = memo(function Section({
  section,
  mode,
  ticked,
  onToggle,
}: {
  section: CoverageSection;
  mode: Checklist["mode"];
  ticked: boolean;
  /** Null once coverage is confirmed: nothing to tick. */
  onToggle: ((key: string, on: boolean) => void) | null;
}) {
  const id = useId();
  const name = sectionName(section.name);
  const summary =
    section.missing > 0
      ? `${countText(section.rows.length, "field", "fields")}, ${section.missing} ${mode === "own" ? "missing" : "left out"}`
      : `${countText(section.rows.length, "field", "fields")}, all kept`;

  return (
    <section
      aria-labelledby={`${id}-name`}
      data-section={section.key}
      className={cn(
        "overflow-hidden rounded-lg border bg-card",
        section.missing > 0 ? (mode === "own" ? "border-fail-border" : "border-warn-border") : "border-border",
      )}
    >
      <div className="flex items-center gap-3 border-b border-border bg-slate-50 px-3 py-2 touch:py-2.5">
        {onToggle && (
          <Checkbox
            id={`${id}-tick`}
            checked={ticked}
            onCheckedChange={(value) => onToggle(section.key, value === true)}
            aria-describedby={`${id}-summary`}
          />
        )}
        <h3 id={`${id}-name`} className="min-w-0 flex-1 text-sm font-semibold text-foreground touch:text-base">
          {onToggle ? (
            <label htmlFor={`${id}-tick`} className="cursor-pointer">
              {name}
            </label>
          ) : (
            name
          )}
        </h3>
        <p id={`${id}-summary`} className="shrink-0 text-sm text-muted-foreground tabular-nums">
          {summary}
        </p>
      </div>
      <table className="w-full table-fixed text-sm touch:text-base">
        <caption className="sr-only">
          {name}: where each field goes
        </caption>
        <colgroup>
          <col className="w-[38%]" />
          <col />
          <col className="w-28 touch:w-34" />
        </colgroup>
        <thead className="sr-only">
          <tr>
            <th scope="col">On the Source</th>
            <th scope="col">In This Version</th>
            <th scope="col">State</th>
          </tr>
        </thead>
        <tbody>
          {section.rows.map((row) => (
            <Row key={row.id} row={row} mode={mode} />
          ))}
        </tbody>
      </table>
    </section>
  );
});

function Row({ row, mode }: { row: CoverageRow; mode: Checklist["mode"] }) {
  const missingStatus = mode === "own" ? "fail" : "warn";
  return (
    <tr data-covered={row.covered} className="border-b border-border align-top last:border-b-0">
      <th scope="row" className="px-3 py-2 text-left font-normal">
        <span className="block font-medium break-words text-foreground">{row.label}</span>
        {row.corrected && <span className="block text-muted-foreground">Shown as “{row.corrected}”</span>}
        <span className="block text-sm text-muted-foreground">{row.input}</span>
      </th>
      <td className="px-3 py-2">
        <ul className="flex flex-col gap-1">
          {row.targets.map((target, index) => (
            <li key={index} className="break-words">
              {target.place && <span className="text-muted-foreground">{target.place} › </span>}
              <span className="text-foreground">{target.text}</span>
              {target.reason && (
                <span className={cn("block text-sm", mode === "own" ? "text-fail" : "text-warn")}>{target.reason}</span>
              )}
            </li>
          ))}
        </ul>
        {row.notes && <p className="mt-1 text-sm text-muted-foreground">{row.notes}</p>}
      </td>
      <td className="px-3 py-2 text-right">
        <StatusPill
          size="sm"
          status={row.covered ? "pass" : missingStatus}
          label={row.covered ? "Kept" : mode === "own" ? "Missing" : "Left Out"}
          className="touch:h-7 touch:gap-1.5 touch:px-2.5 touch:text-sm touch:[&>svg]:size-4"
        />
      </td>
    </tr>
  );
}
