"use client";

// The template editor (BUILD_SPEC 4.5, 10): the modules with their switches,
// order, wording and settings; custom modules; the template's details; the
// JSON; a live capture preview. The draft lives here until Save, which
// writes the definition and its resolution (actions.ts). A version that is
// in use, active or retired opens read only, with "New version".
import Link from "next/link";
import { useActionState, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftIcon, LoaderCircleIcon, OctagonXIcon, SaveIcon, Undo2Icon } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/qc";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import { normaliseSize } from "@/lib/sizes";
import { lookupFrom, type TemplateBase } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { deepEqual, type FormPath } from "@/lib/zod-form";
import { fieldId } from "@/lib/zod-form/schema-form";
import { MODULE_REGISTRY } from "@/modules";
import { saveTemplate } from "../actions";
import { inheritanceOf } from "../_lib/inheritance";
import type { DefectCodeOption, EditorTemplate } from "../_lib/load";
import {
  addModule,
  moduleOrder,
  moduleView,
  moveModule,
  ownCustomModules,
  setInclude,
  unusedModules,
  type Draft,
  type EditorContext,
} from "../_lib/model";
import { collectProblems, isEditableShape, placeId, problemsOfModule, type DraftError, type ProblemPlace } from "../_lib/problems";
import { lockedReason, SAVE_IDLE, type SaveResult } from "../_lib/results";
import { CapturePreview } from "./capture-preview";
import { configFieldPrefix } from "./config-form";
import { customFieldId } from "./custom-module-form";
import { CustomModules } from "./custom-modules";
import { DetailsForm, isDetailPath } from "./details-form";
import type { EditorApi } from "./editor-api";
import { JsonView } from "./json-view";
import { labelFieldId } from "./label-overrides";
import { LockedNotice } from "./locked-notice";
import { includeFieldId, ModuleDetails, titleFieldId } from "./module-details";
import { ModuleList } from "./module-list";
import { ProblemsSummary } from "./problems-summary";
import { SIDE_BY_SIDE, useMediaQuery } from "./use-media-query";

type Tab = "modules" | "custom" | "details" | "json" | "preview";

export const TEMPLATES_PATH = "/admin/templates";

const STATUS_WORD = { draft: "Draft", active: "Active", retired: "Retired" } as const;

const STUBS: ReadonlySet<ModuleKey> = new Set(
  (Object.keys(MODULE_REGISTRY) as ModuleKey[]).filter((key) => MODULE_REGISTRY[key].stub),
);

