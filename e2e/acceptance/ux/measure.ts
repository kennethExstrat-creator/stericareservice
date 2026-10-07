// In-page measurements for the UX audit. Each function runs inside the page
// (page.evaluate), so it is self-contained: no imports, no closures.

export type ElementInfo = {
  /** A short CSS-ish path: tag#id.class > ... (the last three steps). */
  path: string;
  tag: string;
  role: string | null;
  /** The accessible name as far as the DOM tells: aria-label, labelled-by text, label, text. */
  name: string;
  slot: string | null;
  testid: string | null;
  rect: { x: number; y: number; width: number; height: number };
};

export type LayoutReport = {
  viewport: { width: number; height: number };
  /** document scrollWidth minus the viewport width: above 0, the page scrolls sideways. */
  pageOverflowX: number;
  /** Elements past the right (or left) edge whose removal narrows the page: the cause of a sideways page. */
  overflowing: (ElementInfo & { right: number; srOnly: boolean; position: string })[];
  /** Horizontal scrollers whose content is wider than they are (allowed for the list table). */
  scrollers: (ElementInfo & { scrollWidth: number; clientWidth: number })[];
  /** Touch only: controls under 44 px whose hit area (sampled with elementFromPoint) is also under 44 px. */
  smallTargets: (ElementInfo & { hit: { left: boolean; right: boolean; up: boolean; down: boolean }; inline: boolean })[];
  /** Touch only: text fields under 16 px (iOS zooms in on focus). */
  smallFieldText: (ElementInfo & { fontSize: number })[];
  /** Text cut off: overflow hidden/clip with content wider than the box. ellipsis says whether it shows "…". */
  clipped: (ElementInfo & { scrollWidth: number; clientWidth: number; ellipsis: boolean; title: string | null })[];
  /** Text that runs out of its box with overflow visible. */
  spilling: (ElementInfo & { by: number })[];
  /** Text squeezed into a narrow column: three or more lines in a box under 120 px. */
  squeezed: (ElementInfo & { lines: number })[];
  /** Body text under 12 px (secondary text should be 14 px). */
  tinyText: (ElementInfo & { fontSize: number })[];
  /**
   * Text below WCAG AA against the first opaque background behind it (4.5:1,
   * 3:1 from 24 px or 18.66 px bold). Disabled controls are exempt and left out.
   */
  lowContrast: (ElementInfo & { ratio: number; color: string; background: string; fontSize: number })[];
  /** Interactive elements with no accessible name the DOM can show. */
  unnamed: ElementInfo[];
  /** Duplicate ids in the document. */
  duplicateIds: string[];
  /** Headings in order: level and text. */
  headings: { level: number; text: string }[];
};

