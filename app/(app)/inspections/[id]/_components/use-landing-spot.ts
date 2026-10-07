"use client";

// Lands the inspector where they stopped after the page loads again in place
// (landing-spot.ts): the last field that stored a value is brought into view
// (scrolled to the middle unless it is already in view), ringed for a moment
// and announced ("Back where you stopped: Glove colour"). It is not focused:
// on a touchscreen the keyboard would come up, and a number field selects
// its value on focus, so the next key would replace what was just completed.
//
// Which field: the one last focused or pressed in the open section, noted at
// the press (Safari on the iPad does not focus a tapped button), and stored
// once the section hands a change back (record). The size tabs, the photo
// slot and links are not fields. After the reload the section's fields are
// matched by issue path and label (a field's id is not the same from one
// load to the next). One the module does not show (another size, hand or
// box) is revealed through the module's own reveal, as an issue link does,
// without focusing it (revealOnlyPath). The autosave settles the local copy
// first.
//
// The page never moves under the inspector: a press, key, wheel or touch
// from the moment this code loads (and, where the browser records it, a
// press made before) cancels the landing, and so does a dialog that is open
// when it would land.
import { useCallback, useEffect, useEffectEvent, useRef } from "react";
import { ISSUE_PATH_ATTRIBUTE } from "@/components/qc/issue-path";
import { useAnnouncement } from "@/components/qc/use-announcement";
import type { IssuePath } from "@/lib/validation";
import {
  isReturnLoad,
  matchLandingField,
  nthOfSignature,
  parsePathKey,
  readLandingSpot,
  writeLandingSpot,
  type DocumentLoad,
  type FieldSignature,
  type LandingOwner,
  type LandingSpot,
} from "./landing-spot";

/** Set on the field landed on while its ring shows. */
export const LANDED_ATTRIBUTE = "data-landed";

/** How long the form may take to arrive (its code loads on demand), checked this often. */
const LANDING_WAIT_MS = 8_000;
const LANDING_RETRY_MS = 100;
const RING_MS = 2_400;

/** What a field is made of. */
const CONTROL =
  'input:not([type="hidden"]), textarea, select, button, [role="combobox"], [role="spinbutton"], [role="slider"], [contenteditable="true"]';
/** Pressed inside these, it is not a field: size and section tabs, the photo slot, links. */
const NOT_A_FIELD = '[role="tab"], [role="tablist"], [data-slot="size-tabs-bar"], [data-slot="module-photos"], a[href]';
/** Toggles that hold one value together (a Yes / No, a choice of a few): the field is their group. */
const TOGGLE = '[role="radio"], [aria-pressed]';
const TOGGLE_GROUP = '[role="radiogroup"], [role="toolbar"], [role="group"]';

// One landing per document load: a screen opened again inside the app starts at its section's top.
let loadHandled = false;

// The inspector pressed, typed, scrolled or touched since this code loaded:
// no landing moves the page after that. Watched from the moment the module
// loads, before the screen has hydrated or its autosave has started.
let inspectorActed = false;
const INPUT_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
if (typeof window !== "undefined") {
  const acted = () => {
    inspectorActed = true;
    for (const type of INPUT_EVENTS) window.removeEventListener(type, acted, true);
  };
  for (const type of INPUT_EVENTS) window.addEventListener(type, acted, { capture: true, passive: true });
}

/** A press or key the browser saw before this code loaded (Event Timing's first input; Chromium only). */
function actedBeforeLoad(): boolean {
  try {
    return (performance.getEntriesByType?.("first-input") ?? []).length > 0;
  } catch {
    return false;
  }
}

function inspectorHasActed(): boolean {
  return inspectorActed || actedBeforeLoad();
}

/** A dialog is open (the conflict question, the Pending panel): landing behind it would surprise. */
function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') !== null;
}

