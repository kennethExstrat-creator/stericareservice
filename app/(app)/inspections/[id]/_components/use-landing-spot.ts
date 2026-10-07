"use client";

// Lands the inspector where they stopped after the page loads again in place
// (landing-spot.ts): the last field that stored a value is scrolled to the
// middle of the screen and ringed for a moment. It is not focused: on a
// touchscreen the keyboard would come up, and a number field selects its
// value on focus, so the next key would replace what was just completed.
//
// Which field: the one last focused or pressed in the open section, noted at
// the press (Safari on the iPad does not focus a tapped button), and stored
// once the section hands a change back (record). The size tabs, the photo
// slot and links are not fields. After the reload the section's fields are
// matched by issue path and label (a field's id is not the same from one
// load to the next), and a per-size module is turned to the size first. The
// autosave settles the local copy before that, and a press, key or scroll
// by the inspector cancels it: the page never moves under their finger.
import { useCallback, useEffect, useRef } from "react";
import { ISSUE_PATH_ATTRIBUTE } from "@/components/qc/issue-path";
import {
  isReturnLoad,
  matchLandingField,
  nthOfSignature,
  readLandingSpot,
  writeLandingSpot,
  type DocumentLoad,
  type FieldSignature,
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

export function useLandingSpot({
  inspectionId,
  panelId,
  sectionKey,
  ready,
}: {
  inspectionId: string;
  /** The open section's element (SectionFrame's id). */
  panelId: string;
  /** The open section; null when there is none. */
  sectionKey: string | null;
  /** The autosave has settled the data to show (or does not run here). */
  ready: boolean;
}): { record: () => void } {
  // The field last focused or pressed, described as it was then.
  const noted = useRef<{ field: HTMLElement; spot: LandingSpot } | null>(null);
  const lastWritten = useRef<string | null>(null);

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
    if (writeLandingSpot(sessionStorageOrNull(), inspectionId, current.spot)) lastWritten.current = text;
  }, [inspectionId]);

  useEffect(() => {
    if (!ready || loadHandled || sectionKey === null) return;
    if (!isReturnLoad(documentLoad(), window.location.pathname)) {
      loadHandled = true;
      return;
    }
    const spot = readLandingSpot(sessionStorageOrNull(), inspectionId);
    // Stopped in another section, then opened this one: its top is where they are.
    if (!spot || spot.section !== sectionKey) {
      loadHandled = true;
      return;
    }

    const deadline = performance.now() + LANDING_WAIT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tried = false;
    let turnedSize = false;
    const userEvents = ["pointerdown", "keydown", "wheel", "touchmove"] as const;
    const finish = () => {
      loadHandled = true;
      clearTimeout(timer);
      for (const type of userEvents) window.removeEventListener(type, finish, true);
    };
    for (const type of userEvents) window.addEventListener(type, finish, { capture: true, passive: true });

    const attempt = () => {
      tried = true;
      const panel = document.getElementById(panelId);
      if (panel) {
        const fields = fieldsIn(panel);
        const index = matchLandingField(
          fields.map((field) => signatureOf(field, panel)),
          spot,
        );
        if (index >= 0) {
          finish();
          land(fields[index]);
          return;
        }
        // Under another size: turn to it once, as a tap on its tab would, then look again.
        const tab = spot.size === null || turnedSize ? null : sizeTab(panel, spot.size);
        if (tab) {
          turnedSize = true;
          if (tab.getAttribute("aria-selected") !== "true") tab.click();
        }
      }
      if (performance.now() >= deadline) finish();
      else timer = setTimeout(attempt, LANDING_RETRY_MS);
    };
    timer = setTimeout(attempt, 0);

    return () => {
      clearTimeout(timer);
      for (const type of userEvents) window.removeEventListener(type, finish, true);
      // React's development double run comes before any attempt; a screen gone after one is done with this load.
      if (tried) loadHandled = true;
    };
  }, [ready, inspectionId, panelId, sectionKey]);

  return { record };
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
    size: sizeOf(field, panel),
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

/** The size whose tab panel holds the field. */
function sizeOf(field: HTMLElement, panel: HTMLElement): string | null {
  let tabPanel = field.closest("[role='tabpanel']");
  while (tabPanel && tabPanel !== panel && panel.contains(tabPanel)) {
    const tabId = tabPanel.getAttribute("aria-labelledby");
    const size = tabId ? document.getElementById(tabId)?.getAttribute("data-size") : null;
    if (size) return size;
    tabPanel = tabPanel.parentElement?.closest("[role='tabpanel']") ?? null;
  }
  return null;
}

function sizeTab(panel: HTMLElement, size: string): HTMLElement | null {
  const tabs = panel.querySelectorAll<HTMLElement>(`[role="tab"][data-size="${CSS.escape(size)}"]`);
  return Array.from(tabs).find((tab) => tab.getClientRects().length > 0) ?? null;
}

function land(field: HTMLElement) {
  field.scrollIntoView({ block: "center", inline: "nearest" });
  ring(field);
}

/** A soft brand halo around the field that fades, added to the field's own shadow. */
function ring(field: HTMLElement) {
  field.setAttribute(LANDED_ATTRIBUTE, "");
  const clear = () => field.removeAttribute(LANDED_ATTRIBUTE);
  if (typeof field.animate !== "function") {
    setTimeout(clear, RING_MS);
    return;
  }
  const color = getComputedStyle(field).getPropertyValue("--color-brand-300").trim() || "#9bc5f6";
  const halo = (shade: string, offset?: number): Keyframe => ({ boxShadow: `0 0 0 4px ${shade}`, offset });
  field
    .animate([halo(color, 0), halo(color, 0.5), halo("transparent", 1)], {
      duration: RING_MS,
      easing: "ease-out",
      composite: "add",
    })
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
