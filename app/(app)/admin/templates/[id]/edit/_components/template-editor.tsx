"use client";

// The template editor (BUILD_SPEC 4.5, 10): the modules with their switches,
// order, wording and settings; custom modules; the template's details; the
// JSON; a live capture preview. The draft lives here until Save, which
// writes the definition and its resolution (actions.ts). A version that is
// in use, active or retired opens read only, with "New version".
//
// Unsaved changes are not lost by accident: any link out of the page asks
// first (the shell's too), the browser asks before a reload or close where
// it can, and a copy kept on the device (backup.ts) is offered back when the
// version opens again, for the iPad, where Safari never asks.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeftIcon,
  ClipboardCheckIcon,
  HistoryIcon,
  LoaderCircleIcon,
  OctagonXIcon,
  SaveIcon,
  Undo2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader, useMediaQuery } from "@/components/qc";
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
import { deepEqual, isPlainObject, type FormPath } from "@/lib/zod-form";
import { fieldId } from "@/lib/zod-form/schema-form";
import { MODULE_REGISTRY } from "@/modules";
import { saveTemplate } from "../actions";
import {
  backupKey,
  deviceStorage,
  foundBackupStore,
  offeredBackup,
  readBackup,
  removeBackup,
  sweepBackups,
  writeBackup,
} from "../_lib/backup";
import { isDetailPath } from "../_lib/details";
import { inheritanceOf } from "../_lib/inheritance";
import { leavingTo } from "../_lib/leave";
import type { DefectCodeOption, EditorTemplate, ReferenceOption } from "../_lib/load";
import {
  addModule,
  moduleOrder,
  moduleView,
  moveModule,
  setInclude,
  unusedModules,
  type Draft,
  type EditorContext,
} from "../_lib/model";
import {
  collectProblems,
  hasDraftPlace,
  isEditableShape,
  placeId,
  problemsOfModule,
  scopeProblems,
  serverProblem,
  type DraftError,
  type ProblemPlace,
} from "../_lib/problems";
import { placeLabels } from "../_lib/names";
import { lockedReason, SAVE_IDLE, type SaveResult } from "../_lib/results";
import { CapturePreview } from "./capture-preview";
import { configFieldPrefix } from "./config-form";
import { customFieldId } from "./custom-module-form";
import { CustomModules } from "./custom-modules";
import { DetailsForm } from "./details-form";
import type { EditorApi } from "./editor-api";
import { JsonView } from "./json-view";
import { labelFieldId } from "./label-overrides";
import { LockedNotice } from "./locked-notice";
import { editModuleSelector, ModuleList } from "./module-list";
import { includeFieldId, ModuleDetails, titleFieldId } from "./module-details";
import { ProblemsSummary } from "./problems-summary";

type Tab = "modules" | "custom" | "details" | "json" | "preview";

export const TEMPLATES_PATH = "/admin/templates";

/** Where the module list and its details sit side by side (Tailwind's lg: iPad landscape and wider). */
const SIDE_BY_SIDE = "(min-width: 64rem)";

const STATUS_WORD = { draft: "Draft", active: "Active", retired: "Retired" } as const;

const STUBS: ReadonlySet<ModuleKey> = new Set(
  (Object.keys(MODULE_REGISTRY) as ModuleKey[]).filter((key) => MODULE_REGISTRY[key].stub),
);

/** How long typing pauses before the device copy is written. */
const BACKUP_DELAY_MS = 400;

