"use client";

// The capture screen (BUILD_SPEC 8 and 10): an inspection's sections as tabs
// with progress and a result chip each, the open section's form, the issues
// panel, autosave and submit.
//
// Layout: below 1280 px (the iPad) a section tab bar sticks under the shell's
// top bar with the save pill, and the form runs full width; from 1280 px a
// sidebar lists the sections with their progress and results, the save pill,
// Issues and Submit, and the form sits beside it.
//
// Data flow: the page renders the server's copy; autosave settles it against
// this device's local copy (a newer local copy is restored). Every edit
// replaces the module's data in one immutable `InspectionData`, goes to the
// local copy and the server (use-capture-autosave.ts), and the whole
// inspection is evaluated again with the framework (results, live totals,
// issues), a frame behind typing at most (useDeferredValue).
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, FileSearchIcon, ImagesIcon, ListChecksIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { ProgressTracker } from "@/components/qc";
import { Button } from "@/components/ui/button";
import type { CaptureAccess, UserRole } from "@/lib/inspections/capture/access";
import { evaluateCapture, type CaptureMeta } from "@/lib/inspections/capture/evaluate";
import { countIssues, groupIssues } from "@/lib/inspections/capture/issues";
import { canBeSwitchedOff } from "@/lib/inspections/capture/overrides";
import {
  captureSections,
  findSection,
  initialSectionKey,
  isIncluded,
  neighbours,
  progressSteps,
  type CaptureSection,
} from "@/lib/inspections/capture/sections";
import { describeWaitingUploads } from "@/lib/inspections/capture/uploads";
import { BUSY_MESSAGE, type AutosaveError, type StartResult } from "@/lib/offline";
import { contentHash } from "@/lib/offline/stable-json";
import { isModuleKey } from "@/lib/schemas/module-result";
import type { ModuleOverrides, ResolvedTemplate } from "@/lib/schemas/template";
import type { IssuePath, ValidationIssue } from "@/lib/validation";
import { cn } from "@/lib/utils";
import {
  parseCanonicalPath,
  readModuleEntry,
  writeModuleComment,
  writeModuleData,
  writePath,
  type CaptureFocus,
  type DataNamespace,
  type InspectionData,
} from "@/modules/_framework";
import { CaptureHeader, type CaptureHeading } from "./capture-header";
import { CaptureNotices, type CaptureNotice } from "./capture-notices";
import { ConflictDialog } from "./conflict-dialog";
import { IssuesSheet } from "./issues-sheet";
import { SwitchedOffPanel, SwitchOffDialog } from "./module-switch";
import { PhotoSlot } from "./photo-slot";
import { SaveIndicator } from "./save-indicator";
import { CustomBody, ModuleBody } from "./section-body";
import { SectionComment, SectionFrame } from "./section-frame";
import { SectionList } from "./section-list";
import { SectionTabs } from "./section-tabs";
import { SubmitControl, type SubmitPreparation } from "./submit-control";
import { useCaptureAutosave } from "./use-capture-autosave";
import { useStickyOffsets } from "./use-sticky-offsets";
import { useWaitingUploads } from "./use-waiting-uploads";

export type CaptureScreenProps = {
  inspectionId: string;
  heading: CaptureHeading;
  /** The exact template version, as stored in `templates.resolved`. */
  template: ResolvedTemplate;
  meta: CaptureMeta;
  initialData: InspectionData;
  /** inspections.updated_at as Postgres returned it. */
  initialUpdatedAt: string;
  initialOverrides: ModuleOverrides;
  /** Names of the admins who switched modules off, where this user may read them. */
  overrideAuthors: Readonly<Record<string, string>>;
  user: { id: string; role: UserRole };
  access: CaptureAccess;
  /** From `?module=`; the first section when it is not one. */
  initialSection: string | null;
};

type FocusRequest = { sectionKey: string; path: IssuePath };