export function useLandingSpot({
  inspectionId,
  userId,
  panelId,
  sectionKey,
  ready,
  reveal,
}: {
  inspectionId: string;
  /** The signed-in user: spots are kept per user, like the local copies. */
  userId: string;
  /** The open section's element (SectionFrame's id). */
  panelId: string;
  /** The open section; null when there is none. */
  sectionKey: string | null;
  /** The autosave has settled the data to show (or does not run here). */
  ready: boolean;
  /** Has the open section's module show `path` (its size, hand or box) without focusing anything: revealOnlyPath. */
  reveal: (path: IssuePath) => void;
}): {
  record: () => void;
  /** For a polite live region: "Back where you stopped: <field>". */
  announcement: string;
} {
  // The field last focused or pressed, described as it was then.
  const noted = useRef<{ field: HTMLElement; spot: LandingSpot } | null>(null);
  const lastWritten = useRef<string | null>(null);
  const [announcement, announce] = useAnnouncement();
  const revealPath = useEffectEvent((path: IssuePath) => reveal(path));

  useEffect(() => {
    if (sectionKey === null) return;
    const note = (event: Event) => {
      const panel = document.getElementById(panelId);
      const field = panel ? fieldOf(event.target, panel) : null;
      if (!panel || !field || noted.current?.field === field) return;
      noted.current = { field, spot: describe(field, panel, sectionKey) };
    };
    document.addEventListener("focusin", note, true);
    document.addEventListener("pointerdown", note, true);
    return () => {
      document.removeEventListener("focusin", note, true);
      document.removeEventListener("pointerdown", note, true);
    };
  }, [panelId, sectionKey]);

  /** The open section stored a change: its field is where the inspector stopped. */
  const record = useCallback(() => {
    const current = noted.current;
    if (!current || !current.field.isConnected) return;
    const text = JSON.stringify(current.spot);
    if (text === lastWritten.current) return;
    if (writeLandingSpot(sessionStorageOrNull(), { userId, inspectionId }, current.spot)) lastWritten.current = text;
  }, [inspectionId, userId]);

  useEffect(() => {
    if (!ready || loadHandled || sectionKey === null) return;
    const owner: LandingOwner = { userId, inspectionId };
    const spot = isReturnLoad(documentLoad(), window.location.pathname)
      ? readLandingSpot(sessionStorageOrNull(), owner)
      : null;
    // Opened afresh, the inspector already moving, or stopped in another section and then opened this one.
    if (!spot || spot.section !== sectionKey || inspectorHasActed()) {
      loadHandled = true;
      return;
    }

    const deadline = performance.now() + LANDING_WAIT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tried = false;
    let revealed = false;
    const finish = () => {
      loadHandled = true;
      clearTimeout(timer);
    };

    const attempt = () => {
      tried = true;
      if (inspectorHasActed() || dialogOpen()) {
        finish();
        return;
      }
      const panel = document.getElementById(panelId);
      if (panel) {
        const fields = fieldsIn(panel);
        const index = matchLandingField(
          fields.map((field) => signatureOf(field, panel)),
          spot,
        );
        if (index >= 0) {
          finish();
          const field = fields[index];
          land(field);
          const name = accessibleName(field) ?? spot.name;
          announce(name ? `Back where you stopped: ${name}` : "Back where you stopped.");
          return;
        }
        // Not shown: under another size, hand or box. The module turns to it once, then look again.
        const path = revealed ? null : parsePathKey(spot.path);
        if (path) {
          revealed = true;
          revealPath(path);
        }
      }
      if (performance.now() >= deadline) finish();
      else timer = setTimeout(attempt, LANDING_RETRY_MS);
    };
    timer = setTimeout(attempt, 0);

    return () => {
      clearTimeout(timer);
      // React's development double run comes before any attempt; a screen gone after one is done with this load.
      if (tried) loadHandled = true;
    };
  }, [ready, inspectionId, userId, panelId, sectionKey, announce]);

  return { record, announcement };
}

/* ------------------------------------------------------------------ *
 * Fields in the DOM
 * ------------------------------------------------------------------ */

/** The field an event in the open section belongs to; null outside fields. */
function fieldOf(target: EventTarget | null, panel: HTMLElement): HTMLElement | null {
  if (!(target instanceof Element) || !panel.contains(target)) return null;
  const excluded = target.closest(NOT_A_FIELD);
  if (excluded && panel.contains(excluded)) return null;
  const control = target.closest<HTMLElement>(CONTROL);
  if (!control || !panel.contains(control)) return null;
  if (control.matches(TOGGLE)) {
    const group = control.closest<HTMLElement>(TOGGLE_GROUP);
    if (group && panel.contains(group)) return group;
  }
  return control;
}

