// Gathers the UX audit's records (screenshots/acceptance-ux/**/*.json) into
// one summary per screen: what broke a rule, with the element and its size.
//
//   node e2e/acceptance/ux/report.mts                 every project
//   node e2e/acceptance/ux/report.mts desktop         one project
//   node e2e/acceptance/ux/report.mts desktop list    screens whose name contains "list"
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "screenshots/acceptance-ux";
const [projectFilter, screenFilter, verbose] = process.argv.slice(2);

type Rect = { x: number; y: number; width: number; height: number };
type Info = { path: string; name: string; tag: string; role: string | null; slot: string | null; rect: Rect };
type Record_ = {
  project: string;
  account: string;
  screen: string;
  url: string;
  touch: boolean;
  shots: string[];
  layout: {
    pageOverflowX: number;
    overflowing: (Info & { right: number })[];
    scrollers: (Info & { scrollWidth: number; clientWidth: number })[];
    smallTargets: (Info & { inline: boolean; hit: Record<string, boolean> })[];
    smallFieldText: (Info & { fontSize: number })[];
    clipped: (Info & { ellipsis: boolean; title: string | null; scrollWidth: number; clientWidth: number })[];
    spilling: (Info & { by: number })[];
    squeezed: (Info & { lines: number })[];
    tinyText: (Info & { fontSize: number })[];
    unnamed: Info[];
    duplicateIds: string[];
    headings: { level: number; text: string }[];
  };
  axe: { id: string; impact: string | null; help: string; nodes: { target: string; html: string; summary: string }[] }[];
  axeIncomplete: { id: string; count: number }[];
  focus: {
    index: number;
    name: string;
    tag: string;
    role: string | null;
    rect: Rect;
    focusVisible: boolean;
    changed: string[] | null;
    outline: string;
    obscuredBy: string | null;
    offscreen: boolean;
  }[];
  console: string[];
};

function walk(dir: string): string[] {
  let files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files = files.concat(walk(path));
    else if (entry.endsWith(".json")) files.push(path);
  }
  return files;
}

const size = (rect: Rect) => `${rect.width}x${rect.height}`;
const label = (info: Info) => `${info.tag}${info.role ? `[role=${info.role}]` : ""} "${info.name.slice(0, 50)}" ${size(info.rect)} @${info.rect.x},${info.rect.y}`;

const records = walk(ROOT)
  .map((file) => JSON.parse(readFileSync(file, "utf8")) as Record_)
  .filter((record) => !projectFilter || projectFilter === "all" || record.project === projectFilter)
  .filter((record) => !screenFilter || record.screen.includes(screenFilter))
  .sort((a, b) => `${a.project}/${a.account}/${a.screen}`.localeCompare(`${b.project}/${b.account}/${b.screen}`));

