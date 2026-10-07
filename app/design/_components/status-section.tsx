import { ResultChip, StatusPill } from "@/components/qc";
import { AA_TEXT, contrastRatio, formatRatio } from "@/lib/design/contrast";
import { STATUSES, status as statusTokens, mist, white, type Hex } from "@/lib/design/tokens";
import { STATUS_LABEL } from "@/lib/design/status";
import { CONCLUSION_LABELS } from "@/modules/conclusion/config";
import { DesignSection } from "./design-section";

// The overall result takes these colours in the template's own words (docs/DESIGN.md, Status colours).
const USE: Record<(typeof STATUSES)[number], string> = {
  pass: `A module or size passed. Overall result: ${CONCLUSION_LABELS.pass} (the template's word)`,
  fail: `A module or size failed. Overall result: ${CONCLUSION_LABELS.fail} (the template's word)`,
  warn: "Allowed, but goes into the export (e.g. weight deviation)",
  hold: `Overall result ${CONCLUSION_LABELS.hold} (the template's word), pending a decision`,
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
    </DesignSection>
  );
}