const BACKUP_TIME = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function TemplateEditor({
  template,
  bases,
  defectCodes,
  scopeOptions,
  viewer,
}: {
  template: EditorTemplate;
  bases: TemplateBase[];
  defectCodes: DefectCodeOption[];
  scopeOptions: { clients: ReferenceOption[]; manufacturers: ReferenceOption[] };
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
  /** Where a link the admin followed with unsaved changes goes, while the editor asks. */
  const [leaving, setLeaving] = useState<string | null>(null);
  /** Bumped when the draft is replaced wholesale (Discard, JSON, a restored copy): fields start again from it. */
  const [formKey, setFormKey] = useState(0);
  const router = useRouter();
  const sideBySide = useMediaQuery(SIDE_BY_SIDE);
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  /** What had the focus when the module sheet opened, and the link that opened the Leave dialog: focus goes back there. */
  const sheetOpener = useRef<HTMLElement | null>(null);
  const leaveOpener = useRef<HTMLElement | null>(null);

  const extendsCode = typeof draft.extends === "string" ? draft.extends : undefined;
  const inheritance = useMemo(
    () => inheritanceOf({ code: draft.code, extends: extendsCode }, lookup),
    [draft.code, extendsCode, lookup],
  );
  const context = useMemo<EditorContext>(() => ({ inheritance, registry: MODULE_REGISTRY }), [inheritance]);
  const shapeOk = isEditableShape(draft);
  // Text kept for a field that was closed counts while its field is still there.
  const liveDraftErrors = useMemo(
    () => [...draftErrors.values()].filter((entry) => hasDraftPlace(entry, draft, context)),
    [draftErrors, draft, context],
  );
  const report = useMemo(
    () => collectProblems(draft, context, { code: template.code, getBase: lookup, draftErrors: liveDraftErrors }),
    [draft, context, template.code, lookup, liveDraftErrors],
  );
  const jsonPending = jsonText !== null && jsonText !== JSON.stringify(draft, null, 2);
  const problems = useMemo(
    () => [
      ...report.problems,
      ...scopeProblems(draft, scopeOptions),
      ...(jsonPending
        ? [
            {
              id: "json-pending",
              place: { area: "template", path: ["json"] } satisfies ProblemPlace,
              message: "The JSON tab has changes that are not applied yet: apply them or undo them.",
            },
          ]
        : []),
    ],
    [report.problems, draft, scopeOptions, jsonPending],
  );

  // The preview keeps the last version that resolved while the draft has problems.
  const [lastResolved, setLastResolved] = useState<ResolvedTemplate | null>(report.resolved);
  if (report.resolved && report.resolved !== lastResolved) setLastResolved(report.resolved);

  const reason = lockedByServer ?? lockedReason({ version: template.version, status: template.status, inUse: template.inUse });
  const editable = reason === null;
  const dirty = !deepEqual(draft, saved.definition);
  // Nothing changed, yet Save has work: no stored resolution, one this build cannot read, or a base that moved on.
  // The saved version is the one loaded until a save; after one, the page reloads its facts.
  const resolveDue = (template.resolution !== "ok" || template.stale.length > 0) && saved.updatedAt === template.updatedAt;

  const update: EditorApi["update"] = (change) =>
    setDraft((current) => change(current, { inheritance: inheritanceOf(current, lookup), registry: MODULE_REGISTRY }));

  /** The draft replaced as a whole: fields drop what they held, and kept field text goes. */
  const replaceDraft = (next: Draft) => {
    setDraft(next);
    setJsonText(null);
    setDraftErrors(new Map());
    setFormKey((key) => key + 1);
  };

  const reportDraftError: EditorApi["reportDraftError"] = (place, entry) =>
    setDraftErrors((current) => {
      const id = placeId(place);
      const existing = current.get(id);
      if (entry === null ? !existing : existing?.message === entry.message && existing.text === entry.text) return current;
      const next = new Map(current);
      if (entry === null) next.delete(id);
      else next.set(id, { place, message: entry.message, text: entry.text });
      return next;
    });

  const draftFor: EditorApi["draftFor"] = (place) => {
    const entry = draftErrors.get(placeId(place));
    return entry && hasDraftPlace(entry, draft, context) ? { text: entry.text, message: entry.message } : undefined;
  };

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
    draftFor,
    sizes,
    defectCodes,
    scopeOptions,
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

  const canSave = editable && shapeOk && (dirty || resolveDue) && problems.length === 0 && !saving;

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

  // Leaving with unsaved changes asks first: the browser for a reload, a close or another site...
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ...and the editor for any link to another page of the app, the shell's sidebar and top bar included.
  useEffect(() => {
    if (!dirty) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      const to = leavingTo(
        {
          href: link.href,
          target: link.target,
          download: link.hasAttribute("download"),
          button: event.button,
          modified: event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
        },
        window.location.href,
      );
      if (to === null) return;
      // Before Next.js's Link sees the click: it leaves a click whose default is prevented alone.
      event.preventDefault();
      leaveOpener.current = link;
      setLeaving(to);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  // A copy of the unsaved changes on this device, offered back when the version opens again.
  const storageKey = backupKey(viewer.id, template.id);
  const backupStore = useMemo(() => foundBackupStore(() => readDeviceBackup(storageKey)), [storageKey]);
  const found = useSyncExternalStore(backupStore.subscribe, backupStore.get, () => null);
  const offer = offeredBackup(found, { updatedAt: template.updatedAt, definition: template.definition });
  const offerPending = offer !== null;
  /** The copy writer's latest unwritten copy, and whether the admin chose to leave without the changes. */
  const pendingBackup = useRef<(() => void) | null>(null);
  const droppedChanges = useRef(false);

  useEffect(() => {
    const storage = deviceStorage();
    if (!storage) return;
    if (!dirty) {
      pendingBackup.current = null;
      // A copy still on offer stays until the admin restores or discards it.
      if (!offerPending) removeBackup(storage, storageKey);
      return;
    }
    const write = () => {
      pendingBackup.current = null;
      if (droppedChanges.current) return;
      writeBackup(storage, storageKey, { v: 1, updatedAt: saved.updatedAt, savedAt: Date.now(), definition: draft });
    };
    pendingBackup.current = write;
    const timer = window.setTimeout(write, BACKUP_DELAY_MS);
    const onHidden = () => {
      if (document.visibilityState === "hidden") write();
    };
    window.addEventListener("pagehide", write);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", write);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [draft, dirty, saved.updatedAt, storageKey, offerPending]);

  // Unmounted by a navigation the editor did not stop (Back): the last changes still go into the copy.
  useEffect(() => () => pendingBackup.current?.(), []);

  const restoreBackup = () => {
    if (!offer) return;
    replaceDraft(offer.definition as Draft);
    backupStore.dismiss();
    toast.success("Your unsaved changes are back. Save to keep them.");
  };

  const discardBackup = () => {
    const storage = deviceStorage();
    if (storage) removeBackup(storage, storageKey);
    backupStore.dismiss();
  };

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
    if (sideBySide) return;
    // The sheet hands the focus back to what opened it: the module's Edit button, or a problem's link.
    if (!sheetOpen) sheetOpener.current = focusedElement();
    setSheetOpen(true);
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
      // Another module, or a draft replaced as a whole: its fields start from what is stored.
      key={`${selectedKey}:${formKey}`}
      api={api}
      moduleKey={selectedKey}
      position={order.indexOf(selectedKey)}
      total={order.length}
      headingId={headingId}
      onMove={(to) => update((current, currentContext) => moveModule(current, currentContext, selectedKey, to))}
    />
  );

  const statusWord = STATUS_WORD[template.status];
  // The scope as the draft has it, by name: it changes in the Details tab.
  const scope: Record<string, unknown> = isPlainObject(draft.scope) ? draft.scope : {};
  const nameOf = (options: readonly ReferenceOption[], id: unknown) =>
    typeof id === "string" ? (options.find((option) => option.id === id)?.name ?? "Unknown") : null;
  const clientName = nameOf(scopeOptions.clients, scope.clientId);
  const manufacturerName = nameOf(scopeOptions.manufacturers, scope.manufacturerId);
  const meta = [
    template.code,
    `Version ${template.version}`,
    statusWord,
    inheritance.bases[0] ? `Extends ${inheritance.bases[0].code} v${inheritance.bases[0].version}` : null,
    clientName ? `Client: ${clientName}` : null,
    manufacturerName ? `Manufacturer: ${manufacturerName}` : null,
  ].filter(Boolean);
  const otherDraft = template.versions.find((entry) => entry.status === "draft" && entry.id !== template.id) ?? null;

  return (
    <div ref={rootRef} className="grid gap-6" data-testid="template-editor" data-editable={editable}>
      <PageHeader
        eyebrow="Admin · Template editor"
        title={typeof draft.name === "string" && draft.name.trim() !== "" ? draft.name : template.code}
        description={<p data-testid="template-meta">{meta.join(" · ")}</p>}
        actions={
          // With unsaved changes, the editor asks before it follows either link (see the link guard above).
          <>
            <Button asChild variant="outline">
              <Link href={TEMPLATES_PATH}>
                <ArrowLeftIcon aria-hidden />
                All templates
              </Link>
            </Button>
            {/* BUILD_SPEC 4.5 step 4: the source file, the coverage checklist and activation are on the version's page. */}
            <Button asChild variant="outline">
              <Link href={`${TEMPLATES_PATH}/${template.id}`} data-testid="version-page-link">
                <ClipboardCheckIcon aria-hidden />
                Checklist and activation
              </Link>
            </Button>
          </>
        }
      />
      <AlertDialog
        open={leaving !== null}
        onOpenChange={(open) => {
          if (!open) setLeaving(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            // Back to the link that was followed: no trigger of its own to return to.
            event.preventDefault();
            focusBack(leaveOpener.current);
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>Your changes to this draft are not saved yet. Leaving drops them.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const to = leaving;
                droppedChanges.current = true;
                discardBackup();
                if (to) router.push(to);
              }}
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {offer && (
        <Alert className="border-info-border bg-info-tint" data-testid="restore-offer">
          <HistoryIcon aria-hidden />
          <AlertTitle>Unsaved changes from {BACKUP_TIME.format(offer.savedAt)}</AlertTitle>
          <AlertDescription className="grid gap-3 text-info">
            <p>
              This draft was left with changes that were not saved, on this device.
              {editable ? " Restore them to go on, or discard them." : " This version can no longer change: restored, they go into a new version."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={restoreBackup}>
                <HistoryIcon aria-hidden />
                Restore changes
              </Button>
              <Button type="button" variant="outline" onClick={discardBackup}>
                Discard them
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {reason && (
        <LockedNotice
          templateId={template.id}
          reason={reason}
          draft={otherDraft}
          // Changes made before the version locked (or restored from the device) can start the new version.
          carry={dirty && shapeOk && problems.length === 0 ? JSON.stringify(draft) : null}
          stranded={dirty && (!shapeOk || problems.length > 0)}
        />
      )}

      {editable && resolveDue && template.resolution !== "ok" && (
        <Alert className="border-warn-border bg-warn-tint" data-testid="resolve-due">
          <AlertTitle>{template.resolution === "missing" ? "Not resolved yet" : "Resolved by an earlier build"}</AlertTitle>
          <AlertDescription className="text-warn">
            {template.resolution === "missing"
              ? "This draft has no stored resolution, so its version page shows no modules and it cannot be activated."
              : "Its stored resolution cannot be read by this build, so it cannot be activated."}{" "}
            {problems.length > 0
              ? "Fix the problems below, then save: saving resolves it and stores the result."
              : "Save resolves it and stores the result."}
          </AlertDescription>
        </Alert>
      )}

      {editable && resolveDue && template.stale.length > 0 && (
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
          The field coverage of this version is confirmed. A save that changes the template, or what it resolves to,
          clears that, so it is confirmed again before the version is activated.
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
            <SaveState
              saving={saving}
              editable={editable}
              dirty={dirty}
              resolveDue={resolveDue ? (template.resolution === "ok" ? "base" : "resolution") : null}
              problems={problems.length}
              result={saveState}
            />
            {editable && dirty && (
              <DiscardChanges
                onDiscard={() => {
                  replaceDraft(saved.definition);
                  discardBackup();
                }}
                // Its button goes with the changes: the focus goes to the tab in view.
                focusAfter={() => barRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus()}
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
                  {saveState.problems.slice(0, 10).map((problem, index) => {
                    // Named as the problem list names places: by the labels on the way there, never by keys.
                    const found = serverProblem(draft, problem, template.code);
                    return (
                      <li key={index}>
                        {placeLabels(found.place, { draft, context, sizes, shapeOk }).join(" › ")}: {found.message}
                      </li>
                    );
                  })}
                </ul>
              )}
            </AlertDescription>
          </Alert>
        )}

        {editable && (
          <ProblemsSummary
            problems={problems}
            whereOf={(place) => placeLabels(place, { draft, context, sizes, shapeOk })}
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
          {shapeOk && <CustomModules key={formKey} api={api} open={openCustom} onOpen={setOpenCustom} />}
        </TabsContent>

        <TabsContent value="details" className="text-base">
          <DetailsForm key={formKey} api={api} />
        </TabsContent>

        <TabsContent value="json" className="text-base">
          <JsonView
            draft={draft}
            code={template.code}
            editable={editable}
            text={jsonText}
            onTextChange={setJsonText}
            onApply={(definition) => {
              replaceDraft(definition);
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
          className="gap-0 overflow-y-auto bg-background data-[side=right]:w-full data-[side=right]:sm:max-w-3xl"
          // Into the sheet at its heading; a link from the problem list then moves on to the field.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById("module-sheet-heading")?.focus();
          }}
          // Out of it, back to what opened it; if that is gone (a problem fixed), to the module's Edit button.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            focusBack(sheetOpener.current, document.querySelector<HTMLElement>(editModuleSelector(selectedKey)));
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
  resolveDue,
  problems,
  result,
}: {
  saving: boolean;
  editable: boolean;
  dirty: boolean;
  /** Save has work with nothing changed: a resolution to store, or a base that moved on. */
  resolveDue: "resolution" | "base" | null;
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
  } else if (resolveDue) {
    text = resolveDue === "resolution" ? "Not resolved yet" : "Base moved on";
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

function DiscardChanges({ onDiscard, focusAfter }: { onDiscard: () => void; focusAfter: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" data-discard>
          <Undo2Icon aria-hidden />
          Discard
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          // Kept editing: back to Discard, as usual. Discarded: the button went with the changes.
          if (document.querySelector("[data-discard]")) return;
          event.preventDefault();
          focusAfter();
        }}
      >
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

/** The copy of unsaved changes this device kept for a version, after dropping the ones too old to offer. */
function readDeviceBackup(key: string) {
  const storage = deviceStorage();
  if (!storage) return null;
  sweepBackups(storage, Date.now());
  return readBackup(storage, key);
}

/* ------------------------------------------------------------------ *
 * Focus
 * ------------------------------------------------------------------ */

function focusedElement(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

/** Focus on `element` if it is still on the page and can take it, else on `fallback`. */
function focusBack(element: HTMLElement | null, fallback: HTMLElement | null = null) {
  const usable = (candidate: HTMLElement | null): candidate is HTMLElement =>
    candidate !== null && candidate.isConnected && !candidate.matches(":disabled") && candidate.getClientRects().length > 0;
  if (usable(element)) element.focus();
  else if (usable(fallback)) fallback.focus();
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
