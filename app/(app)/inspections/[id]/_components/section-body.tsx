"use client";

// The body of the open section. A module renders its own Capture
// (modules/<key>/Capture.tsx, loaded on demand through the registry) with
// the props of the contract (docs/MODULES.md 10), inside the file slot
// provider that shows force at break's, tensile's and documents' files
// (10.1): never an upload or a picker here, only the file Steri-AI linked
// from Source Documents, or what it found (source-file-link.tsx). A module
// without a Capture shows a simplified form of its canonical paths, a
// placeholder module says it is not built yet, and a custom module gets the
// screen's own form. A module whose settings cannot be read says so; saved
// values that no longer read are listed, with one confirmed way to remove
// them (unreadable-data.tsx).
//
// Offline (docs/OFFLINE.md: editing continues on a page already open): the
// screen downloads every section's form soon after it opens
// (preloadCaptures), so a section opened later without a connection still
// shows its form. One that did not arrive is asked for again once the
// connection is back, by the section itself or its "Try Again": a new
// download, rendered by a new boundary (a failed lazy component stays
// failed, and the boundary's own children would still hold it).
import { lazy, Suspense, useCallback, useMemo, useState, type LazyExoticComponent, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { MODULE_KEYS, type ModuleKey } from "@/lib/schemas/module-result";
import type { ResolvedModule } from "@/lib/schemas/template";
import type { IssuePath, ValidationIssue } from "@/lib/validation";
import { MODULE_REGISTRY } from "@/modules/registry";
import {
  effectiveLabels,
  parseModuleData,
  readModuleEntry,
  type CaptureComponent,
  type CaptureFocus,
  type CustomModuleEvaluation,
  type InspectionContext,
  type ModuleEvaluation,
} from "@/modules/_framework";
import { FileSlotProvider, type FileSlotRequest } from "@/modules/_framework/file-slot";
import { CustomModuleForm, FallbackModuleForm } from "./plain-forms";
import { SectionErrorBoundary } from "./section-error-boundary";
import { SourceFileLink } from "./source-file-link";
import { UnreadableData } from "./unreadable-data";

type LazyCapture = LazyExoticComponent<CaptureComponent>;
type CaptureCode = { default: CaptureComponent };

/* Each module's form code, downloading or downloaded, once per page: the
   preload and the section share one download. One that failed is
   forgotten, so the next asks again. */
const DOWNLOADS = new Map<ModuleKey, Promise<CaptureCode>>();

function downloadCapture(key: ModuleKey): Promise<CaptureCode> | null {
  const load = MODULE_REGISTRY[key].loadCapture;
  if (!load) return null;
  let download = DOWNLOADS.get(key);
  if (!download) {
    download = (load() as Promise<CaptureCode>).catch((error: unknown) => {
      DOWNLOADS.delete(key);
      throw error;
    });
    DOWNLOADS.set(key, download);
  }
  return download;
}

function lazyCapture(key: ModuleKey): LazyCapture | null {
  if (!MODULE_REGISTRY[key].loadCapture) return null;
  return lazy(() => downloadCapture(key) as Promise<CaptureCode>);
}

/* One lazy component per module, made once for the page, so switching back
   and forth never downloads a form's code again. One whose download failed
   stays failed: "Try Again" makes it afresh (ModuleBody's retry). */
const CAPTURES: Partial<Record<ModuleKey, LazyCapture | null>> = Object.fromEntries(
  MODULE_KEYS.map((key) => [key, lazyCapture(key)]),
);

/**
 * Downloads the forms of these modules now, while there is a connection, so
 * their sections open later without one. Each once per page; a failed one
 * is tried again on the next call.
 */
export function preloadCaptures(keys: readonly ModuleKey[]): void {
  for (const key of keys) void downloadCapture(key)?.catch(() => undefined);
}

type ModuleBodyProps = {
  inspectionId: string;
  moduleKey: ModuleKey;
  resolved: ResolvedModule;
  /** `data.modules.<key>` as stored, comment included. */
  entry: unknown;
  evaluation: ModuleEvaluation | null;
  context: InspectionContext;
  focusPath: IssuePath | null;
  /** The size kept from the sections before: a per-size Capture opens on it (CaptureProps.focus). */
  focus: CaptureFocus;
  /** Defects counted before, by code, for the most-used first (CaptureProps.defectUsage). */
  defectUsage: Readonly<Record<string, number>>;
  readOnly: boolean;
  onChange: (next: unknown) => void;
  onFocusChange: (focus: CaptureFocus) => void;
  /** Saved values that could not be read were removed: the form replaces their list, its button with it. */
  onUnreadableRemoved?: () => void;
  /**
   * On a page of two sections, this one's title: the buttons of a form that
   * did not show and of values that cannot be read are read out with it.
   */
  nameContext?: string;
};

export function ModuleBody({
  inspectionId,
  moduleKey,
  resolved,
  entry,
  evaluation,
  context,
  focusPath,
  focus,
  defectUsage,
  readOnly,
  onChange,
  onFocusChange,
  onUnreadableRemoved,
  nameContext,
}: ModuleBodyProps) {
  const definition = MODULE_REGISTRY[moduleKey];
  // A form that failed to show is asked for afresh: a new lazy component, under a new boundary.
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    CAPTURES[moduleKey] = lazyCapture(moduleKey);
    setAttempt((count) => count + 1);
  }, [moduleKey]);
  // By the labels, not the entry: an entry whose title the inspection fills in (withShownTitles) is a new object per evaluation.
  const savedLabels = resolved.labels;
  const labels = useMemo(() => effectiveLabels(definition, { labels: savedLabels }), [definition, savedLabels]);
  const config = useMemo(() => definition.configSchema.safeParse(resolved.config), [definition, resolved.config]);
  const moduleEntry = useMemo(
    () => readModuleEntry({ modules: { [moduleKey]: entry }, custom: {} }, "modules", moduleKey),
    [entry, moduleKey],
  );
  // Every saved size, also those no longer ordered: Capture hands them back unchanged (docs/MODULES.md 10).
  const saved = useMemo(() => parseModuleData(definition, moduleEntry), [definition, moduleEntry]);
  // The screen's file slot for a module's lab report or certificate: the Source Document
  // Steri-AI linked, with Preview and Unlink, or what Steri-AI found (docs/MODULES.md 10.1).
  const renderFileSlot = useCallback(
    (slot: FileSlotRequest) => <SourceFileLink inspectionId={inspectionId} slot={slot} readOnly={slot.readOnly || readOnly} />,
    [inspectionId, readOnly],
  );

  if (definition.stub) {
    return (
      <Notice>
        This section arrives in a later build. Nothing can be entered here yet; the checks show it as Not Done.
      </Notice>
    );
  }
  if (!config.success) {
    const issue = config.error.issues[0];
    return (
      <Problem>
        The template&apos;s settings for this section are invalid
        {issue ? ` (${[...issue.path.map(String), issue.message].join(": ")})` : ""}. Ask an admin to fix the template.
      </Problem>
    );
  }
  if (!saved.success) {
    // Never the Capture on what can be read: its first edit would drop the rest unasked (docs/MODULES.md 5).
    return (
      <UnreadableData
        definition={definition}
        entry={moduleEntry}
        issues={(evaluation?.issues ?? []).filter((issue) => issue.code === "invalid_data")}
        fallback={saved.error.issues[0]}
        focusPath={focusPath}
        readOnly={readOnly}
        onRemove={onChange}
        onRemoved={onUnreadableRemoved}
        nameContext={nameContext}
      />
    );
  }

  const Capture = CAPTURES[moduleKey];
  if (!Capture) {
    return (
      <FallbackModuleForm
        definition={definition}
        data={saved.data}
        config={config.data}
        labels={labels}
        issues={evaluation?.issues ?? []}
        focusPath={focusPath}
        readOnly={readOnly}
        onChange={onChange}
      />
    );
  }
  return (
    <SectionErrorBoundary key={attempt} title={resolved.title} onRetry={retry} nameContext={nameContext}>
      <Suspense fallback={<BodySkeleton />}>
        <FileSlotProvider render={renderFileSlot}>
          <Capture
            data={saved.data}
            config={config.data}
            title={resolved.title}
            labels={labels}
            context={context}
            evaluation={evaluation}
            focusPath={focusPath}
            focus={focus}
            defectUsage={defectUsage}
            readOnly={readOnly}
            onChange={onChange}
            onFocusChange={onFocusChange}
          />
        </FileSlotProvider>
      </Suspense>
    </SectionErrorBoundary>
  );
}