/** Runs in the page: the layout, target, text and naming checks. */
export function measureLayout(options: { touch: boolean }): LayoutReport {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;

  const shortClass = (el: Element) =>
    [...el.classList]
      .filter((name) => !name.includes(":") && !name.includes("[") && name.length < 24)
      .slice(0, 3)
      .join(".");
  const step = (el: Element) => {
    const id = el.id && !/^(radix|_r_|«)/.test(el.id) ? `#${el.id}` : "";
    const slot = el.getAttribute("data-slot");
    const cls = shortClass(el);
    return `${el.tagName.toLowerCase()}${id}${slot ? `[data-slot=${slot}]` : ""}${cls ? `.${cls}` : ""}`;
  };
  const path = (el: Element) => {
    const steps: string[] = [];
    for (let node: Element | null = el; node && steps.length < 3 && node !== document.body; node = node.parentElement) {
      steps.unshift(step(node));
    }
    return steps.join(" > ");
  };
  const textOf = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const nameOf = (el: Element): string => {
    const label = el.getAttribute("aria-label");
    if (label) return label.trim();
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => textOf(document.getElementById(id)))
        .join(" ")
        .trim();
      if (text) return text;
    }
    const labelled = (el as Element & { labels?: NodeListOf<HTMLLabelElement> | null }).labels;
    const labelText = labelled ? [...labelled].map((l) => textOf(l)).join(" ").trim() : "";
    if (labelText) return labelText;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      if (el instanceof HTMLInputElement && (el.type === "submit" || el.type === "button") && el.value) return el.value;
      const placeholder = el.getAttribute("placeholder");
      if (placeholder) return `(placeholder) ${placeholder}`;
    }
    const title = el.getAttribute("title");
    const text = textOf(el);
    if (text) return text.slice(0, 80);
    const img = el.querySelector("img[alt]");
    if (img?.getAttribute("alt")) return img.getAttribute("alt")!;
    const svgTitle = el.querySelector("svg title");
    if (svgTitle) return textOf(svgTitle);
    return title ?? "";
  };
  const info = (el: Element): ElementInfo => {
    const rect = el.getBoundingClientRect();
    return {
      path: path(el),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      name: nameOf(el).slice(0, 100),
      slot: el.getAttribute("data-slot"),
      testid: el.getAttribute("data-testid"),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y + window.scrollY),
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
      },
    };
  };
  const visible = (el: Element) => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    if (Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    // Inside something hidden or closed.
    if (el.closest("[hidden], [inert], [aria-hidden=true], details:not([open]) > :not(summary)")) return false;
    return true;
  };
  const srOnly = (el: Element) => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.position === "absolute" && (style.clip === "rect(0px, 0px, 0px, 0px)" || style.clipPath === "inset(50%)")) return true;
      const rect = node.getBoundingClientRect();
      if (style.overflow === "hidden" && rect.width <= 1 && rect.height <= 1) return true;
    }
    return false;
  };

  // ---- Sideways overflow -------------------------------------------------
  // What makes the page wider than the viewport: the elements past its edge,
  // deepest first, whose removal (display none, put back at once) narrows the
  // page. An sr-only label whose containing block is outside the table's
  // scroller is the usual one (docs/DESIGN.md: anchor sr-only text).
  const widthNow = () => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw;
  const pageOverflowX = widthNow();
  const all = [...document.body.querySelectorAll("*")];
  const overflowing: LayoutReport["overflowing"] = [];
  if (pageOverflowX > 0) {
    const depth = (el: Element) => {
      let d = 0;
      for (let node: Element | null = el; node; node = node.parentElement) d++;
      return d;
    };
    const candidates = all
      .filter((el) => el.tagName.toLowerCase() === "svg" || !el.closest("svg"))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.right > vw + 1 || rect.left < -1;
      })
      .sort((a, b) => depth(b) - depth(a))
      .slice(0, 400);
    for (const el of candidates) {
      if (!(el instanceof HTMLElement || el instanceof SVGElement)) continue;
      const previous = el.style.display;
      el.style.display = "none";
      const without = widthNow();
      el.style.display = previous;
      if (without < pageOverflowX) {
        const rect = el.getBoundingClientRect();
        overflowing.push({ ...info(el), right: Math.round(rect.right), srOnly: srOnly(el), position: getComputedStyle(el).position });
        if (overflowing.length >= 5) break;
      }
    }
  }

  const scrollers: LayoutReport["scrollers"] = [];
  for (const el of all) {
    if (!/(auto|scroll)/.test(getComputedStyle(el).overflowX)) continue;
    if (el.scrollWidth > el.clientWidth + 1 && visible(el)) {
      scrollers.push({ ...info(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
    }
  }

  // ---- Touch targets and field text ---------------------------------------
  const INTERACTIVE = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "summary",
    "[role=button]",
    "[role=link]",
    "[role=tab]",
    "[role=menuitem]",
    "[role=menuitemcheckbox]",
    "[role=menuitemradio]",
    "[role=option]",
    "[role=checkbox]",
    "[role=radio]",
    "[role=switch]",
    "[role=slider]",
    "[role=spinbutton]",
    "[role=combobox]",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");
  const interactive = [...document.querySelectorAll(INTERACTIVE)].filter((el) => visible(el) && !srOnly(el));
  // A control inside another control (a button in a label) is measured once, as the outer one.
  const outer = interactive.filter((el) => !interactive.some((other) => other !== el && other.contains(el) && other.tagName !== "LABEL"));

  const smallTargets: LayoutReport["smallTargets"] = [];
  const smallFieldText: LayoutReport["smallFieldText"] = [];
  if (options.touch) {
    const startY = window.scrollY;
    const startX = window.scrollX;
    for (const el of outer) {
      const rect = el.getBoundingClientRect();
      if (rect.width >= 43.5 && rect.height >= 43.5) continue;
      // A visually hidden native input under a styled control (a checkbox, a file input) is the control's business.
      if (el instanceof HTMLInputElement && Number(getComputedStyle(el).opacity) === 0) continue;
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const labelled = (el as Element & { labels?: NodeListOf<HTMLLabelElement> | null }).labels;
      const labels: Element[] = labelled ? [...labelled] : [];
      const wrapping = el.parentElement?.closest("label");
      if (wrapping) labels.push(wrapping);
      const owns = (hit: Element | null) =>
        !!hit && (hit === el || el.contains(hit) || labels.some((label) => label === hit || label.contains(hit)));
      const hits = (x: number, y: number) => {
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
        return owns(document.elementFromPoint(x, y));
      };
      const hit = {
        left: hits(cx - 21, cy),
        right: hits(cx + 21, cy),
        up: hits(cx, cy - 21),
        down: hits(cx, cy + 21),
      };
      if (hit.left && hit.right && hit.up && hit.down) continue;
      // Inline links inside a sentence (WCAG 2.5.8 exempts them; DESIGN.md wants 44 px controls).
      const parent = el.parentElement;
      const inline =
        el.tagName === "A" &&
        getComputedStyle(el).display === "inline" &&
        !!parent &&
        textOf(parent).length > textOf(el).length + 12;
      smallTargets.push({ ...info(el), hit, inline });
    }
    window.scrollTo(startX, startY);

    const FIELDS =
      "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=color]), textarea, select, [contenteditable=true]";
    for (const el of document.querySelectorAll(FIELDS)) {
      if (!visible(el) || srOnly(el)) continue;
      const size = Number.parseFloat(getComputedStyle(el).fontSize);
      if (size < 15.9) smallFieldText.push({ ...info(el), fontSize: size });
    }
  }

  // ---- Contrast --------------------------------------------------------------
  const parseColor = (value: string): [number, number, number, number] | null => {
    const match = /rgba?\(([^)]+)\)/.exec(value);
    if (!match) return null;
    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  };
  const luminance = ([r, g, b]: [number, number, number, number]) => {
    const channel = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const blend = (top: [number, number, number, number], bottom: [number, number, number, number]) => {
    const a = top[3];
    return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1] as [
      number,
      number,
      number,
      number,
    ];
  };
  /** The colour behind an element: its backgrounds and its ancestors', blended; null over an image or gradient. */
  const backgroundOf = (el: Element): [number, number, number, number] | null => {
    const layers: [number, number, number, number][] = [];
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage && style.backgroundImage !== "none") return null;
      const color = parseColor(style.backgroundColor);
      if (color && color[3] > 0) {
        layers.push(color);
        if (color[3] >= 1) break;
      }
    }
    let result: [number, number, number, number] = [255, 255, 255, 1];
    for (const layer of layers.reverse()) result = blend(layer, result);
    return result;
  };
  const lowContrast: LayoutReport["lowContrast"] = [];

  // ---- Text that does not fit ---------------------------------------------
  const clipped: LayoutReport["clipped"] = [];
  const spilling: LayoutReport["spilling"] = [];
  const squeezed: LayoutReport["squeezed"] = [];
  const tinyText: LayoutReport["tinyText"] = [];
  const range = document.createRange();
  for (const el of all) {
    const ownText = [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim().length > 0);
    if (!ownText) continue;
    if (!visible(el) || srOnly(el)) continue;
    if (el.closest("svg, script, style, noscript, template")) continue;
    const style = getComputedStyle(el);
    const fontSize = Number.parseFloat(style.fontSize);
    if (fontSize < 12) tinyText.push({ ...info(el), fontSize });
    // Contrast of this text against what is behind it (disabled controls are exempt).
    const disabled = el.closest(":disabled, [aria-disabled=true], [data-disabled]") !== null;
    const textColor = parseColor(style.color);
    const behind = backgroundOf(el);
    if (!disabled && textColor && behind && style.webkitTextFillColor !== "transparent" && style.color !== "rgba(0, 0, 0, 0)") {
      // Translucent text and faded ancestors render lighter: fold opacity in.
      let alpha = textColor[3];
      for (let node: Element | null = el; node; node = node.parentElement) alpha *= Number(getComputedStyle(node).opacity);
      const rendered = blend([textColor[0], textColor[1], textColor[2], alpha], behind);
      const l1 = luminance(rendered);
      const l2 = luminance(behind);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const bold = Number(style.fontWeight) >= 700;
      const large = fontSize >= 24 || (bold && fontSize >= 18.66);
      if (ratio < (large ? 3 : 4.5)) {
        lowContrast.push({
          ...info(el),
          ratio: Math.round(ratio * 100) / 100,
          color: style.color,
          background: `rgb(${behind.slice(0, 3).map(Math.round).join(", ")})`,
          fontSize,
        });
      }
    }
    const rect = el.getBoundingClientRect();
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && /(hidden|clip)/.test(style.overflowX)) {
      clipped.push({
        ...info(el),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        ellipsis: style.textOverflow === "ellipsis",
        title: el.getAttribute("title") ?? el.closest("[title]")?.getAttribute("title") ?? null,
      });
      continue;
    }
    // Text box against the element's box, for overflow visible.
    let textRight = -Infinity;
    let textLeft = Infinity;
    let textTop = Infinity;
    let textBottom = -Infinity;
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent!.trim()) continue;
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      if (r.width === 0) continue;
      textRight = Math.max(textRight, r.right);
      textLeft = Math.min(textLeft, r.left);
      textTop = Math.min(textTop, r.top);
      textBottom = Math.max(textBottom, r.bottom);
    }
    if (textRight === -Infinity) continue;
    const by = Math.max(textRight - rect.right, rect.left - textLeft);
    if (by > 1.5 && !el.closest("[data-slot=tooltip-content]")) {
      // Only when no ancestor clips it inside the viewport: then it shows outside its box.
      spilling.push({ ...info(el), by: Math.round(by) });
    }
    const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.4;
    const lines = Math.round((textBottom - textTop) / lineHeight);
    if (lines >= 3 && rect.width < 120 && textOf(el).length > 6) squeezed.push({ ...info(el), lines });
  }

  // ---- Names -------------------------------------------------------------
  const unnamed: ElementInfo[] = [];
  for (const el of interactive) {
    if (el.tagName === "LABEL") continue;
    if (!nameOf(el)) unnamed.push(info(el));
  }

  const ids = new Map<string, number>();
  for (const el of document.querySelectorAll("[id]")) ids.set(el.id, (ids.get(el.id) ?? 0) + 1);
  const duplicateIds = [...ids].filter(([, count]) => count > 1).map(([id]) => id);

  const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading]")]
    .filter((el) => visible(el) || srOnly(el))
    .map((el) => ({
      level: el.getAttribute("aria-level") ? Number(el.getAttribute("aria-level")) : Number(el.tagName.slice(1)) || 2,
      text: textOf(el).slice(0, 80),
    }));

  return {
    viewport: { width: vw, height: vh },
    pageOverflowX,
    overflowing: overflowing.slice(0, 20),
    scrollers,
    smallTargets,
    smallFieldText,
    clipped: clipped.slice(0, 40),
    spilling: spilling.slice(0, 40),
    squeezed: squeezed.slice(0, 40),
    tinyText: tinyText.slice(0, 40),
    lowContrast: lowContrast.slice(0, 40),
    unnamed,
    duplicateIds,
    headings,
  };
}