export function TemplateEditor({
  template,
  bases,
  defectCodes,
  viewer,
}: {
  template: EditorTemplate;
  bases: TemplateBase[];
  defectCodes: DefectCodeOption[];
  viewer: { id: string; name: string };
}) {
  const lookup = useMemo(() => lookupFrom(bases), [bases]);
  const [draft, setDraft] = useState<Draft>(() => template.definition as Draft);
  const [saved, setSaved] = useState(() => ({ definition: template.definition as Draft, updatedAt: template.updatedAt }));
  const [tab, setTab] = useState<Tab>("modules");
  const [selected, setSelected] = useState<ModuleKey>("header");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [openCustom, setOpenCustom] = useState<number | null>(null);
  const [jsonText, setJsonText] = useState<string | null>(null);
  const [draftErrors, setDraftErrors] = useState<ReadonlyMap<string, DraftError>>(() => new Map());
  const [lockedByServer, setLockedByServer] = useState<string | null>(null);
  const sideBySide = useMediaQuery(SIDE_BY_SIDE);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const extendsCode = typeof draft.extends === "string" ? draft.extends : undefined;
  const inheritance = useMemo(
    () => inheritanceOf({ code: draft.code, extends: extendsCode }, lookup),
    [draft.code, extendsCode, lookup],
  );
  const context = useMemo<EditorContext>(() => ({ inheritance, registry: MODULE_REGISTRY }), [inheritance]);
  const shapeOk = isEditableShape(draft);
  const report = useMemo(
    () => collectProblems(draft, context, { code: template.code, getBase: lookup, draftErrors: [...draftErrors.values()] }),
    [draft, context, template.code, lookup, draftErrors],
  );
  const jsonPending = jsonText !== null && jsonText !== JSON.stringify(draft, null, 2);
  const problems = useMemo(
    () =>
      jsonPending
        ? [
            ...report.problems,
            {
              id: "json-pending",
              place: { area: "template", path: ["json"] } satisfies ProblemPlace,
              message: "The JSON tab has changes that are not applied yet: apply them or undo them.",
            },
          ]
        : report.problems,
    [report.problems, jsonPending],
  );

  // The preview keeps the last version that resolved while the draft has problems.
  const [lastResolved, setLastResolved] = useState<ResolvedTemplate | null>(report.resolved);
  if (report.resolved && report.resolved !== lastResolved) setLastResolved(report.resolved);

  const reason = lockedByServer ?? lockedReason({ version: template.version, status: template.status, inUse: template.inUse });
  const editable = reason === null;
  const dirty = !deepEqual(draft, saved.definition);

  const update: EditorApi["update"] = (change) =>
    setDraft((current) => change(current, { inheritance: inheritanceOf(current, lookup), registry: MODULE_REGISTRY }));

  const reportDraftError = (place: ProblemPlace, message: string | null) =>
    setDraftErrors((current) => {
      const id = placeId(place);
      if (message === null ? !current.has(id) : current.get(id)?.message === message) return current;
      const next = new Map(current);
      if (message === null) next.delete(id);
      else next.set(id, { place, message });
      return next;
    });

  const sizes = useMemo(
    () =>
      (Array.isArray(draft.sizes) ? draft.sizes : []).flatMap((size) => {
        const value = typeof size?.value === "string" ? normaliseSize(size.value) : null;
        return value ? [{ value, label: size.label ? `${size.label} (${value})` : value }] : [];
      }),
    [draft.sizes],
  );

  const api: EditorApi = {
    draft,
    context,
    problems,
    editable,
    update,
    reportDraftError,
    sizes,
    defectCodes,
    resetLabel: inheritance.bases[0] ? `Use ${inheritance.bases[0].code}'s` : "Use default",
  };

  const [saveState, saveAction, saving] = useActionState(async (previous: SaveResult, formData: FormData) => {
    const sent = formData.get("definition");
    const result = await saveTemplate(previous, formData);
    if (result.status === "saved" && typeof sent === "string") {
      setSaved({ definition: JSON.parse(sent) as Draft, updatedAt: result.updatedAt });
      toast.success(
        result.coverageCleared
          ? `${result.message} The field coverage needs confirming again before it is activated.`
          : result.message,
      );
    } else if (result.status === "locked") {
      setLockedByServer(result.message);
    }
    return result;
  }, SAVE_IDLE);

  const canSave = editable && shapeOk && dirty && problems.length === 0 && !saving;

  // Cmd/Ctrl+S saves, as anywhere else.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (canSave) formRef.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSave]);

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Sticky things below the bar (the details panel, capture size bars) need its height.
  useLayoutEffect(() => {
    const bar = barRef.current;
    const root = rootRef.current;
    if (!bar || !root) return;
    const set = () => root.style.setProperty("--editor-bar-height", `${bar.offsetHeight}px`);
    set();
    const observer = new ResizeObserver(set);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  const order = shapeOk ? moduleOrder(draft, context) : [];
  const unused = shapeOk ? unusedModules(draft, context) : [];
  const problemCounts = new Map(order.map((key) => [key, problemsOfModule(problems, key).length]));
  const selectedKey = order.includes(selected) ? selected : (order[0] ?? "header");
  const titleOf = (key: ModuleKey) => (shapeOk ? moduleView(draft, context, key).title : MODULE_REGISTRY[key].title);

  const select = (key: ModuleKey) => {
    setSelected(key);
    if (!sideBySide) setSheetOpen(true);
  };

  const go = (place: ProblemPlace) => {
    if (place.area === "module") {
      setTab("modules");
      select(place.moduleKey);
      focusFirst(moduleFieldIds(place));
    } else if (place.area === "custom") {
      setTab("custom");
      setOpenCustom(place.index);
      focusFirst(ancestorIds((path) => customFieldId(place.index, path), place.path));
    } else if (isDetailPath(place.path)) {
      setTab("details");
      focusFirst(ancestorIds((path) => fieldId("details", path), place.path));
    } else {
      setTab("json");
      focusFirst(["template-json"]);
    }
  };

  const details = (headingId: string) => (
    <ModuleDetails
      api={api}
      moduleKey={selectedKey}
      position={order.indexOf(selectedKey)}
      total={order.length}
      headingId={headingId}
      onMove={(to) => update((current, currentContext) => moveModule(current, currentContext, selectedKey, to))}
    />
  );

  const statusWord = STATUS_WORD[template.status];
  const meta = [
    template.code,
    `Version ${template.version}`,
    statusWord,
    inheritance.bases[0] ? `Extends ${inheritance.bases[0].code} v${inheritance.bases[0].version}` : null,
    template.clientName ? `Client: ${template.clientName}` : null,
    template.manufacturerName ? `Manufacturer: ${template.manufacturerName}` : null,
  ].filter(Boolean);
  const otherDraft = template.versions.find((entry) => entry.status === "draft" && entry.id !== template.id) ?? null;

  return (
    <div ref={rootRef} className="grid gap-6" data-testid="template-editor" data-editable={editable}>
      <PageHeader
        eyebrow="Admin · Template editor"
        title={typeof draft.name === "string" && draft.name.trim() !== "" ? draft.name : template.code}
        description={<p data-testid="template-meta">{meta.join(" · ")}</p>}
        actions={
          <Button asChild variant="outline">
            <Link href={TEMPLATES_PATH}>
              <ArrowLeftIcon aria-hidden />
              All templates
            </Link>
          </Button>
        }
      />

      {reason && <LockedNotice templateId={template.id} reason={reason} draft={otherDraft} />}

      {template.stale.length > 0 && editable && (
        <Alert className="border-info-border bg-info-tint">
          <AlertTitle>A base template has moved on</AlertTitle>
          <AlertDescription className="text-info">
            {template.stale
              .map((base) =>
                base.active === null
                  ? `${base.code} has no active version any more (this was saved with version ${base.resolvedWith}).`
                  : `${base.code} is at version ${base.active} now; this was saved with version ${base.resolvedWith}.`,
              )
              .join(" ")}{" "}
            Saving takes in what the base has now.
          </AlertDescription>
        </Alert>
      )}

      {template.coverageConfirmedAt && editable && (
        <p className="text-sm text-muted-foreground">
          The field coverage of this version is confirmed. Saving a change clears that, so it is confirmed again before
          the version is activated.
        </p>
      )}

      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="gap-5">
        <div
          ref={barRef}
          data-slot="editor-bar"
          className="sticky top-(--shell-top) z-30 -mx-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-background px-6 py-2 xl:-mx-10 xl:px-10"
        >
          <TabsList className="max-w-full flex-wrap justify-start">
            <TabsTrigger value="modules">Modules</TabsTrigger>
            <TabsTrigger value="custom">Custom modules</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="json">JSON</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <SaveState saving={saving} editable={editable} dirty={dirty} problems={problems.length} result={saveState} />
            {editable && dirty && (
              <DiscardChanges
                onDiscard={() => {
                  setDraft(saved.definition);
                  setJsonText(null);
                  setDraftErrors(new Map());
                }}
              />
            )}
            {editable && (
              <form ref={formRef} action={saveAction}>
                <input type="hidden" name="id" value={template.id} />
                <input type="hidden" name="updatedAt" value={saved.updatedAt} />
                <input type="hidden" name="definition" value={JSON.stringify(draft)} />
                <Button type="submit" disabled={!canSave}>
                  {saving ? <LoaderCircleIcon aria-hidden className="animate-spin" /> : <SaveIcon aria-hidden />}
                  {saving ? "Saving…" : "Save"}
                </Button>
              </form>
            )}
          </div>
        </div>

        {(saveState.status === "error" || saveState.status === "conflict") && !saving && (
          <Alert variant="destructive" className="border-fail-border bg-fail-tint" data-testid="save-error">
            <OctagonXIcon aria-hidden />
            <AlertTitle>Not saved</AlertTitle>
            <AlertDescription className="grid gap-1 text-fail">
              <p>{saveState.message}</p>
              {saveState.status === "error" && saveState.problems && (
                <ul className="list-disc pl-5">
                  {saveState.problems.slice(0, 10).map((problem, index) => (
                    <li key={index}>
                      {[problem.template, problem.path.join(".")].filter(Boolean).join(" ")}: {problem.message}
                    </li>
                  ))}
                </ul>
              )}
            </AlertDescription>
          </Alert>
        )}

        {editable && (
          <ProblemsSummary
            problems={problems}
            titleOf={(place) => titleOf(place.moduleKey)}
            customTitleOf={(index) => ownCustomModules(draft)[index]?.title || `#${index + 1}`}
            onGo={go}
          />
        )}

        {!shapeOk && (
          <Alert className="border-warn-border bg-warn-tint">
            <AlertTitle>The definition does not match the template format</AlertTitle>
            <AlertDescription className="text-warn">
              The module list cannot show it. Fix it in the JSON tab first.
            </AlertDescription>
          </Alert>
        )}

        <TabsContent value="modules" className="text-base">
          {shapeOk && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
              <ModuleList
                order={order}
                viewOf={(key) => moduleView(draft, context, key)}
                unused={unused}
                titleOf={titleOf}
                stubs={STUBS}
                selected={sideBySide || sheetOpen ? selectedKey : null}
                problemCounts={problemCounts}
                editable={editable}
                onSelect={select}
                onInclude={(key, include) => update((current, currentContext) => setInclude(current, currentContext, key, include))}
                onMove={(key, to) => update((current, currentContext) => moveModule(current, currentContext, key, to))}
                onAdd={(key) => {
                  update((current, currentContext) => addModule(current, currentContext, key));
                  setSelected(key);
                }}
              />
              <div
                className={cn(
                  "hidden lg:block",
                  "lg:sticky lg:top-[calc(var(--shell-top)+var(--editor-bar-height,0px)+1rem)] lg:max-h-[calc(100dvh-var(--shell-top)-var(--editor-bar-height,0px)-2rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:rounded-xl lg:bg-slate-50 lg:p-1",
                )}
              >
                {sideBySide && details("module-details-heading")}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="custom" className="text-base">
          {shapeOk && <CustomModules api={api} open={openCustom} onOpen={setOpenCustom} />}
        </TabsContent>

        <TabsContent value="details" className="text-base">
          <DetailsForm api={api} />
        </TabsContent>

        <TabsContent value="json" className="text-base">
          <JsonView
            draft={draft}
            code={template.code}
            editable={editable}
            text={jsonText}
            onTextChange={setJsonText}
            onApply={(definition) => {
              setDraft(definition);
              setJsonText(null);
              toast.success("JSON applied. Save to keep it.");
            }}
          />
        </TabsContent>

        <TabsContent value="preview" className="text-base">
          <CapturePreview resolved={report.resolved ?? lastResolved} stale={report.resolved === null} inspector={viewer} />
        </TabsContent>
      </Tabs>

      <Sheet open={sheetOpen && !sideBySide && tab === "modules"} onOpenChange={setSheetOpen}>
        <SheetContent
          side="right"
          className="w-full gap-0 overflow-y-auto bg-background data-[side=right]:sm:max-w-2xl"
          // Into the sheet at its heading; a link from the problem list then moves on to the field.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById("module-sheet-heading")?.focus();
          }}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{titleOf(selectedKey)}</SheetTitle>
            <SheetDescription>Switch, position, heading, labels and settings of this module.</SheetDescription>
          </SheetHeader>
          <div className="p-4 pt-14 sm:p-6 sm:pt-14">{!sideBySide && details("module-sheet-heading")}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The bar: where the draft stands
 * ------------------------------------------------------------------ */

function SaveState({
  saving,
  editable,
  dirty,
  problems,
  result,
}: {
  saving: boolean;
  editable: boolean;
  dirty: boolean;
  problems: number;
  result: SaveResult;
}) {
  let text: string;
  let tone: string;
  if (saving) {
    text = "Saving…";
    tone = "border-brand-200 bg-brand-50 text-brand-700";
  } else if (!editable) {
    text = "Read only";
    tone = "border-border bg-card text-muted-foreground";
  } else if (problems > 0) {
    text = problems === 1 ? "1 problem" : `${problems} problems`;
    tone = "border-fail-border bg-fail-tint text-fail";
  } else if (dirty) {
    text = "Unsaved changes";
    tone = "border-warn-border bg-warn-tint text-warn";
  } else {
    text = result.status === "saved" ? "Saved" : "No changes";
    tone = "border-border bg-card text-muted-foreground";
  }
  return (
    <p
      role="status"
      data-testid="save-state"
      className={cn("inline-flex h-7 items-center rounded-full border px-3 text-sm font-medium whitespace-nowrap", tone)}
    >
      {text}
    </p>
  );
}

function DiscardChanges({ onDiscard }: { onDiscard: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost">
          <Undo2Icon aria-hidden />
          Discard
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
          <AlertDialogDescription>The template goes back to how it was last saved.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction onClick={onDiscard}>Discard changes</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ------------------------------------------------------------------ *
 * Taking the admin to a problem
 * ------------------------------------------------------------------ */

/** The field a module problem is about, then its nearest parents, then the module's switch. */
function moduleFieldIds(place: Extract<ProblemPlace, { area: "module" }>): string[] {
  switch (place.part) {
    case "config":
      return [...ancestorIds((path) => fieldId(configFieldPrefix(place.moduleKey), path), place.path), includeFieldId(place.moduleKey)];
    case "labels":
      return [labelFieldId(place.moduleKey, String(place.path[0] ?? "")), includeFieldId(place.moduleKey)];
    case "title":
      return [titleFieldId(place.moduleKey)];
    default:
      return [includeFieldId(place.moduleKey)];
  }
}

/** Ids for a path and each of its parents, a union's type select included: the closest one on screen is focused. */
function ancestorIds(idOf: (path: FormPath) => string, path: FormPath): string[] {
  const ids: string[] = [];
  for (let length = path.length; length >= 0; length -= 1) {
    const id = idOf(path.slice(0, length));
    ids.push(id, `${id}-type`, `${id}-on`);
  }
  return ids;
}

/** Focuses the first of these that is on screen, once the tab or sheet that holds it has opened. */
function focusFirst(ids: readonly string[], attempts = 12) {
  const tryNow = () => {
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element && element.getClientRects().length > 0) {
        element.scrollIntoView({ block: "center" });
        element.focus({ preventScroll: true });
        return true;
      }
    }
    return false;
  };
  const retry = (left: number) => {
    if (tryNow() || left <= 0) return;
    setTimeout(() => retry(left - 1), 60);
  };
  requestAnimationFrame(() => retry(attempts));
}
