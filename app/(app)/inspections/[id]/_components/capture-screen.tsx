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
// issues), a frame behind typing at most (useDeferredValue). Saves also
// bring back the inspection's status and module overrides, so a section
// switched off or a submit made on another device shows here too.
//
// Focus (BUILD_SPEC 8.1): what a module reports in focus tags its section's
// photos, and nothing else does: each section starts untagged. The size in
// it is also kept for the next section's module to open on, so the size
// chosen in one module stays chosen in the next without tagging the photos
// of a section that does not show it.
//
// Leaving: number fields keep a half-typed value until they lose focus, and
// a tap on the iPad does not move focus, so whatever way the screen goes, the
// field is left first and its value kept: a click outside the open section
// (a link, the shell's menu, Submit), the browser's Back (the Navigation
// API's navigate, else popstate), and the page being hidden, reloaded or
// closed (pagehide, visibilitychange, beforeunload). The header's Photos and
// Review wait for the last save, and so do the shell's links and Sign out,
// through the shell's leave guard, which asks the inspector first when the
// change would be lost (leave-answer.ts); any other way out within the app
// sends it as the screen goes, and the local copy keeps it otherwise
// (use-capture-autosave.ts).
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon, FileSearchIcon, ImagesIcon, ListChecksIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { useInspectionFiles } from "@/components/capture/files";
import { PhotoSlot, photoUploadsSettled, useUploadsWaiting } from "@/components/capture/photos";
import { ProgressTracker, useMediaQuery, WIDE_QUERY } from "@/components/qc";
import { useLeaveGuard } from "@/components/shell/use-leave-guard";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { isEditableStatus, type CaptureAccess, type UserRole } from "@/lib/inspections/capture/access";
import { INSPECTIONS_PATH } from "@/lib/inspections/search-params";
import type { DefectUsage } from "@/lib/inspections/capture/defect-usage";
import { evaluateCapture, type CaptureMeta } from "@/lib/inspections/capture/evaluate";
import { mappedFieldValues } from "@/lib/inspections/capture/fields";
import { countIssues, groupIssues, unseenIssues } from "@/lib/inspections/capture/issues";
import { canBeSwitchedOff } from "@/lib/inspections/capture/overrides";
import type { ReopenNote } from "@/lib/inspections/capture/reopen";
import {
  captureSections,
  findSection,
  initialSectionKey,
  isIncluded,
  neighbours,
  progressSteps,
  type CaptureSection,
} from "@/lib/inspections/capture/sections";
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
import type { CaptureServerState } from "../actions";
import { CaptureHeader, type CaptureHeading } from "./capture-header";
import { CaptureNotices, type CaptureNotice } from "./capture-notices";
import { ConflictDialog } from "./conflict-dialog";
import { IssuesSheet } from "./issues-sheet";
import { leaveAnswer } from "./leave-answer";
import { SwitchedOffPanel, SwitchOffDialog } from "./module-switch";
import { SaveIndicator } from "./save-indicator";
import { CustomBody, ModuleBody } from "./section-body";
import { SectionComment, SectionFrame } from "./section-frame";
import { SectionList } from "./section-list";
import { SectionTabs, tabId } from "./section-tabs";
import { SubmitControl, type SubmitBlocked, type SubmitPreparation } from "./submit-control";
import { LEAVE_FLUSH_MS, useCaptureAutosave } from "./use-capture-autosave";
import { useStickyOffsets } from "./use-sticky-offsets";

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
  /** Why an admin reopened it, while it is reopened. */
  reopenNote?: ReopenNote | null;
  /** Defects counted in earlier inspections, by code: the defect lists open on the most-used ones. */
  defectUsage?: DefectUsage;
};

type FocusRequest = { sectionKey: string; path: IssuePath };