/**
 * Runs in the page before a Tab walk: every focusable element's unfocused
 * look (outline, shadow, border, background, underline), kept on window so
 * focusSnapshot() can tell what focus changed.
 */
export function rememberUnfocusedLooks(): number {
  const looks = new Map<Element, string>();
  const focusable = document.querySelectorAll(
    "a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=true]",
  );
  const look = (el: Element) => {
    const style = getComputedStyle(el);
    return JSON.stringify([
      style.outlineStyle === "none" ? "none" : `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
      style.boxShadow,
      style.borderTopColor,
      style.backgroundColor,
      style.textDecorationLine,
    ]);
  };
  for (const el of focusable) {
    // The element and two ancestors: a field group draws its ring on focus-within.
    for (let node: Element | null = el, depth = 0; node && depth < 3; node = node.parentElement, depth++) {
      if (!looks.has(node)) looks.set(node, look(node));
    }
  }
  (window as unknown as { __uxUnfocused: Map<Element, string> }).__uxUnfocused = looks;
  return looks.size;
}

/** Runs in the page: the active element, what its focus looks like, and whether anything covers it. */
export function focusSnapshot(): {
  key: string;
  outline: string;
  outlineWidth: number;
  boxShadow: string;
  border: string;
  background: string;
  textDecoration: string;
  /** What differs from the unfocused look; null when nothing does (no visible focus). */
  changed: string[] | null;
  info: ElementInfo;
  focusVisible: boolean;
  obscuredBy: string | null;
  offscreen: boolean;
} | null {
  let el = document.activeElement;
  // Into iframes and shadow roots is not needed here.
  if (!el || el === document.body || el === document.documentElement) return null;
  while (el.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const looks = (window as unknown as { __uxUnfocused?: Map<Element, string> }).__uxUnfocused;
  const lookOf = (node: Element) => {
    const s = getComputedStyle(node);
    return [
      s.outlineStyle === "none" ? "none" : `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`,
      s.boxShadow,
      s.borderTopColor,
      s.backgroundColor,
      s.textDecorationLine,
    ];
  };
  const names = ["outline", "box-shadow", "border", "background", "underline"];
  let changed: string[] | null = null;
  for (let node: Element | null = el, depth = 0; node && depth < 3; node = node.parentElement, depth++) {
    const before = looks?.get(node);
    const now = lookOf(node);
    if (before) {
      const was = JSON.parse(before) as string[];
      const diff = names.filter((_, index) => was[index] !== now[index]);
      if (diff.length > 0) {
        changed = diff.map((name) => (depth === 0 ? name : `${name} (ancestor ${depth})`));
        break;
      }
    } else if (depth === 0 && now[0] !== "none") {
      // Rendered after the walk began: an outline counts.
      changed = ["outline"];
      break;
    }
  }
  const textOf = (node: Element | null) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
  const name =
    el.getAttribute("aria-label") ??
    (el.getAttribute("aria-labelledby")
      ? el
          .getAttribute("aria-labelledby")!
          .split(/\s+/)
          .map((id) => textOf(document.getElementById(id)))
          .join(" ")
      : null) ??
    ((el as HTMLInputElement).labels?.length ? [...(el as HTMLInputElement).labels!].map((l) => textOf(l)).join(" ") : null) ??
    textOf(el).slice(0, 80);
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + Math.min(rect.height / 2, 12);
  let obscuredBy: string | null = null;
  const offscreen = rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth;
  if (!offscreen && rect.width > 0) {
    const hit = document.elementFromPoint(Math.min(Math.max(cx, 0), window.innerWidth - 1), Math.min(Math.max(cy, 0), window.innerHeight - 1));
    if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
      // A label or wrapper of the element counts as the element.
      const labelOwner = hit.closest("label");
      if (!(labelOwner && labelOwner.contains(el))) {
        const cover = hit.closest("header, nav, [data-slot], [role=dialog], [role=tablist]") ?? hit;
        obscuredBy = `${cover.tagName.toLowerCase()}${cover.getAttribute("data-slot") ? `[data-slot=${cover.getAttribute("data-slot")}]` : ""}${cover.getAttribute("data-testid") ? `[data-testid=${cover.getAttribute("data-testid")}]` : ""}`;
      }
    }
  }
  const tag = el.tagName.toLowerCase();
  const key = `${tag}|${el.id}|${el.getAttribute("data-slot") ?? ""}|${name}|${Math.round(rect.x)}|${Math.round(rect.y + window.scrollY)}`;
  return {
    key,
    outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor} offset ${style.outlineOffset}`,
    outlineWidth: style.outlineStyle === "none" ? 0 : Number.parseFloat(style.outlineWidth),
    boxShadow: style.boxShadow,
    border: `${style.borderTopColor} ${style.borderTopWidth}`,
    background: style.backgroundColor,
    textDecoration: style.textDecorationLine,
    changed,
    info: {
      path: tag + (el.getAttribute("data-slot") ? `[data-slot=${el.getAttribute("data-slot")}]` : ""),
      tag,
      role: el.getAttribute("role"),
      name: (name ?? "").slice(0, 100),
      slot: el.getAttribute("data-slot"),
      testid: el.getAttribute("data-testid"),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    },
    focusVisible: el.matches(":focus-visible"),
    obscuredBy,
    offscreen,
  };
}
