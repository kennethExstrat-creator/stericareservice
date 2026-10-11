"use client";

// The capture screen (BUILD_SPEC 8 and 10): an inspection's sections in
// pages, as tabs with progress and a result chip each, the open page's
// forms, the issues panel, autosave and submit. A page is one section, or a
// module with the modules shown on its page (lib/inspections/capture
// sections.ts SHOWN_WITH: packing configuration right below the order, whose
// total gloves it works out), each in a frame of its own with its own result,
// comment and photos. Tabs, the sidebar, the progress steps and Previous and
// Next go by page; ?module=, issue links and the switches name a section,
// and open its page with that section's title in view.
//
// Layout: below 1280 px (the iPad) a section tab bar sticks under the shell's
// top bar with the save pill, and the form runs full width; from 1280 px a
// sidebar lists the pages with their progress and results, the save pill,
// Issues and Submit, and the forms sit beside it.
//
// Data flow: the page renders the server's copy; autosave settles it against
// this device's local copy (a newer local copy is restored). Every edit
// replaces the module's data in one immutable `InspectionData`, goes to the
// local copy and the server (use-capture-autosave.ts), and the whole
// inspection is evaluated again with the framework (results, live totals,
// issues), a frame behind typing at most (useDeferredValue). Saves also
// bring back the inspection's status and module overrides, so a section
// switched off or a submit made on another device shows here too; the open
// page keeps the frames it still shows as they are, mid-typing included,
// when packing configuration leaves or joins it that way (ActivePage). What a
// number field refuses ("2 42") is kept beside the data, never in it, by
// section and path, on this device too (use-refused-entries.ts): it comes
// back with its field after a size or section switch or a reload, and the
// Pending panel names it first in its section's row.
//
// Offline: every section's form is downloaded soon after the screen opens
// (preloadCaptures), so a section first opened without a connection still
// shows it; one that did not arrive says so calmly and opens once the
// connection is back (section-error-boundary.tsx).
//
// Pending (the to-do list) shows only where the inspection can be changed
// here: read-only, the review lists every check.
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
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon, FileSearchIcon, ImagesIcon, ListChecksIcon } from "lucide-react";
import { toast } from "sonner";
import { useInspectionFiles } from "@/components/capture/files";
import { photoUploadsSettled, useUploadsWaiting } from "@/components/capture/photos";
import {
  ProgressTracker,
  RefusedEntryStoreContext,
  revealOnlyPath,
  useMediaQuery,
  WIDE_QUERY,
  type RefusedEntryStore,
} from "@/components/qc";
import { useLeaveGuard } from "@/components/shell/use-leave-guard";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { isEditableStatus, type CaptureAccess, type UserRole } from "@/lib/inspections/capture/access";
import { INSPECTIONS_PATH } from "@/lib/inspections/search-params";
import type { DefectUsage } from "@/lib/inspections/capture/defect-usage";
import { evaluateCapture, type CaptureMeta } from "@/lib/inspections/capture/evaluate";
import { mappedFieldValues } from "@/lib/inspections/capture/fields";
import {
  countIssues,
  describePending,
  groupIssues,
  issueTarget,
  pendingCounts,
  pendingTasks,
  unseenIssues,
} from "@/lib/inspections/capture/issues";
import { canBeSwitchedOff } from "@/lib/inspections/capture/overrides";
import { refusedTaskIssues } from "@/lib/inspections/capture/refused";
import type { ReopenNote } from "@/lib/inspections/capture/reopen";
import {
  capturePages,
  captureSections,
  findPage,
  initialSectionKey,
  isIncludedPage,
  neighbours,
  pageSectionKeys,
  progressSteps,
  type CapturePage,
  type CaptureSection,
} from "@/lib/inspections/capture/sections";
import { suggestionReasons } from "@/lib/inspections/capture/suggestion";
import type { StartResult } from "@/lib/offline";
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
import { MODULE_REGISTRY } from "@/modules";
import { applyProposals, SOURCE_DOCUMENTS_KEY, SOURCE_DOCUMENTS_TITLE } from "@/lib/inspections/source-documents";
import type { CaptureServerState } from "../actions";
import { CaptureHeader, type CaptureHeading } from "./capture-header";
import { captureNotices, CaptureNotices } from "./capture-notices";
import { ConflictDialog } from "./conflict-dialog";
import { IssuesSheet } from "./issues-sheet";
import { leaveAnswer } from "./leave-answer";
import { SwitchedOffPanel, SwitchOffDialog } from "./module-switch";
import { SaveIndicator } from "./save-indicator";
import { CustomBody, ModuleBody, preloadCaptures } from "./section-body";
import { PagePanel, SectionComment, SectionFrame } from "./section-frame";
import { SourceDocumentsPage } from "./source-documents-page";
import { useSourceDocuments } from "./use-source-documents";
import { SectionList } from "./section-list";
import { SectionTabs, tabId } from "./section-tabs";
import { SubmitControl, type SubmitBlocked, type SubmitPreparation } from "./submit-control";
import { LEAVE_FLUSH_MS, useCaptureAutosave } from "./use-capture-autosave";
import { inspectorHasActed, landingExpected, STILL_LOADING, useLandingSpot } from "./use-landing-spot";
import { useNoPullToRefresh } from "./use-no-pull-to-refresh";
import { useRefusedEntries } from "./use-refused-entries";
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
  useStickyOffsets(rootRef, barRef, panelId);

  // The section titles on screen, by section key: Previous, Next, issue links and the switches focus them.
  const titles = useRef(new Map<string, HTMLHeadingElement>());
  const titleRefs = useRef(new Map<string, (title: HTMLHeadingElement | null) => void>());
  /** One callback ref per section, the same on every render. */
  const titleRef = useCallback((key: string) => {
    let ref = titleRefs.current.get(key);
    if (!ref) {
      ref = (title) => {
        if (title) titles.current.set(key, title);
        else titles.current.delete(key);
      };
      titleRefs.current.set(key, ref);
    }
    return ref;
  }, []);
  const titleFor = useCallback((key: string) => titles.current.get(key) ?? null, []);

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

  // What number fields refused ("2 42" is not stored), kept by section and
  // path beside the data, so the red cell and its link come back after a
  // size or section switch or a reload (use-refused-entries.ts). Kept only
  // where this screen saves the inspection.
  const refusedEntries = useRefusedEntries({
    inspectionId,
    userId: user.id,
    active: access.editable && autosave.phase === "running",
  });
  const { settle: settleRefused, storeFor: refusedStoreFor, clear: clearRefused } = refusedEntries;
  // A number landing where one was refused (typed, pasted, another device's, a conflict's choice) lets it go.
  useEffect(() => {
    settleRefused(data);
  }, [data, refusedEntries.entries, settleRefused]);

  // Every section's form, downloaded while there is a connection, so a
  // section first opened offline still shows it (section-body.tsx); those a
  // dropped connection stopped are fetched once it is back.
  useEffect(() => {
    const keys = template.modules.filter((entry) => entry.include).map((entry) => entry.key);
    const preload = () => preloadCaptures(keys);
    let idle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(preload, { timeout: 2_000 });
    else timer = setTimeout(preload, 500);
    window.addEventListener("online", preload);
    return () => {
      if (idle !== undefined) window.cancelIdleCallback(idle);
      clearTimeout(timer);
      window.removeEventListener("online", preload);
    };
  }, [template]);

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
  // Source Documents, the first page: each file the AI reads fills empty fields through the same autosave as typing.
  const sourceDocuments = useSourceDocuments({
    inspectionId,
    canRead: !readOnly,
    onProposals: (proposals) => {
      const included = new Set(evaluation.template.modules.filter((entry) => entry.include).map((entry) => entry.key));
      const result = applyProposals(dataRef.current, proposals, MODULE_REGISTRY, included);
      if (result.filled > 0) commit(result.data);
      return result.filled;
    },
  });
  // What a tab, a sidebar row, a progress step and Previous or Next open: Source Documents first, then a section,
  // or a module with those shown on its page.
  const pages = useMemo(
    (): CapturePage[] => [
      {
        kind: "documents",
        key: SOURCE_DOCUMENTS_KEY,
        title: SOURCE_DOCUMENTS_TITLE,
        status: sourceDocuments.status,
        progress: sourceDocuments.progress,
      },
      ...capturePages(sections),
    ],
    [sections, sourceDocuments.status, sourceDocuments.progress],
  );

  // The section asked for (?module=, an issue link, a switch) or the page chosen: the screen shows the page it is on.
  // Without one, Source Documents, the first step.
  const [activeKey, setActiveKey] = useState(() =>
    initialSection === null || initialSection === SOURCE_DOCUMENTS_KEY ? SOURCE_DOCUMENTS_KEY : initialSectionKey(sections, initialSection),
  );
  const activePage: CapturePage | undefined = findPage(pages, activeKey) ?? pages.find(isIncludedPage) ?? pages[0];
  const activeSectionKeys = activePage ? pageSectionKeys(activePage) : [];
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  // Reloaded in place (a pull to refresh on the iPad): the last field that
  // stored a value comes back into view (use-landing-spot.ts), its size, hand
  // or box revealed by its module without focusing anything. A swipe down at
  // the top is less likely to reload the page in the first place.
  const landing = useLandingSpot({
    inspectionId,
    userId: user.id,
    panelId,
    sectionKeys: activeSectionKeys,
    ready: autosave.phase !== "starting",
    reveal: (sectionKey, path) => setFocusRequest({ sectionKey, path: revealOnlyPath(path) }),
  });
  useNoPullToRefresh();

  // The size a module last reported in focus, in whichever section: the next
  // module opens on it (CaptureProps.focus), so the size chosen in one stays
  // chosen in the next. It never tags a photo: a section's photos take only
  // what its own module reported (SectionPart).
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
   * Leaves the field being edited on the open page, so a half-typed value
   * is stored for the section it was typed in before that section goes
   * (number fields commit on blur; a tap on the iPad does not move focus).
   */
  const leaveActiveField = useCallback(() => {
    const field = document.activeElement;
    if (field instanceof HTMLElement && document.getElementById(panelId)?.contains(field)) field.blur();
  }, [panelId]);

  // The same for every click outside the open page, before the click does
  // its work: a link that leaves the screen (the shell's menu too), Submit,
  // Issues. Inside the page a click is the forms' own business, unless it
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

  /** Opens a page by its key; the screen scrolls back up to its first title when that is out of view. */
  const selectSection = useCallback(
    (key: string, { focusHeading = false }: { focusHeading?: boolean } = {}) => {
      leaveActiveField();
      setActiveKey(key);
      setFocusRequest(null);
      syncUrl(key);
      requestAnimationFrame(() => {
        // A page's key is its first section's.
        const title = titleFor(key);
        if (!title) return;
        if (title.getBoundingClientRect().top < stickyTopOf(rootRef.current)) scrollToTitle(title, rootRef.current);
        if (focusHeading) title.focus({ preventScroll: true });
      });
    },
    [leaveActiveField, syncUrl, titleFor],
  );

  /* -------------------------------------------------------------- *
   * Issues and submit
   * -------------------------------------------------------------- */

  const counts = useMemo(() => countIssues(report.issues), [report.issues]);
  // Refused entries join their section's row in the Pending panel, first, linked to their field.
  const refusedTasks = useMemo(
    () => refusedTaskIssues(refusedEntries.entries, sections, context.sizes),
    [refusedEntries.entries, sections, context.sizes],
  );
  const groups = useMemo(
    () => groupIssues([...report.issues, ...refusedTasks], sections),
    [report.issues, refusedTasks, sections],
  );
  // The Pending panel's rows, one per section, and their counts: the button, the panel and submit count the same.
  const tasks = useMemo(() => pendingTasks(groups, sections, report.modules), [groups, sections, report.modules]);
  // The submit confirmation's suggestion: the result, and why in the Conclusion section's words (none for a clean pass).
  const suggested = useMemo(
    () => ({
      result: report.suggested.result,
      reasons: suggestionReasons(report.suggested, (key) => sections.find((section) => section.key === key)?.title ?? key),
    }),
    [report.suggested, sections],
  );
  const pending = useMemo(() => pendingCounts(tasks), [tasks]);
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

  // When the inspector last pressed or typed anything. An issue link's
  // fallback below never takes focus from what they did after the link, such
  // as a box list opened on the cell it found (a portal outside the panel,
  // which would close).
  const lastInputAt = useRef(0);
  useEffect(() => {
    const note = () => {
      lastInputAt.current = performance.now();
    };
    window.addEventListener("pointerdown", note, true);
    window.addEventListener("keydown", note, true);
    return () => {
      window.removeEventListener("pointerdown", note, true);
      window.removeEventListener("keydown", note, true);
    };
  }, []);

  const goToIssue = useCallback(
    (issue: ValidationIssue) => {
      const linkedAt = performance.now();
      const actedSince = () => lastInputAt.current > linkedAt;
      setIssuesOpen(false);
      closeBlocked();
      // The section's page opens (the order's, for packing configuration): the URL names the section.
      const { pageKey, sectionKey, path } = issueTarget(issue, pages);
      const target = findPage(pages, pageKey);
      const shared = target !== undefined && pageSectionKeys(target).length > 1;
      setActiveKey(sectionKey);
      syncUrl(sectionKey);
      setFocusRequest(null);
      const land = () => {
        const title = titleFor(sectionKey);
        if (path.length === 0) {
          if (title) scrollToTitle(title, rootRef.current);
          title?.focus({ preventScroll: true });
          return;
        }
        // A new array for every click (docs/CAPTURE_KIT.md, "Issue links"):
        // useIssueFocus follows each one once, so the same link twice still works.
        setFocusRequest({ sectionKey, path: [...path] });
        // Nothing in the section took focus (a form without marks): its title
        // does, unless the inspector has pressed or typed since the link.
        window.setTimeout(() => {
          if (actedSince()) return;
          const frame = frameFor(panelId, sectionKey);
          const heading = titleFor(sectionKey);
          if (frame && heading && !frame.contains(document.activeElement)) {
            scrollToTitle(heading, rootRef.current);
            heading.focus({ preventScroll: true });
          }
        }, 700);
      };
      // After the panel has closed and the page is on screen. On a page of
      // several sections, once the forms above this one have arrived too
      // (their code loads on demand) and their photos have loaded: the order
      // table arriving, or its photos taking the place of "Loading photos…",
      // would move packing configuration again.
      requestAnimationFrame(() => {
        if (shared) whenPageSettled(panelId, land, { acted: actedSince });
        else land();
      });
    },
    [closeBlocked, pages, panelId, syncUrl, titleFor],
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

  // The button pressed goes with the change (Switch Off with the section's
  // header controls, Switch Back On with the panel): the switched section's
  // page opens and its title takes focus. Switched off, packing
  // configuration has a page of its own; back on, it is below the order
  // again, its title brought into view once the order table and its photos
  // have arrived.
  const focusTitleFor = useRef<{ overrides: ModuleOverrides; sectionKey: string } | null>(null);
  const onSwitched = useCallback(
    (next: ModuleOverrides, sectionKey: string) => {
      focusTitleFor.current = { overrides: next, sectionKey };
      setActiveKey(sectionKey);
      syncUrl(sectionKey);
      setOverrides(next);
    },
    [syncUrl],
  );
  useEffect(() => {
    const request = focusTitleFor.current;
    if (request === null || request.overrides !== overrides) return;
    focusTitleFor.current = null;
    const title = titleFor(request.sectionKey);
    title?.focus({ preventScroll: true });
    if (!title || !onSharedPage(panelId)) return;
    const since = performance.now();
    return whenPageSettled(panelId, () => revealTitle(titleFor(request.sectionKey), rootRef.current), {
      acted: () => lastInputAt.current > since,
    });
  }, [overrides, panelId, titleFor]);

  // Saved values that could not be read, removed: the section's form takes
  // the place of their list, and the button that opened the confirmation
  // went with it, so the title takes the focus rather than the page. A field
  // the form focused itself (an issue link it follows) keeps it.
  const focusTitleAfterRemoval = useCallback(
    (sectionKey: string) => {
      const title = titleFor(sectionKey);
      if (!title || frameFor(panelId, sectionKey)?.contains(document.activeElement)) return;
      if (title.getBoundingClientRect().top < stickyTopOf(rootRef.current)) scrollToTitle(title, rootRef.current);
      title.focus({ preventScroll: true });
    },
    [panelId, titleFor],
  );

  // Opened on a section below another on its page (?module=packing_config
  // from a link, a reload or the address bar): its title comes into view
  // once the page has settled, as a reload's landing waits for it: saving
  // has started (the fields turn editable and the photo buttons appear), the
  // forms above it have arrived and their photos have loaded. Each of those
  // moves it, and a browser without scroll anchoring would leave it out of
  // place. Not when a reload is to land on the last field instead
  // (use-landing-spot.ts), nor once the inspector has moved; a title already
  // in view, as a reload's restored scroll may leave it, stays where it is.
  const revealOpenedSection = useEffectEvent(() => {
    if (!activePage || activeKey === null || activeKey === activePage.key) return;
    if (inspectorHasActed() || landingExpected({ userId: user.id, inspectionId }, activeSectionKeys)) return;
    const since = performance.now();
    return whenPageSettled(panelId, () => revealTitle(titleFor(activeKey), rootRef.current), {
      acted: () => inspectorHasActed() || lastInputAt.current > since,
    });
  });
  // Once saving has started, or at once where it does not run (read-only).
  const saving = autosave.phase !== "starting";
  useEffect(() => {
    if (saving) return revealOpenedSection();
  }, [saving]);

  // Below 1280 px the open page is the tab bar's panel; from 1280 px a region (or regions) beside the sidebar.
  const wide = useMediaQuery(WIDE_QUERY);

  /* -------------------------------------------------------------- *
   * Notices
   * -------------------------------------------------------------- */

  const notices = useMemo(
    () =>
      captureNotices({
        access,
        role: user.role,
        inspectorName: heading.inspectorName,
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
      heading.inspectorName,
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
        // Sections with something submit needs, as the Pending panel counts them.
        errorCount={pending.needed}
        warningCount={counts.warnings}
        suggested={suggested}
        prepare={prepareSubmit}
        onBlocked={onBlocked}
        // Submitted: what was refused on the way is done with.
        onSubmitted={clearRefused}
        uploadsWaiting={uploadsWaiting}
        disabled={readOnly}
        className={className}
      />
    ) : null;
  // Pending is a to-do list for whoever can act on it: only where the inspection can be changed
  // here. Read-only (submitted, approved, a team member's), the review lists every check.
  const showPending = access.editable && !lockedElsewhere;
  const issuesButton = (className?: string) =>
    showPending ? <IssuesButton counts={pending} onClick={openIssues} className={className} /> : null;
  const { previous, next } = activePage ? neighbours(pages, activePage.key) : { previous: null, next: null };
  // The refused entries of each section on the open page, for its fields (null where this screen keeps none).
  const refusedOwners =
    activePage?.kind === "included" ? activePage.sections.map((section) => `${section.kind}:${section.key}`).join(" ") : "";
  const refusedStores = useMemo(() => {
    const stores = new Map<string, RefusedEntryStore | null>();
    for (const owner of refusedOwners.split(" ").filter(Boolean)) {
      const colon = owner.indexOf(":");
      const key = owner.slice(colon + 1);
      stores.set(key, refusedStoreFor(owner.slice(0, colon) === "module" ? "modules" : "custom", key));
    }
    return stores;
  }, [refusedOwners, refusedStoreFor]);

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
              {/* Read out as the status screen's own link words it: "Back to Inspections". */}
              Back<span className="sr-only"> to Inspections</span>
            </LeaveLink>
          </>
        }
      />

      <CaptureNotices notices={notices} />
      <p className="sr-only" aria-live="polite" data-slot="landing-announcement">
        {landing.announcement}
      </p>

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
              steps={progressSteps(pages)}
              activeKey={activePage?.key}
              label="Progress"
            />
            <SectionList pages={pages} activeKey={activePage?.key ?? ""} onSelect={(key) => selectSection(key)} />
            {(showPending || access.editable) && (
              <div className="flex flex-col gap-2 border-t border-border px-1 pt-3">
                {issuesButton("w-full justify-between")}
                {submitControl("w-full")}
              </div>
            )}
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
              pages={pages}
              activeKey={activePage?.key ?? ""}
              onSelect={(key) => selectSection(key)}
              panelId={panelId}
              idPrefix={idPrefix}
            />
            {saveStatus && <SaveIndicator status={saveStatus} inspectionId={inspectionId} className="shrink-0" />}
          </div>

          <ProgressTracker
            className="xl:hidden"
            steps={progressSteps(pages)}
            activeKey={activePage?.key}
            onStepSelect={(key) => selectSection(key)}
            label="Progress"
          />

          {activePage?.kind === "documents" ? (
            <SourceDocumentsPage
              key={activePage.key}
              panelId={panelId}
              tabLabelledBy={wide ? undefined : tabId(idPrefix, activePage.key)}
              titleRef={titleRef}
              inspectionId={inspectionId}
              readOnly={readOnly}
              documents={sourceDocuments}
            />
          ) : activePage && (
            <ActivePage
              key={activePage.key}
              page={activePage}
              panelId={panelId}
              titleRef={titleRef}
              tabLabelledBy={wide ? undefined : tabId(idPrefix, activePage.key)}
              template={template}
              effective={evaluation.template}
              overrides={overrides}
              overrideAuthors={overrideAuthors}
              userId={user.id}
              data={data}
              report={report}
              context={context}
              focusRequest={focusRequest}
              readOnly={readOnly}
              showRequired={submitTried}
              access={access}
              inspectionId={inspectionId}
              keptFocus={keptFocus}
              defectUsage={defectUsage}
              refusedStores={refusedStores}
              onFocusReported={keepSize}
              onUnreadableRemoved={focusTitleAfterRemoval}
              // Each change from the form also marks its field as where the inspector stopped.
              onModuleChange={(key, value) => {
                writeEntry("modules", key, value);
                landing.record();
              }}
              onCustomChange={(key, value) => {
                writeEntry("custom", key, value);
                landing.record();
              }}
              onMappedChange={(mapsTo, value) => {
                writeMapped(mapsTo, value);
                landing.record();
              }}
              onCommentChange={(namespace, key, comment) => {
                writeComment(namespace, key, comment);
                landing.record();
              }}
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
        tasks={tasks}
        counts={pending}
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
 * The open page
 * ------------------------------------------------------------------ */

/** What every section on the open page is handed by the screen. */
type SharedSectionProps = {
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
  readOnly: boolean;
  /** Submit was tried: empty required fields say so. */
  showRequired: boolean;
  access: CaptureAccess;
  inspectionId: string;
  /** The size kept from the sections before: the module opens on it (CaptureProps.focus). Never a photo tag. */
  keptFocus: CaptureFocus;
  defectUsage: DefectUsage;
  /** Every focus a section's module or form reports, so its size is kept for the next section. */
  onFocusReported: (focus: CaptureFocus) => void;
  onModuleChange: (key: string, value: unknown) => void;
  onCustomChange: (key: string, value: unknown) => void;
  onMappedChange: (mapsTo: string, value: unknown) => void;
  onCommentChange: (namespace: DataNamespace, key: string, comment: string) => void;
};

type ActivePageProps = SharedSectionProps & {
  page: Exclude<CapturePage, { kind: "documents" }>;
  panelId: string;
  /** The callback ref of each section's title, by section key: the screen focuses titles. */
  titleRef: (sectionKey: string) => Ref<HTMLHeadingElement>;
  /** Below 1280 px: the id of the page's tab, which names the panel (WAI-ARIA tabs). */
  tabLabelledBy?: string;
  /** A data path to focus, or only to reveal, in one section of the page: an issue link, a landing. */
  focusRequest: FocusRequest | null;
  /** Where each section's number fields keep what they refused, by section key; null to keep their own. */
  refusedStores: ReadonlyMap<string, RefusedEntryStore | null>;
  /** Saved values a section could not read were removed, and the button that did it went with their list. */
  onUnreadableRemoved: (sectionKey: string) => void;
  /** A section was switched off or back on here. */
  onOverridesChange: (overrides: ModuleOverrides, sectionKey: string) => void;
};

/**
 * The open page: its sections' frames in turn, packing configuration below
 * the order, in a PagePanel. A page of one section, a switched-off one
 * included, is that section's frame, the panel itself. The screen keys it by
 * the page; within it each frame is keyed by its section, and the PagePanel
 * is the same element for one section or several. So a page that gains or
 * loses a section while it is open (packing configuration switched on or
 * off on another device, which the next save brings back) keeps the frames
 * it still shows: the field being typed in keeps its focus and its
 * half-typed value, and the form what it holds. A section switched off
 * where it is open keeps its frame too, as its switched-off panel.
 */
function ActivePage({
  page,
  panelId,
  titleRef,
  tabLabelledBy,
  focusRequest,
  refusedStores,
  onUnreadableRemoved,
  onOverridesChange,
  ...shared
}: ActivePageProps) {
  const sections: readonly CaptureSection[] = page.kind === "included" ? page.sections : [page.section];
  const several = sections.length > 1;
  return (
    <PagePanel id={panelId} tabLabelledBy={tabLabelledBy} single={!several}>
      {sections.map((section) => (
        <SectionPart
          key={section.key}
          {...shared}
          section={section}
          // A page of one section is that section's frame; on a page of several, each frame has an id of its own.
          frameId={several ? `${panelId}-${section.key}` : panelId}
          tabLabelledBy={several ? undefined : tabLabelledBy}
          // On a page of several, each section's comment, photos, Switch Off and its form's own buttons are read out with its title.
          nameContext={several ? section.title : undefined}
          headingRef={titleRef(section.key)}
          focusPath={focusRequest?.sectionKey === section.key ? focusRequest.path : null}
          refusedEntries={refusedStores.get(section.key) ?? null}
          onUnreadableRemoved={() => onUnreadableRemoved(section.key)}
          onOverridesChange={(next) => onOverridesChange(next, section.key)}
        />
      ))}
    </PagePanel>
  );
}

type SectionPartProps = SharedSectionProps & {
  section: CaptureSection;
  /** The frame's id: the panel's on a page of one section. */
  frameId: string;
  /** Below 1280 px, on a page of one section: the id of its tab, which names the frame (WAI-ARIA tabs). */
  tabLabelledBy?: string;
  /**
   * On a page of several sections, this one's title: read out with its
   * comment, photos and Switch Off, and with Try Again or Clear This Section
   * where its form is in trouble.
   */
  nameContext?: string;
  headingRef: Ref<HTMLHeadingElement>;
  focusPath: IssuePath | null;
  /** Where the section's number fields keep what they refused, so it outlives them; null to keep their own. */
  refusedEntries: RefusedEntryStore | null;
  /** Saved values that could not be read were removed, and the button that did it went with their list. */
  onUnreadableRemoved: () => void;
  onOverridesChange: (overrides: ModuleOverrides) => void;
};

/**
 * One section on the open page: its frame with its result, its form, its
 * comment and its photos; switched off, its frame with the switched-off
 * panel.
 */
function SectionPart({
  section,
  frameId,
  tabLabelledBy,
  nameContext,
  headingRef,
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
  refusedEntries,
  onFocusReported,
  onUnreadableRemoved,
  onModuleChange,
  onCustomChange,
  onMappedChange,
  onCommentChange,
  onOverridesChange,
}: SectionPartProps) {
  // What the module reports in focus: the screen keeps the size for the next section.
  // (Photos are added on Source Documents' Media tab, untagged, since 11 October 2026.)
  const onFocusChange = useCallback((focus: CaptureFocus) => onFocusReported(focus), [onFocusReported]);

  if (section.kind === "excluded") {
    return (
      <SectionFrame
        id={frameId}
        sectionKey={section.key}
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
        context={nameContext}
      />
    </>
  );

  if (section.kind === "custom") {
    const evaluation = report.custom.find((candidate) => candidate.custom.key === section.key);
    return (
      <SectionFrame
        id={frameId}
        sectionKey={section.key}
        tabLabelledBy={tabLabelledBy}
        title={section.title}
        headingRef={headingRef}
        status={section.status}
        footer={footer}
      >
        {evaluation && (
          <RefusedEntryStoreContext.Provider value={refusedEntries}>
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
          </RefusedEntryStoreContext.Provider>
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
      id={frameId}
      sectionKey={section.key}
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
            nameContext={nameContext}
            onChanged={onOverridesChange}
          />
        ) : undefined
      }
      footer={footer}
    >
      {resolved && (
        <RefusedEntryStoreContext.Provider value={refusedEntries}>
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
            nameContext={nameContext}
          />
        </RefusedEntryStoreContext.Provider>
      )}
    </SectionFrame>
  );
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

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

/** A section title brought into view below the sticky bars, unless it is in view already (a reload's restored scroll). */
function revealTitle(title: HTMLElement | null, root: HTMLElement | null) {
  if (!title) return;
  const box = title.getBoundingClientRect();
  if (box.top < stickyTopOf(root) || box.bottom > window.innerHeight) scrollToTitle(title, root);
}

/** The open page holds the frames of several sections (PagePanel). */
function onSharedPage(panelId: string): boolean {
  return document.getElementById(panelId)?.dataset.slot === "capture-page";
}

/** A section's frame on the open page: the panel itself on a page of one section; null when it is not on the page. */
function frameFor(panelId: string, sectionKey: string): HTMLElement | null {
  const panel = document.getElementById(panelId);
  if (!panel || panel.dataset.sectionKey === sectionKey) return panel;
  for (const frame of panel.querySelectorAll<HTMLElement>("[data-section-key]")) {
    if (frame.dataset.sectionKey === sectionKey) return frame;
  }
  return null;
}

/** How long the forms and photos on a page may take to arrive before a title below them is brought into view anyway. */
const SETTLE_WAIT_MS = 3_000;
const SETTLE_CHECK_MS = 50;

/**
 * Runs `then` once every form on the open page has arrived and every
 * section's photos have loaded (STILL_LOADING: a module's form loads on
 * demand, and the order table arriving pushes packing configuration down;
 * the order's photos taking the place of "Loading photos…" move it too), or
 * after `limitMs` whatever is still loading. Stands down once `acted` says
 * the inspector pressed or typed meanwhile. Returns what stops the wait.
 */
function whenPageSettled(
  panelId: string,
  then: () => void,
  { acted, limitMs = SETTLE_WAIT_MS }: { acted: () => boolean; limitMs?: number },
): () => void {
  const deadline = performance.now() + limitMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    if (acted()) return;
    const loading = document.getElementById(panelId)?.querySelector(STILL_LOADING);
    if (loading && performance.now() < deadline) timer = setTimeout(check, SETTLE_CHECK_MS);
    else then();
  };
  check();
  return () => clearTimeout(timer);
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
  counts,
  onClick,
  className,
}: {
  /** Sections with open items, and those with something submit needs (pendingCounts). */
  counts: { total: number; needed: number };
  onClick: () => void;
  className?: string;
}) {
  // Calm on purpose (Kenneth: red and amber counts felt alarming): "Pending" with a blue dot
  // while anything is open; the counts and what blocks submit are read out, and shown in the sheet.
  const open = counts.total;
  return (
    <Button type="button" variant="outline" onClick={onClick} className={className} data-action="issues" aria-haspopup="dialog">
      <span className="inline-flex items-center gap-1.5">
        <ListChecksIcon aria-hidden />
        Pending
      </span>
      {open > 0 && (
        <>
          <span aria-hidden data-slot="pending-dot" className="size-2.5 shrink-0 rounded-full bg-primary" />
          <span className="sr-only">{`: ${describePending(counts, ", ")}`}</span>
        </>
      )}
    </Button>
  );
}
