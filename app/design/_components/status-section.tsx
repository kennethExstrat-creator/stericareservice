import { ResultChip, StatusPill } from "@/components/qc";
import { AA_TEXT, contrastRatio, formatRatio } from "@/lib/design/contrast";
import { STATUSES, status as statusTokens, mist, white, type Hex } from "@/lib/design/tokens";
import { STATUS_LABEL } from "@/lib/design/status";
import { CONCLUSION_LABELS } from "@/modules/conclusion/config";
import { DesignSection } from "./design-section";

// Every result pill says STATUS_LABEL's words, the overall result's included (a module's own words
// for its checks aside); the template's conclusion words only where the inspector picks the
// conclusion (docs/DESIGN.md, Status colours).
const USE: Record<(typeof STATUSES)[number], string> = {
  pass: "A module, a size or the overall result (suggested or final) passed",
  fail: "A module, a size or the overall result (suggested or final) failed",
  warn: "Allowed, but goes into the export (e.g. weight deviation)",
  hold: "The overall result (suggested or final), pending a decision",
  info: "Recorded, nothing to judge (header, glove info)",
  not_done: "Missing data. Never shown as Passed",
};

function Ratio({ label, fg, bg }: { label: string; fg: Hex; bg: Hex }) {
  const ratio = contrastRatio(fg, bg);
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={ratio >= AA_TEXT ? "font-semibold text-foreground tabular-nums" : "font-semibold text-fail"}>
        {formatRatio(ratio)}
      </dd>
    </div>
  );
}

export function StatusSection() {
  return (
    <DesignSection
      id="status"
      title="Status colours"
      description="Results are told apart by icon and words as well as colour. Pass is green, never the brand teal. Every status text holds 4.5:1 on its tint, on white and on mist; the ratios below are measured."
      source="app-specific (BUILD_SPEC 2.1)"
    >
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {STATUSES.map((key) => {
          const tokens = statusTokens[key];
          return (
            <li key={key} className="space-y-4 rounded-xl bg-card p-5 shadow-sm ring-1 ring-border">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={key} />
                <StatusPill status={key} variant="solid" />
                <ResultChip status={key} />
              </div>
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{STATUS_LABEL[key]}.</span> {USE[key]}
              </p>
              <dl className="space-y-1 text-sm">
                <Ratio label="Text on tint" fg={tokens.text} bg={tokens.tint} />
                <Ratio label="Text on white" fg={tokens.text} bg={white} />
                <Ratio label="Text on mist" fg={tokens.text} bg={mist} />
                <Ratio label="Solid" fg={tokens.solidForeground} bg={tokens.solid} />
              </dl>
              <p className="font-mono text-xs text-muted-foreground">
                text {tokens.text} · tint {tokens.tint} · border {tokens.border} · solid {tokens.solid}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Every result pill says {STATUS_LABEL.pass}, {STATUS_LABEL.fail} or {STATUS_LABEL.hold} (a module&apos;s own words
        for its checks aside, such as Accept and Reject on an AQL table), the inspection&apos;s overall result included,
        suggested or final: on capture, the review, the inspections list and the AI panel. The
        template&apos;s conclusion words ({CONCLUSION_LABELS.pass}, {CONCLUSION_LABELS.fail} and {CONCLUSION_LABELS.hold}{" "}
        unless the template words them otherwise) appear only where the inspector picks the conclusion, as on the paper
        report: the Conclusion section&apos;s choices and that section&apos;s own text, its summary line and its warning
        when the final result differs from the suggestion. Never Pass, Fail or Hold.
      </p>
    </DesignSection>
  );
}