export function CaptureScreen({
  inspectionId,
  heading,
  template,
  meta,
  initialData,
  initialUpdatedAt,
  initialOverrides,
  overrideAuthors,
  user,
  access,
  initialSection,
}: CaptureScreenProps) {
  const idPrefix = useId();
  const panelId = `${idPrefix}-section`;
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useStickyOffsets(rootRef, barRef);

  /* -------------------------------------------------------------- *
   * Data and autosave
   * -------------------------------------------------------------- */

  const [overrides, setOverrides] = useState(initialOverrides);
  const [data, setData] = useState(initialData);
  const dataRef = useRef(data);
  const [setAside, setSetAside] = useState(false);

  /** Data from the autosave (restored, or the other device's version): shown as it is, not saved again. */
  const replaceData = useCallback((next: InspectionData) => {
    dataRef.current = next;
    setData(next);
  }, []);

  const onStart = useCallback(
    (result: StartResult<InspectionData>) => {
      if (result.kind === "busy") return;
      if (result.kind === "conflict") {
        replaceData(result.local.data);
        return;
      }
      if (contentHash(result.data) !== contentHash(dataRef.current)) replaceData(result.data);
      if (result.kind === "restored") toast.info("Unsaved changes from this device were restored and are being saved.");
      if (result.kind === "current" && result.setAside) setSetAside(true);
    },
    [replaceData],
  );

  const autosave = useCaptureAutosave({
    inspectionId,
    userId: user.id,
    server: { data: initialData, updatedAt: initialUpdatedAt },
    enabled: access.editable,
    onStart,
  });
  const snapshot = autosave.snapshot;
  const conflict = snapshot?.conflict ?? null;
  const saveError = snapshot?.status === "error" ? snapshot.error : null;
  const refused = saveError?.reason === "forbidden" || saveError?.reason === "not_found";
  const readOnly = !access.editable || autosave.phase !== "running" || conflict !== null || refused;

  const commit = useCallback(
    (next: InspectionData) => {
      dataRef.current = next;
      setData(next);
      autosave.change(next);
    },
    [autosave],
  );

  const writeEntry = useCallback(
    (namespace: DataNamespace, key: string, next: unknown) => {
      if (typeof next !== "object" || next === null || Array.isArray(next)) {
        console.error(`[capture] ${key} handed back data that is not an object; nothing was stored.`, next);
        return;
      }
      commit(writeModuleData(dataRef.current, namespace, key, next as Record<string, unknown>));
    },
    [commit],
  );

  const writeComment = useCallback(
    (namespace: DataNamespace, key: string, comment: string) => {
      commit(writeModuleComment(dataRef.current, namespace, key, comment));
    },
    [commit],
  );

  /** A custom field mapped to a module (Field.mapsTo) edits that module's value. */
  const writeMapped = useCallback(
    (mapsTo: string, value: unknown) => {
      const target = parseCanonicalPath(mapsTo);
      if (!target) return;
      const current = readModuleEntry(dataRef.current, "modules", target.moduleKey).value;
      writeEntry("modules", target.moduleKey, writePath(current ?? {}, target.segments, value));
    },
    [writeEntry],
  );

  /* -------------------------------------------------------------- *
   * Evaluation and sections
   * -------------------------------------------------------------- */

  const deferredData = useDeferredValue(data);
  const evaluation = useMemo(
    () => evaluateCapture({ template, overrides, data: deferredData, meta }),
    [template, overrides, deferredData, meta],
  );
  const { report, context } = evaluation;
  const sections = useMemo(
    () => captureSections(evaluation.template, report, deferredData),
    [evaluation.template, report, deferredData],
  );

  const [activeKey, setActiveKey] = useState(() => initialSectionKey(sections, initialSection));
  const active = findSection(sections, activeKey) ?? sections.find(isIncluded) ?? sections[0];
  const [photoFocus, setPhotoFocus] = useState<CaptureFocus>({});
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  const syncUrl = useCallback((key: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set("module", key);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, []);

  /** Opens a section; the page scrolls back up to it when its top is out of view. */
  const selectSection = useCallback(
    (key: string, { focusHeading = false }: { focusHeading?: boolean } = {}) => {
      setActiveKey(key);
      setPhotoFocus({});
      setFocusRequest(null);
      syncUrl(key);
      requestAnimationFrame(() => {
        const title = headingRef.current;
        if (!title) return;
        const stickyTop = Number.parseFloat(rootRef.current?.style.getPropertyValue("--capture-sticky-top") ?? "") || 0;
        if (title.getBoundingClientRect().top < stickyTop) title.scrollIntoView({ block: "start" });
        if (focusHeading) title.focus({ preventScroll: true });
      });
    },
    [syncUrl],
  );

  /* -------------------------------------------------------------- *
   * Issues and submit
   * -------------------------------------------------------------- */

  const counts = useMemo(() => countIssues(report.issues), [report.issues]);
  const groups = useMemo(() => groupIssues(report.issues, sections), [report.issues, sections]);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

  const openIssues = useCallback(() => {
    setBlockedMessage(null);
    setIssuesOpen(true);
  }, []);

  const goToIssue = useCallback(
    (issue: ValidationIssue) => {
      setIssuesOpen(false);
      setBlockedMessage(null);
      const sectionKey = issue.moduleKey;
      setActiveKey(sectionKey);
      setPhotoFocus({});
      syncUrl(sectionKey);
      // Cleared first, so the same link twice still moves focus.
      setFocusRequest(null);
      requestAnimationFrame(() => {
        if (issue.path.length === 0) {
          headingRef.current?.scrollIntoView({ block: "start" });
          headingRef.current?.focus({ preventScroll: true });
          return;
        }
        setFocusRequest({ sectionKey, path: issue.path });
        // Nothing in the section took focus (a form without marks): its title does.
        window.setTimeout(() => {
          const panel = document.getElementById(panelId);
          if (panel && !panel.contains(document.activeElement)) {
            headingRef.current?.scrollIntoView({ block: "start" });
            headingRef.current?.focus({ preventScroll: true });
          }
        }, 700);
      });
    },
    [panelId, syncUrl],
  );

  const uploads = useWaitingUploads({ inspectionId, userId: user.id });

  const prepareSubmit = useCallback(async (): Promise<SubmitPreparation> => {
    try {
      if (!(await uploads.isEmptyNow())) {
        return {
          ok: false,
          message: `${uploads.count && uploads.count > 0 ? describeWaitingUploads(uploads.count) : "Photos are still uploading"}. Submit once they are done.`,
        };
      }
    } catch {
      return { ok: false, message: "Could not check this device's photo uploads. Try again." };
    }
    const flushed = await autosave.flush();
    if (!flushed.ok) return { ok: false, message: `Not everything is saved yet. ${flushed.message}` };
    return { ok: true, dataHash: contentHash(dataRef.current) };
  }, [autosave, uploads]);

  // After a refused submit, empty required fields say so where they are, too.
  const [submitTried, setSubmitTried] = useState(false);
  const onBlocked = useCallback((message: string) => {
    setSubmitTried(true);
    setBlockedMessage(message);
    setIssuesOpen(true);
  }, []);

  /* -------------------------------------------------------------- *
   * Notices
   * -------------------------------------------------------------- */

  const notices = useMemo(
    () =>
      captureNotices({
        access,
        role: user.role,
        reviewHref: `/inspections/${inspectionId}/review`,
        phase: autosave.phase,
        setAside,
        error: autosave.phase === "running" ? saveError : null,
        localCopy: snapshot?.localCopy ?? true,
        pending: snapshot?.pending ?? false,
        retry: autosave.retryNow,
        signInHref: `/login?next=${encodeURIComponent(`/inspections/${inspectionId}`)}`,
      }),
    [access, user.role, inspectionId, autosave.phase, autosave.retryNow, setAside, saveError, snapshot?.localCopy, snapshot?.pending],
  );

  // Changes only this page holds (no local copy) would be lost by leaving: the browser asks first.
  const unsafeToLeave = Boolean(snapshot?.pending && !snapshot.localCopy);
  useEffect(() => {
    if (!unsafeToLeave) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsafeToLeave]);

  /* -------------------------------------------------------------- *
   * Render
   * -------------------------------------------------------------- */

  const saveStatus = !access.editable ? null : (snapshot?.status ?? "saved");
  const submitControl = (className?: string) =>
    access.editable ? (
      <SubmitControl
        inspectionId={inspectionId}
        refNo={heading.refNo}
        errorCount={counts.errors}
        warningCount={counts.warnings}
        suggested={report.suggested}
        prepare={prepareSubmit}
        onBlocked={onBlocked}
        disabled={readOnly}
        className={className}
      />
    ) : null;
  const issuesButton = (className?: string) => (
    <IssuesButton errors={counts.errors} warnings={counts.warnings} onClick={openIssues} className={className} />
  );
  const { previous, next } = active ? neighbours(sections, active.key) : { previous: null, next: null };

  return (
    <div ref={rootRef} data-slot="capture-screen" className="flex flex-col gap-6">
      <CaptureHeader
        heading={heading}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/inspections/${inspectionId}/photos`}>
                <ImagesIcon aria-hidden />
                Photos
              </Link>
            </Button>
            {heading.status !== "draft" && (
              <Button asChild variant="outline">
                <Link href={`/inspections/${inspectionId}/review`}>
                  <FileSearchIcon aria-hidden />
                  Review
                </Link>
              </Button>
            )}
            {issuesButton("xl:hidden")}
            {submitControl("xl:hidden")}
          </>
        }
      />

      <CaptureNotices notices={notices} />

      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[16rem_minmax(0,1fr)] xl:items-start xl:gap-8">
        {/* From 1280 px: the sidebar. */}
        <aside
          aria-label="Sections and progress"
          className="hidden xl:sticky xl:top-(--shell-top) xl:flex xl:max-h-dvh xl:flex-col xl:gap-4 xl:self-start xl:overflow-y-auto xl:py-1"
        >
          <div className="space-y-4 rounded-xl bg-card p-3 shadow-sm ring-1 ring-border">
            {saveStatus && (
              <div className="px-1">
                <SaveIndicator status={saveStatus} pendingUploads={uploads.count} />
              </div>
            )}
            <ProgressTracker
              className="px-1"
              steps={progressSteps(sections)}
              activeKey={active?.key}
              label="Progress"
            />
            <SectionList sections={sections} activeKey={active?.key ?? ""} onSelect={(key) => selectSection(key)} />
            <div className="flex flex-col gap-2 border-t border-border px-1 pt-3">
              {issuesButton("w-full justify-between")}
              {submitControl("w-full")}
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          {/* Below 1280 px: the sticky section tab bar with the save pill. */}
          <div
            ref={barRef}
            className={cn(
              "sticky top-(--shell-top) z-30 flex items-center gap-3 border-b border-border bg-card xl:hidden",
              "-mr-[max(1.5rem,env(safe-area-inset-right))] -ml-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))]",
            )}
          >
            <SectionTabs
              sections={sections}
              activeKey={active?.key ?? ""}
              onSelect={(key) => selectSection(key)}
              panelId={panelId}
              idPrefix={idPrefix}
            />
            {saveStatus && <SaveIndicator status={saveStatus} pendingUploads={uploads.count} className="shrink-0" />}
          </div>

          <ProgressTracker
            className="xl:hidden"
            steps={progressSteps(sections)}
            activeKey={active?.key}
            onStepSelect={(key) => selectSection(key)}
            label="Progress"
          />

          {active && (
            <ActiveSection
              key={active.key}
              section={active}
              panelId={panelId}
              headingRef={headingRef}
              template={template}
              effective={evaluation.template}
              overrides={overrides}
              overrideAuthors={overrideAuthors}
              data={data}
              report={report}
              context={context}
              focusPath={focusRequest?.sectionKey === active.key ? focusRequest.path : null}
              readOnly={readOnly}
              showRequired={submitTried}
              access={access}
              inspectionId={inspectionId}
              photoFocus={photoFocus}
              onPhotoFocus={setPhotoFocus}
              onModuleChange={(key, value) => writeEntry("modules", key, value)}
              onCustomChange={(key, value) => writeEntry("custom", key, value)}
              onMappedChange={writeMapped}
              onCommentChange={writeComment}
              onOverridesChange={setOverrides}
            />
          )}

          {(previous || next) && (
            <nav aria-label="Previous and next section" className="flex flex-wrap items-center justify-between gap-3">
              {previous ? (
                <Button type="button" variant="outline" onClick={() => selectSection(previous.key, { focusHeading: true })}>
                  <ChevronLeftIcon aria-hidden />
                  <span className="sr-only">Previous: </span>
                  <span className="max-w-60 truncate">{previous.title}</span>
                </Button>
              ) : (
                <span />
              )}
              {next && (
                <Button type="button" onClick={() => selectSection(next.key, { focusHeading: true })}>
                  <span className="sr-only">Next: </span>
                  <span className="max-w-60 truncate">{next.title}</span>
                  <ChevronRightIcon aria-hidden />
                </Button>
              )}
            </nav>
          )}
        </div>
      </div>

      <IssuesSheet
        open={issuesOpen}
        onOpenChange={(open) => {
          setIssuesOpen(open);
          if (!open) setBlockedMessage(null);
        }}
        groups={groups}
        counts={counts}
        blockedMessage={blockedMessage}
        onGo={goToIssue}
      />
      <ConflictDialog
        open={conflict !== null}
        localChangedAt={conflict?.local.changedAt ?? null}
        onKeep={(keep) => {
          const kept = autosave.resolveConflict(keep);
          if (kept) replaceData(kept);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The open section
 * ------------------------------------------------------------------ */

type ActiveSectionProps = {
  section: CaptureSection;
  panelId: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** As stored, for what may be switched off. */
  template: ResolvedTemplate;
  /** Overrides applied: what capture shows. */
  effective: ResolvedTemplate;
  overrides: ModuleOverrides;
  overrideAuthors: Readonly<Record<string, string>>;
  data: InspectionData;
  report: ReturnType<typeof evaluateCapture>["report"];
  context: ReturnType<typeof evaluateCapture>["context"];
  focusPath: IssuePath | null;
  readOnly: boolean;
  /** Submit was tried: empty required fields say so. */
  showRequired: boolean;
  access: CaptureAccess;
  inspectionId: string;
  photoFocus: CaptureFocus;
  onPhotoFocus: (focus: CaptureFocus) => void;
  onModuleChange: (key: string, value: unknown) => void;
  onCustomChange: (key: string, value: unknown) => void;
  onMappedChange: (mapsTo: string, value: unknown) => void;
  onCommentChange: (namespace: DataNamespace, key: string, comment: string) => void;
  onOverridesChange: (overrides: ModuleOverrides) => void;
};

function ActiveSection({
  section,
  panelId,
  headingRef,
  template,
  effective,
  overrides,
  overrideAuthors,
  data,
  report,
  context,
  focusPath,
  readOnly,
  showRequired,
  access,
  inspectionId,
  photoFocus,
  onPhotoFocus,
  onModuleChange,
  onCustomChange,
  onMappedChange,
  onCommentChange,
  onOverridesChange,
}: ActiveSectionProps) {
  if (section.kind === "excluded") {
    return (
      <SectionFrame id={panelId} title={section.title} headingRef={headingRef} summary="Switched off for this inspection">
        <SwitchedOffPanel
          inspectionId={inspectionId}
          moduleKey={section.key}
          title={section.title}
          override={section.override}
          author={overrideAuthors[section.override.by] ?? null}
          canSwitch={access.canSwitchModules}
          onChanged={onOverridesChange}
        />
      </SectionFrame>
    );
  }

  const namespace: DataNamespace = section.kind === "module" ? "modules" : "custom";
  const entry = data[namespace][section.key];
  const comment = readModuleEntry(data, namespace, section.key).comment;
  const footer = (
    <>
      <SectionComment
        value={comment}
        onChange={(text) => onCommentChange(namespace, section.key, text)}
        readOnly={readOnly}
      />
      <PhotoSlot inspectionId={inspectionId} moduleKey={section.key} focus={photoFocus} />
    </>
  );

  if (section.kind === "custom") {
    const evaluation = report.custom.find((candidate) => candidate.custom.key === section.key);
    return (
      <SectionFrame
        id={panelId}
        title={section.title}
        headingRef={headingRef}
        status={section.status}
        footer={footer}
      >
        {evaluation && (
          <CustomBody
            evaluation={evaluation}
            entry={entry}
            context={context}
            focusPath={focusPath}
            readOnly={readOnly}
            showRequired={showRequired}
            onChange={(next) => onCustomChange(section.key, next)}
            onMappedChange={onMappedChange}
            onFocusChange={onPhotoFocus}
          />
        )}
      </SectionFrame>
    );
  }

  const resolved = effective.modules.find((candidate) => candidate.key === section.key);
  const evaluation = report.modules.find((candidate) => candidate.key === section.key) ?? null;
  const switchable =
    access.canSwitchModules && isModuleKey(section.key) && canBeSwitchedOff(template, overrides, section.key);
  return (
    <SectionFrame
      id={panelId}
      title={section.title}
      headingRef={headingRef}
      status={section.status}
      // A placeholder's summary ("Not built yet") repeats the notice in its body.
      summary={section.stub ? undefined : section.summary || undefined}
      actions={
        switchable ? (
          <SwitchOffDialog
            inspectionId={inspectionId}
            moduleKey={section.key}
            title={section.title}
            onChanged={onOverridesChange}
          />
        ) : undefined
      }
      footer={footer}
    >
      {resolved && (
        <ModuleBody
          moduleKey={section.key}
          resolved={resolved}
          entry={entry}
          evaluation={evaluation}
          context={context}
          focusPath={focusPath}
          readOnly={readOnly}
          onChange={(next) => onModuleChange(section.key, next)}
          onFocusChange={onPhotoFocus}
        />
      )}
    </SectionFrame>
  );
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

function IssuesButton({
  errors,
  warnings,
  onClick,
  className,
}: {
  errors: number;
  warnings: number;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button type="button" variant="outline" onClick={onClick} className={className} data-action="issues" aria-haspopup="dialog">
      <span className="inline-flex items-center gap-1.5">
        <ListChecksIcon aria-hidden />
        Issues
      </span>
      <span className="inline-flex items-center gap-1">
        {errors > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-fail-solid px-1.5 text-xs font-bold text-fail-solid-foreground tabular-nums">
            {errors}
            <span className="sr-only">{errors === 1 ? " error" : " errors"}</span>
          </span>
        )}
        {warnings > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warn-solid px-1.5 text-xs font-bold text-warn-solid-foreground tabular-nums">
            {warnings}
            <span className="sr-only">{warnings === 1 ? " warning" : " warnings"}</span>
          </span>
        )}
      </span>
    </Button>
  );
}

function captureNotices({
  access,
  role,
  reviewHref,
  phase,
  setAside,
  error,
  localCopy,
  pending,
  retry,
  signInHref,
}: {
  access: CaptureAccess;
  role: UserRole;
  reviewHref: string;
  phase: ReturnType<typeof useCaptureAutosave>["phase"];
  setAside: boolean;
  error: AutosaveError | null;
  localCopy: boolean;
  pending: boolean;
  retry: () => void;
  signInHref: string;
}): CaptureNotice[] {
  const notices: CaptureNotice[] = [];
  const reload = (
    <Button type="button" variant="outline" size="sm" onClick={() => window.location.reload()}>
      <RefreshCwIcon aria-hidden />
      Reload
    </Button>
  );

  if (access.readOnlyReason === "approved") {
    notices.push({ key: "approved", tone: "lock", message: "Approved: this inspection is read-only." });
  } else if (access.readOnlyReason === "submitted") {
    notices.push({
      key: "submitted",
      tone: "lock",
      message:
        role === "admin"
          ? "Submitted for review: read-only here. To change it, reopen it from the review."
          : "Submitted for review: read-only. An admin can send it back to you for changes.",
      action: (
        <Button asChild variant="outline" size="sm">
          <Link href={reviewHref}>Open the review</Link>
        </Button>
      ),
    });
  } else if (access.readOnlyReason === "not_yours") {
    notices.push({ key: "not-yours", tone: "lock", message: "This inspection belongs to another inspector: read-only." });
  }

  if (phase === "busy") notices.push({ key: "busy", tone: "warn", message: BUSY_MESSAGE, action: reload });
  if (phase === "failed") {
    notices.push({
      key: "failed",
      tone: "error",
      message: "Saving could not start on this page. Reload it before entering anything.",
      action: reload,
    });
  }
  if (setAside) {
    notices.push({
      key: "set-aside",
      tone: "info",
      message: "An older unsaved copy on this device could not be read and was kept aside.",
    });
  }

  if (error && error.reason !== "conflict") {
    const action =
      error.reason === "unauthorized" ? (
        <Button asChild variant="outline" size="sm">
          <Link href={signInHref}>Sign in again</Link>
        </Button>
      ) : error.reason === "other_tab" ? (
        reload
      ) : error.reason === "storage" ? undefined : (
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          <RefreshCwIcon aria-hidden />
          Try again
        </Button>
      );
    notices.push({ key: "save-error", tone: "error", message: `Not saved. ${error.message}`, action });
  } else if (!localCopy && pending) {
    notices.push({
      key: "no-local-copy",
      tone: "warn",
      message: "This browser keeps no copy on this device. Keep the page open until it shows Saved.",
    });
  }
  return notices;
}