/** The section's fields on screen, in reading order. */
function fieldsIn(panel: HTMLElement): HTMLElement[] {
  const fields: HTMLElement[] = [];
  for (const control of panel.querySelectorAll<HTMLElement>(CONTROL)) {
    const field = fieldOf(control, panel);
    if (field && field.getClientRects().length > 0 && !fields.includes(field)) fields.push(field);
  }
  return fields;
}

function describe(field: HTMLElement, panel: HTMLElement, section: string): LandingSpot {
  const fields = fieldsIn(panel);
  const signatures = fields.map((each) => signatureOf(each, panel));
  const index = fields.indexOf(field);
  const own = index >= 0 ? signatures[index] : signatureOf(field, panel);
  return {
    v: 1,
    section,
    ...own,
    nth: index >= 0 ? nthOfSignature(signatures, index) : 0,
  };
}

function signatureOf(field: HTMLElement, panel: HTMLElement): FieldSignature {
  const marked = field.closest(`[${ISSUE_PATH_ATTRIBUTE}]`);
  return {
    path: marked && panel.contains(marked) ? marked.getAttribute(ISSUE_PATH_ATTRIBUTE) : null,
    name: accessibleName(field),
  };
}

/** The field's label, as a screen reader would name it (the common cases). */
function accessibleName(element: HTMLElement): string | null {
  const ids = element.getAttribute("aria-labelledby");
  if (ids) {
    const named = clean(ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" "));
    if (named) return named;
  }
  const label = clean(element.getAttribute("aria-label"));
  if (label) return label;
  const labels = "labels" in element ? (element as HTMLInputElement).labels : null;
  if (labels && labels.length > 0) {
    const named = clean(Array.from(labels, (each) => each.textContent ?? "").join(" "));
    if (named) return named;
  }
  if (element instanceof HTMLButtonElement) return clean(element.textContent);
  return clean(element.getAttribute("placeholder"));
}

function clean(text: string | null | undefined): string | null {
  const trimmed = text?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}

/** To the middle of the screen, unless it is in view already below the sticky bars; then the ring. */
function land(field: HTMLElement) {
  if (!inView(field)) field.scrollIntoView({ block: "center", inline: "nearest" });
  ring(field);
}

function inView(field: HTMLElement): boolean {
  const screen = document.querySelector<HTMLElement>('[data-slot="capture-screen"]');
  const offset = (name: string) => Number.parseFloat(screen?.style.getPropertyValue(name) ?? "") || 0;
  const box = field.getBoundingClientRect();
  return box.top >= offset("--capture-sticky-top") && box.bottom <= window.innerHeight - offset("--capture-sticky-bottom");
}

/**
 * A brand-500 ring 2 px clear of the field, like the focus ring, added to the
 * field's own shadow; it fades out, or with reduced motion stays still and
 * then goes.
 */
function ring(field: HTMLElement) {
  field.setAttribute(LANDED_ATTRIBUTE, "");
  const clear = () => field.removeAttribute(LANDED_ATTRIBUTE);
  if (typeof field.animate !== "function") {
    setTimeout(clear, RING_MS);
    return;
  }
  const style = getComputedStyle(field);
  const brand = style.getPropertyValue("--color-brand-500").trim() || "#0074d6";
  const gap = style.getPropertyValue("--color-card").trim() || "#ffffff";
  const halo = (color: string, offset: number): Keyframe => ({ boxShadow: `0 0 0 2px ${gap}, 0 0 0 4px ${color}`, offset });
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const frames = still ? [halo(brand, 0), halo(brand, 1)] : [halo(brand, 0), halo(brand, 0.5), halo("transparent", 1)];
  field
    .animate(frames, { duration: RING_MS, easing: still ? "linear" : "ease-out", composite: "add" })
    .finished.then(clear, clear);
}

/* ------------------------------------------------------------------ *
 * The browser
 * ------------------------------------------------------------------ */

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function documentLoad(): DocumentLoad {
  const [entry] = performance.getEntriesByType?.("navigation") ?? [];
  const navigation = entry as PerformanceNavigationTiming | undefined;
  return {
    type: navigation?.type ?? null,
    url: navigation?.name ?? null,
    wasDiscarded: (document as Document & { wasDiscarded?: boolean }).wasDiscarded,
  };
}