for (const record of records) {
  const lines: string[] = [];
  const { layout } = record;
  if (layout.pageOverflowX > 0) {
    lines.push(`  PAGE OVERFLOW ${layout.pageOverflowX}px, caused by: ${layout.overflowing.slice(0, 4).map((o) => `${o.path} "${o.name.slice(0, 30)}" (right ${o.right}${(o as typeof o & { srOnly?: boolean }).srOnly ? ", sr-only" : ""})`).join("; ")}`);
  }
  const scrollers = layout.scrollers.filter((s) => s.slot !== "table-scroller");
  if (scrollers.length) lines.push(`  scrollers: ${scrollers.map((s) => `${s.path} ${s.scrollWidth}>${s.clientWidth}`).join("; ")}`);
  const targets = layout.smallTargets.filter((t) => !t.inline);
  if (targets.length) lines.push(`  SMALL TARGETS (${targets.length}): ${targets.slice(0, verbose ? 99 : 8).map(label).join(" | ")}`);
  const inline = layout.smallTargets.filter((t) => t.inline);
  if (inline.length) lines.push(`  inline links under 44px: ${inline.map(label).join(" | ")}`);
  if (layout.smallFieldText.length) lines.push(`  FIELD TEXT <16px: ${layout.smallFieldText.map((f) => `${label(f)} ${f.fontSize}px`).join(" | ")}`);
  // Hard clipping (no ellipsis) always; text cut with "…" but no tooltip, listed only with "v".
  const clipped = layout.clipped.filter((c) => !c.ellipsis);
  if (clipped.length) lines.push(`  CLIPPED: ${clipped.slice(0, 8).map((c) => `${label(c)} ${c.scrollWidth}>${c.clientWidth}`).join(" | ")}`);
  const untitled = layout.clipped.filter((c) => c.ellipsis && !c.title);
  if (untitled.length) {
    lines.push(
      verbose
        ? `  cut with … and no tooltip: ${untitled.map((c) => `${label(c)} ${c.scrollWidth}>${c.clientWidth}`).join(" | ")}`
        : `  cut with … and no tooltip: ${untitled.length} (${[...new Set(untitled.map((c) => c.name.slice(0, 28)))].slice(0, 4).join("; ")})`,
    );
  }
  if (layout.spilling.length) lines.push(`  SPILLING: ${layout.spilling.slice(0, 8).map((s) => `${label(s)} by ${s.by}`).join(" | ")}`);
  if (layout.squeezed.length) lines.push(`  SQUEEZED: ${layout.squeezed.slice(0, 8).map((s) => `${label(s)} ${s.lines} lines`).join(" | ")}`);
  if (layout.tinyText.length) lines.push(`  TINY TEXT: ${layout.tinyText.slice(0, 8).map((t) => `${label(t)} ${t.fontSize}px`).join(" | ")}`);
  const low = (layout as typeof layout & { lowContrast?: (Info & { ratio: number; color: string; background: string; fontSize: number })[] }).lowContrast ?? [];
  if (low.length) lines.push(`  LOW CONTRAST: ${low.slice(0, 8).map((c) => `${label(c)} ${c.ratio}:1 ${c.color} on ${c.background} ${c.fontSize}px`).join(" | ")}`);
  if (layout.unnamed.length) lines.push(`  UNNAMED: ${layout.unnamed.map((u) => `${u.path} ${size(u.rect)}`).join(" | ")}`);
  if (layout.duplicateIds.length) lines.push(`  DUPLICATE IDS: ${layout.duplicateIds.join(", ")}`);
  for (const violation of record.axe) {
    lines.push(`  AXE ${violation.impact} ${violation.id}: ${violation.help} (${violation.nodes.length})`);
    for (const node of violation.nodes.slice(0, verbose ? 12 : 3)) lines.push(`      ${node.target} ${node.html.slice(0, 140)} :: ${node.summary.slice(0, 160)}`);
  }
  const noFocus = record.focus.filter((step) => !step.changed);
  if (noFocus.length) lines.push(`  NO VISIBLE FOCUS: ${noFocus.map((s) => `${s.tag}${s.role ? `[${s.role}]` : ""} "${s.name.slice(0, 40)}" (${s.outline})`).join(" | ")}`);
  const covered = record.focus.filter((step) => step.obscuredBy || step.offscreen);
  if (covered.length) lines.push(`  FOCUS COVERED: ${covered.map((s) => `"${s.name.slice(0, 40)}" by ${s.obscuredBy ?? "offscreen"}`).join(" | ")}`);
  const back = (record as Record_ & { focusBack?: Record_["focus"] }).focusBack ?? [];
  const coveredBack = back.filter((step) => step.obscuredBy || step.offscreen);
  if (coveredBack.length) {
    lines.push(`  FOCUS COVERED GOING BACK (Shift+Tab): ${coveredBack.map((s) => `"${s.name.slice(0, 40)}" by ${s.obscuredBy ?? "offscreen"} @${s.rect.x},${s.rect.y} ${s.rect.width}x${s.rect.height}`).join(" | ")}`);
  }
  const invisibleBack = back.filter((step) => !step.changed);
  if (invisibleBack.length) lines.push(`  NO VISIBLE FOCUS (Shift+Tab): ${invisibleBack.map((s) => `${s.tag} "${s.name.slice(0, 40)}"`).join(" | ")}`);
  if (verbose && record.focus.length) lines.push(`  tab order: ${record.focus.map((s) => `${s.name.slice(0, 24)}@${s.rect.x},${s.rect.y}`).join(" → ")}`);
  if (record.console.length) lines.push(`  CONSOLE: ${record.console.slice(0, 6).join(" || ")}`);
  const notes = (record as Record_ & { notes?: string[] }).notes ?? [];
  if (notes.length) lines.push(`  NOTES: ${notes.join(" || ").slice(0, 600)}`);
  if (lines.length === 0 && !verbose) continue;
  console.log(`\n[${record.project}] ${record.account} / ${record.screen}  ${record.url}`);
  console.log(`  shots: ${record.shots.join(", ")}`);
  for (const line of lines) console.log(line);
}
console.log(`\n${records.length} records`);