export function CustomBody({
  evaluation,
  entry,
  mappedValues,
  context,
  focusPath,
  readOnly,
  showRequired,
  onChange,
  onMappedChange,
  onFocusChange,
}: {
  evaluation: CustomModuleEvaluation;
  /** `data.custom.<key>` as stored, comment included. */
  entry: unknown;
  /**
   * What the mapped fields show (mappedFieldValues), from the data on screen:
   * `evaluation` runs a frame behind typing, and a text field fed its values
   * would undo keystrokes.
   */
  mappedValues: Readonly<Record<string, unknown>>;
  context: InspectionContext;
  focusPath: IssuePath | null;
  readOnly: boolean;
  /**
   * "X is required" under an empty field only once submit was tried: until
   * then the label says "(Required)" and the issues panel lists it.
   */
  showRequired: boolean;
  onChange: (next: Record<string, unknown>) => void;
  onMappedChange: (mapsTo: string, value: unknown) => void;
  onFocusChange: (focus: CaptureFocus) => void;
}) {
  const value = readModuleEntry({ modules: {}, custom: { [evaluation.custom.key]: entry } }, "custom", evaluation.custom.key).value;
  const issues = showRequired ? evaluation.issues : evaluation.issues.filter((issue) => issue.code !== "required");
  return (
    <CustomModuleForm
      custom={evaluation.custom}
      value={value}
      mappedValues={mappedValues}
      context={context}
      issues={issues as ValidationIssue[]}
      focusPath={focusPath}
      readOnly={readOnly}
      onChange={onChange}
      onMappedChange={onMappedChange}
      onFocusChange={onFocusChange}
    />
  );
}

/** A form still loading. The screen waits for none to be left before it scrolls to a section below another (capture-screen.tsx). */
export function BodySkeleton() {
  return (
    <div role="status" aria-live="polite" data-slot="body-skeleton" className="space-y-3">
      <span className="sr-only">Loading the form…</span>
      <Skeleton aria-hidden className="h-4 w-48 bg-slate-200" />
      <Skeleton aria-hidden className="h-11 w-full bg-slate-200" />
      <Skeleton aria-hidden className="h-11 w-full bg-slate-200" />
      <Skeleton aria-hidden className="h-11 w-2/3 bg-slate-200" />
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-not-done-border bg-not-done-tint px-4 py-3 text-sm text-foreground touch:text-base">
      {children}
    </p>
  );
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-fail-border bg-fail-tint px-4 py-3 text-sm font-medium text-fail touch:text-base"
    >
      {children}
    </p>
  );
}