const NO_USAGE: DefectUsage = {};
/** Nothing in focus: what a section's photo tags, and the kept size, start from. */
const NO_FOCUS: CaptureFocus = {};

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
  reopenNote = null,
  defectUsage = NO_USAGE,
}: CaptureScreenProps) {
  const idPrefix = useId();
  const panelId = `${idPrefix}-section`;
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useStickyOffsets(rootRef, barRef, panelId);

  /* -------------------------------------------------------------- *
   * Data and autosave
   * -------------------------------------------------------------- */

  const [overrides, setOverrides] = useState(initialOverrides);
  const [data, setData] = useState(initialData);
  const dataRef = useRef(data);
  const [setAside, setSetAside] = useState(false);
  // The status as the last save found it: submitted or approved since the page loaded means another device did it.
  const [serverStatus, setServerStatus] = useState(heading.status);
  const lockedElsewhere = access.editable && !isEditableStatus(serverStatus);

  /** Overrides the server answered with: a section switched off or on elsewhere leaves or joins capture here. */
  const followOverrides = useCallback((next: ModuleOverrides) => {
    setOverrides((current) => (contentHash(current) === contentHash(next) ? current : next));
  }, []);

  const followServer = useCallback(
    (state: CaptureServerState) => {
      setServerStatus(state.status);
      followOverrides(state.overrides);
    },
    [followOverrides],
  );

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
    onServerState: followServer,
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

  // The inspection's files, this device's queued ones included: whether a kept lab report is attached (docs/MODULES.md 10.1).
  const files = useInspectionFiles(inspectionId);
  const liveMeta = useMemo<CaptureMeta>(() => ({ ...meta, files }), [meta, files]);
  const deferredData = useDeferredValue(data);
  const evaluation = useMemo(
    () => evaluateCapture({ template, overrides, data: deferredData, meta: liveMeta }),
    [template, overrides, deferredData, liveMeta],
  );
  const { report, context } = evaluation;
  const sections = useMemo(
    () => captureSections(evaluation.template, report, deferredData),
    [evaluation.template, report, deferredData],
  );

  const [activeKey, setActiveKey] = useState(() => initialSectionKey(sections, initialSection));
  const active = findSection(sections, activeKey) ?? sections.find(isIncluded) ?? sections[0];
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  // The size a module last reported in focus, in whichever section: the next
  // module opens on it (CaptureProps.focus), so the size chosen in one stays
  // chosen in the next. It never tags a photo: a section's photos take only
  // what its own module reported (ActiveSection).
  const [keptFocus, setKeptFocus] = useState<CaptureFocus>(NO_FOCUS);
  const keepSize = useCallback((focus: CaptureFocus) => {
    const { size } = focus;
    if (size) setKeptFocus((current) => (current.size === size ? current : { size }));
  }, []);

  const syncUrl = useCallback((key: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set("module", key);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, []);

  /**
   * Leaves the field being edited in the open section, so a half-typed value
   * is stored for the section it was typed in before that section goes
   * (number fields commit on blur; a tap on the iPad does not move focus).
   */
  const leaveActiveField = useCallback(() => {
    const field = document.activeElement;
    if (field instanceof HTMLElement && document.getElementById(panelId)?.contains(field)) field.blur();
  }, [panelId]);

  // The same for every click outside the open section, before the click does
  // its work: a link that leaves the screen (the shell's menu too), Submit,
  // Issues. Inside the section a click is the form's own business, unless it
  // follows a link.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const panel = document.getElementById(panelId);
      const field = document.activeElement;
      if (!panel || !(field instanceof HTMLElement) || !panel.contains(field)) return;
      const target = event.target;
      const inside = target instanceof Node && panel.contains(target);
      const followsLink = target instanceof Element && target.closest("a[href]") !== null;
      if (inside && !followsLink) return;
      field.blur();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [panelId]);

  /* Photos and Review in the header: the next page reads the inspection from
     the server, so the last change is saved first (briefly: LEAVE_FLUSH_MS). */
  const photosHref = `/inspections/${inspectionId}/photos`;
  const reviewHref = `/inspections/${inspectionId}/review`;
  const router = useRouter();
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [leavingTo, setLeavingTo] = useState<string | null>(null);
  const leaveTo = useCallback(
    async (href: string) => {
      leaveActiveField();
      setLeavingTo(href);
      try {
        await autosave.flush({ timeoutMs: LEAVE_FLUSH_MS });
      } finally {
        // Gone meanwhile (another link was followed): stay out of its way.
        if (mounted.current) router.push(href);
      }
    },
    [autosave, leaveActiveField, router],
  );

  /** Opens a section; the page scrolls back up to it when its top is out of view. */
  const selectSection = useCallback(
    (key: string, { focusHeading = false }: { focusHeading?: boolean } = {}) => {
      leaveActiveField();
      setActiveKey(key);
      setFocusRequest(null);
      syncUrl(key);
      requestAnimationFrame(() => {
        const title = headingRef.current;
        if (!title) return;
        if (title.getBoundingClientRect().top < stickyTopOf(rootRef.current)) scrollToTitle(title, rootRef.current);
        if (focusHeading) title.focus({ preventScroll: true });
      });
    },
    [leaveActiveField, syncUrl],
  );

  /* -------------------------------------------------------------- *
   * Issues and submit
   * -------------------------------------------------------------- */

  const counts = useMemo(() => countIssues(report.issues), [report.issues]);
  const groups = useMemo(() => groupIssues(report.issues, sections), [report.issues, sections]);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  // The errors the server found when it refused a submit.
  const [serverErrors, setServerErrors] = useState<readonly ValidationIssue[] | null>(null);
  /**
   * Of those, the ones this screen does not show. The overrides they were
   * found with are taken over (onBlocked), so they usually appear here at
   * once; any left over mean the inspection changed in another way.
   */
  const unseenErrors = useMemo(() => unseenIssues(serverErrors, report.issues), [serverErrors, report.issues]);

  const closeBlocked = useCallback(() => {
    setBlockedMessage(null);
    setServerErrors(null);
  }, []);

  const openIssues = useCallback(() => {
    closeBlocked();
    setIssuesOpen(true);
  }, [closeBlocked]);

  const goToIssue = useCallback(
    (issue: ValidationIssue) => {
      setIssuesOpen(false);
      closeBlocked();
      const sectionKey = issue.moduleKey;
      setActiveKey(sectionKey);
      syncUrl(sectionKey);
      setFocusRequest(null);
      // After the panel has closed and the section is on screen.
      requestAnimationFrame(() => {
        const title = headingRef.current;
        if (issue.path.length === 0) {
          if (title) scrollToTitle(title, rootRef.current);
          title?.focus({ preventScroll: true });
          return;
        }
        // A new array for every click (docs/CAPTURE_KIT.md, "Issue links"):
        // useIssueFocus follows each one once, so the same link twice still works.
        setFocusRequest({ sectionKey, path: [...issue.path] });
        // Nothing in the section took focus (a form without marks): its title does.
        window.setTimeout(() => {
          const panel = document.getElementById(panelId);
          const heading = headingRef.current;
          if (panel && heading && !panel.contains(document.activeElement)) {
            scrollToTitle(heading, rootRef.current);
            heading.focus({ preventScroll: true });
          }
        }, 700);
      });
    },
    [closeBlocked, panelId, syncUrl],
  );

  // Photos and files of this inspection still on this device hold submit up (BUILD_SPEC 8.1); the save pill shows the badge.
  const uploadsWaiting = useUploadsWaiting(inspectionId);

  const prepareSubmit = useCallback(async (): Promise<SubmitPreparation> => {
    try {
      // Also counts what another tab queued for this inspection.
      if (!(await photoUploadsSettled(inspectionId))) {
        return { ok: false, message: "Photos or files of this inspection are still uploading. Submit once they are done." };
      }
    } catch {
      return { ok: false, message: "Could not check this device's photo uploads. Try again." };
    }
    const flushed = await autosave.flush();
    if (!flushed.ok) return { ok: false, message: `Not everything is saved yet. ${flushed.message}` };
    return { ok: true, dataHash: contentHash(dataRef.current) };
  }, [autosave, inspectionId]);

  // After a refused submit, empty required fields say so where they are, too.
  const [submitTried, setSubmitTried] = useState(false);
  const onBlocked = useCallback(
    ({ message, errors, overrides: found }: SubmitBlocked) => {
      setSubmitTried(true);
      setBlockedMessage(message);
      setServerErrors(errors);
      if (found) followOverrides(found);
      setIssuesOpen(true);
    },
    [followOverrides],
  );

  /* -------------------------------------------------------------- *
   * Switching sections off and on (admins)
   * -------------------------------------------------------------- */

  // The button pressed goes with the change (Switch off with the section's
  // header controls, Switch back on with the panel): the title takes focus.
  const focusTitleFor = useRef<ModuleOverrides | null>(null);
  const onSwitched = useCallback((next: ModuleOverrides) => {
    focusTitleFor.current = next;
    setOverrides(next);
  }, []);
  useEffect(() => {
    if (focusTitleFor.current !== overrides) return;
    focusTitleFor.current = null;
    headingRef.current?.focus({ preventScroll: true });
  }, [overrides]);

  // Saved values that could not be read, removed: the section's form takes
  // the place of their list, and the button that opened the confirmation
  // went with it, so the title takes the focus rather than the page. A field
  // the form focused itself (an issue link it follows) keeps it.
  const focusTitleAfterRemoval = useCallback(() => {
    const title = headingRef.current;
    if (!title || document.getElementById(panelId)?.contains(document.activeElement)) return;
    if (title.getBoundingClientRect().top < stickyTopOf(rootRef.current)) scrollToTitle(title, rootRef.current);
    title.focus({ preventScroll: true });
  }, [panelId]);

  // Below 1280 px the open section is the tab bar's panel; from 1280 px a region beside the sidebar.
  const wide = useMediaQuery(WIDE_QUERY);

  /* -------------------------------------------------------------- *
   * Notices
   * -------------------------------------------------------------- */

  const notices = useMemo(
    () =>
      captureNotices({
        access,
        role: user.role,
        reviewHref,
        lockedElsewhere,
        // Only while it is still reopened: submitted again, the note has done its work.
        reopenNote: serverStatus === "reopened" ? reopenNote : null,
        phase: autosave.phase,
        setAside,
        error: autosave.phase === "running" ? saveError : null,
        localCopy: snapshot?.localCopy ?? true,
        pending: snapshot?.pending ?? false,
        retry: autosave.retryNow,
        signInHref: `/login?next=${encodeURIComponent(`/inspections/${inspectionId}`)}`,
      }),
    [
      access,
      user.role,
      reviewHref,
      inspectionId,
      lockedElsewhere,
      serverStatus,
      reopenNote,
      autosave.phase,
      autosave.retryNow,
      setAside,
      saveError,
      snapshot?.localCopy,
      snapshot?.pending,
    ],
  );

  /* -------------------------------------------------------------- *
   * Leaving without a click: Back, reload, closing the tab, sleep
   * -------------------------------------------------------------- */

  // A value typed and not yet committed is kept however the page goes.
  // Back: the router replaces the screen inside its own popstate listener,
  // registered before this one, and a field removed by React commits
  // nothing (React ignores the blur of a node it is removing). The
  // Navigation API's navigate event comes before popstate, so the field is
  // left there, and the unmount's flush sends the value; popstate stays as
  // the fallback where there is no Navigation API. A hidden page (the iPad
  // asleep, another app) commits it and saves at once; the local copy keeps
  // it if the save does not get out. A reload or a closed tab does the same,
  // and the browser asks first only when nothing on this device would keep
  // the change. Listeners on window, in the capture phase, run before the
  // autosave's own.
  const { flush, getSnapshot } = autosave;
  useEffect(() => {
    const keepAndSave = () => {
      leaveActiveField();
      void flush({ timeoutMs: LEAVE_FLUSH_MS });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") keepAndSave();
    };
    const onNavigate = (event: Event) => {
      if ((event as Event & { navigationType?: string }).navigationType === "traverse") leaveActiveField();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      leaveActiveField();
      const state = getSnapshot();
      // Changes only this page holds (no local copy) would be lost by leaving.
      if (state?.pending && !state.localCopy) event.preventDefault();
    };
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    navigation?.addEventListener("navigate", onNavigate);
    window.addEventListener("popstate", leaveActiveField, true);
    window.addEventListener("pagehide", keepAndSave, true);
    window.addEventListener("visibilitychange", onVisibility, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      navigation?.removeEventListener("navigate", onNavigate);
      window.removeEventListener("popstate", leaveActiveField, true);
      window.removeEventListener("pagehide", keepAndSave, true);
      window.removeEventListener("visibilitychange", onVisibility, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [flush, getSnapshot, leaveActiveField]);

  // The shell's links and Sign out ask the screen first (components/shell
  // leave-guard.ts), so they wait for the last save as Photos and Review do:
  // the field being typed is left (the shell has usually left it already),
  // the change sent, for LEAVE_FLUSH_MS at most, inside the shell's 3 s, and
  // the shell asks the inspector only when the change would be lost
  // (leave-answer.ts). Registered while the inspection can be changed here.
  const refNo = heading.refNo;
  useLeaveGuard(
    access.editable
      ? async (reason) => {
          leaveActiveField();
          await flush({ timeoutMs: LEAVE_FLUSH_MS });
          return leaveAnswer(getSnapshot(), reason, refNo);
        }
      : null,
  );

  /* -------------------------------------------------------------- *
   * Render
   * -------------------------------------------------------------- */

  // Another tab is the writer: read-only here on purpose, and the notice says so. No red pill for that.
  const quietSave = autosave.phase === "busy" || saveError?.reason === "other_tab";
  const saveStatus = !access.editable || quietSave ? null : (snapshot?.status ?? "saved");
  // As the last save found it: submitted on another device shows here as submitted.
  const shownHeading = serverStatus === heading.status ? heading : { ...heading, status: serverStatus };
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
        uploadsWaiting={uploadsWaiting}
        disabled={readOnly}
        className={className}
      />
    ) : null;
  const issuesButton = (className?: string) => (
    <IssuesButton errors={counts.errors} warnings={counts.warnings} onClick={openIssues} className={className} />
  );
  const { previous, next } = active ? neighbours(sections, active.key) : { previous: null, next: null };

  return (
    <div
      ref={rootRef}
      data-slot="capture-screen"
      className={cn(
        "flex flex-col gap-6",
        // Until use-sticky-offsets measures: the shell's top bar, plus the section tab bar below 1280 px.
        "[--capture-sticky-bottom:0px] [--capture-sticky-top:0px]",
        "max-xl:[--capture-sticky-top:calc(var(--shell-top,0px)_+_2.5rem_+_1px)] max-xl:touch:[--capture-sticky-top:calc(var(--shell-top,0px)_+_2.75rem_+_1px)]",
      )}
    >
      <CaptureHeader
        heading={shownHeading}
        actions={
          <>
            <LeaveLink
              href={photosHref}
              icon={<ImagesIcon aria-hidden />}
              leaving={leavingTo === photosHref}
              onLeave={leaveTo}
            >
              Photos
            </LeaveLink>
            {shownHeading.status !== "draft" && (
              <LeaveLink
                href={reviewHref}
                icon={<FileSearchIcon aria-hidden />}
                leaving={leavingTo === reviewHref}
                onLeave={leaveTo}
              >
                Review
              </LeaveLink>
            )}
            {issuesButton("xl:hidden")}
            {submitControl("xl:hidden")}
            {/* Last, on the right: back to the list, saving first like the links above. */}
            <LeaveLink
              href={INSPECTIONS_PATH}
              icon={<ArrowLeftIcon aria-hidden />}
              leaving={leavingTo === INSPECTIONS_PATH}
              onLeave={leaveTo}
              // In the iPad's row of actions under the title, at the far right as on desktop.
              className="ml-auto xl:ml-0"
            >
              Back<span className="sr-only"> to inspections</span>
            </LeaveLink>
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
                <SaveIndicator status={saveStatus} inspectionId={inspectionId} />
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
            data-slot="capture-bar"
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
            {saveStatus && <SaveIndicator status={saveStatus} inspectionId={inspectionId} className="shrink-0" />}
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
              tabLabelledBy={wide ? undefined : tabId(idPrefix, active.key)}
              template={template}
              effective={evaluation.template}
              overrides={overrides}
              overrideAuthors={overrideAuthors}
              userId={user.id}
              data={data}
              report={report}
              context={context}
              focusPath={focusRequest?.sectionKey === active.key ? focusRequest.path : null}
              readOnly={readOnly}
              showRequired={submitTried}
              access={access}
              inspectionId={inspectionId}
              keptFocus={keptFocus}
              defectUsage={defectUsage}
              onFocusReported={keepSize}
              onUnreadableRemoved={focusTitleAfterRemoval}
              onModuleChange={(key, value) => writeEntry("modules", key, value)}
              onCustomChange={(key, value) => writeEntry("custom", key, value)}
              onMappedChange={writeMapped}
              onCommentChange={writeComment}
              onOverridesChange={onSwitched}
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
          if (!open) closeBlocked();
        }}
        groups={groups}
        counts={counts}
        blockedMessage={blockedMessage}
        unseenErrors={unseenErrors}
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
  /** Below 1280 px: the id of the section's tab, which names the panel (WAI-ARIA tabs). */
  tabLabelledBy?: string;
  /** As stored, for what may be switched off. */
  template: ResolvedTemplate;
  /** Overrides applied: what capture shows. */
  effective: ResolvedTemplate;
  overrides: ModuleOverrides;
  overrideAuthors: Readonly<Record<string, string>>;
  /** The signed-in user: "Switched off by you". */
  userId: string;
  data: InspectionData;
  report: ReturnType<typeof evaluateCapture>["report"];
  context: ReturnType<typeof evaluateCapture>["context"];
  focusPath: IssuePath | null;
  readOnly: boolean;
  /** Submit was tried: empty required fields say so. */
  showRequired: boolean;
  access: CaptureAccess;
  inspectionId: string;
  /** The size kept from the sections before: the module opens on it (CaptureProps.focus). Never a photo tag. */
  keptFocus: CaptureFocus;
  defectUsage: DefectUsage;
  /** Every focus the section's module or form reports, so its size is kept for the next section. */
  onFocusReported: (focus: CaptureFocus) => void;
  /** Saved values that could not be read were removed, and the button that did it went with their list. */
  onUnreadableRemoved: () => void;
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
  tabLabelledBy,
  template,
  effective,
  overrides,
  overrideAuthors,
  userId,
  data,
  report,
  context,
  focusPath,
  readOnly,
  showRequired,
  access,
  inspectionId,
  keptFocus,
  defectUsage,
  onFocusReported,
  onUnreadableRemoved,
  onModuleChange,
  onCustomChange,
  onMappedChange,
  onCommentChange,
  onOverridesChange,
}: ActiveSectionProps) {
  // What this section's module or form reported in focus, and only that,
  // tags its photos (BUILD_SPEC 8.1). Every section starts with nothing (the
  // screen keys ActiveSection by it), so the size kept from another section
  // tags a photo here only once the module here shows it and says so, as
  // tensile does for the size it opens on.
  const [photoFocus, setPhotoFocus] = useState<CaptureFocus>(NO_FOCUS);
  const onFocusChange = useCallback(
    (focus: CaptureFocus) => {
      setPhotoFocus((current) => (sameFocus(current, focus) ? current : focus));
      onFocusReported(focus);
    },
    [onFocusReported],
  );

  if (section.kind === "excluded") {
    return (
      <SectionFrame
        id={panelId}
        tabLabelledBy={tabLabelledBy}
        title={section.title}
        headingRef={headingRef}
        summary="Switched off for this inspection"
      >
        <SwitchedOffPanel
          inspectionId={inspectionId}
          moduleKey={section.key}
          title={section.title}
          override={section.override}
          author={section.override.by === userId ? "you" : (overrideAuthors[section.override.by] ?? null)}
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
      {/* Side by side with the comment, its heading and its box take the footer's two rows. */}
      <PhotoSlot
        inspectionId={inspectionId}
        moduleKey={section.key}
        focus={photoFocus}
        readOnly={readOnly}
        className="xl:row-span-2 xl:grid xl:grid-rows-subgrid"
      />
    </>
  );

  if (section.kind === "custom") {
    const evaluation = report.custom.find((candidate) => candidate.custom.key === section.key);
    return (
      <SectionFrame
        id={panelId}
        tabLabelledBy={tabLabelledBy}
        title={section.title}
        headingRef={headingRef}
        status={section.status}
        footer={footer}
      >
        {evaluation && (
          <CustomBody
            evaluation={evaluation}
            entry={entry}
            mappedValues={mappedFieldValues(evaluation.custom, data)}
            context={context}
            focusPath={focusPath}
            readOnly={readOnly}
            showRequired={showRequired}
            onChange={(next) => onCustomChange(section.key, next)}
            onMappedChange={onMappedChange}
            onFocusChange={onFocusChange}
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
      tabLabelledBy={tabLabelledBy}
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
          inspectionId={inspectionId}
          moduleKey={section.key}
          resolved={resolved}
          entry={entry}
          evaluation={evaluation}
          context={context}
          focusPath={focusPath}
          focus={keptFocus}
          defectUsage={defectUsage}
          readOnly={readOnly}
          onChange={(next) => onModuleChange(section.key, next)}
          onFocusChange={onFocusChange}
          onUnreadableRemoved={onUnreadableRemoved}
        />
      )}
    </SectionFrame>
  );
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

/** The same things in focus: a module reporting again what it reported changes nothing on screen. */
function sameFocus(a: CaptureFocus, b: CaptureFocus): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof CaptureFocus)[]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

/** Space between the sticky bars and a section title scrolled up to them. */
const TITLE_GAP_PX = 16;

/** Where the screen's sticky bars end (use-sticky-offsets.ts), in px from the top of the viewport. */
function stickyTopOf(root: HTMLElement | null): number {
  return Number.parseFloat(root?.style.getPropertyValue("--capture-sticky-top") ?? "") || 0;
}

/**
 * Scrolls the page so a section title sits just below the sticky bars. Not
 * scrollIntoView: the page's scroll padding also makes room for a module's
 * own sticky size bar, which is not stuck while its title is in view.
 */
function scrollToTitle(title: HTMLElement, root: HTMLElement | null) {
  const top = window.scrollY + title.getBoundingClientRect().top - stickyTopOf(root) - TITLE_GAP_PX;
  window.scrollTo({ top: Math.max(0, top) });
}

/**
 * A header link that leaves the capture screen once the last change is
 * saved: Next.js's navigation is held (onNavigate) while `onLeave` saves and
 * then follows the link. Opening it in a new tab works as any link.
 */
function LeaveLink({
  href,
  icon,
  leaving,
  onLeave,
  className,
  children,
}: {
  href: string;
  icon: ReactNode;
  /** Saving before leaving for this link. */
  leaving: boolean;
  onLeave: (href: string) => void;
  className?: string;
  children: ReactNode;
}) {
  const onNavigate: ComponentProps<typeof Link>["onNavigate"] = (event) => {
    event.preventDefault();
    onLeave(href);
  };
  return (
    <Button asChild variant="outline" className={className}>
      <Link href={href} onNavigate={onNavigate} aria-busy={leaving || undefined}>
        {leaving ? <Spinner aria-hidden /> : icon}
        {children}
      </Link>
    </Button>
  );
}

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
  // Calm on purpose (Kenneth: red and amber counts felt alarming): "Pending" with a blue dot
  // while anything is open; the counts and what blocks submit are read out, and shown in the sheet.
  const open = errors + warnings;
  return (
    <Button type="button" variant="outline" onClick={onClick} className={className} data-action="issues" aria-haspopup="dialog">
      <span className="inline-flex items-center gap-1.5">
        <ListChecksIcon aria-hidden />
        Pending
      </span>
      {open > 0 && (
        <>
          <span aria-hidden data-slot="pending-dot" className="size-2.5 shrink-0 rounded-full bg-primary" />
          <span className="sr-only">
            {`: ${open} open`}
            {errors > 0 ? `, ${errors} to fix before submit` : ""}
          </span>
        </>
      )}
    </Button>
  );
}

function captureNotices({
  access,
  role,
  reviewHref,
  lockedElsewhere,
  reopenNote,
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
  /** Submitted or approved since this page loaded, as a save found: the review is where it went. */
  lockedElsewhere: boolean;
  /** Why it was reopened, while it is. */
  reopenNote: ReopenNote | null;
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

  if (reopenNote) {
    notices.push({
      key: "reopened",
      tone: "info",
      message: (
        <>
          <span className="font-semibold">{reopenNote.title}.</span> {reopenNote.body}
          {reopenNote.reason && (
            <span className="mt-1 block font-normal whitespace-pre-line text-foreground">
              <span className="font-semibold">{reopenNote.reason.label}:</span> {reopenNote.reason.text}
            </span>
          )}
        </>
      ),
    });
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
    let action: ReactNode;
    if (error.reason === "unauthorized") {
      action = (
        <Button asChild variant="outline" size="sm">
          <Link href={signInHref}>Sign in again</Link>
        </Button>
      );
    } else if (error.reason === "forbidden" || error.reason === "not_found") {
      // Refused for good (submitted elsewhere, no longer this user's, gone): trying again cannot help.
      action = lockedElsewhere ? (
        <>
          <Button asChild variant="outline" size="sm">
            <Link href={reviewHref}>Open the review</Link>
          </Button>
          {reload}
        </>
      ) : (
        reload
      );
    } else if (error.reason === "other_tab") {
      action = reload;
    } else if (error.reason !== "storage") {
      action = (
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          <RefreshCwIcon aria-hidden />
          Try again
        </Button>
      );
    }
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
