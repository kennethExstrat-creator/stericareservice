"use client";

import { useState } from "react";
import { StatusPill, Stepper } from "@/components/qc";
import { DesignSection, Specimen } from "./design-section";

const LOCATIONS = [
  { key: "crotch", label: "Between fingers (crotch)" },
  { key: "palm", label: "Palm" },
  { key: "finger", label: "Finger" },
  { key: "cuff", label: "Cuff" },
  { key: "other", label: "Other" },
];

// Illustrative plan: code letter J, n = 80, AQL 1.5 → Accept 3 / Reject 4.
const SAMPLE = 80;
const ACCEPT = 3;

export function StepperSection() {
  const [holes, setHoles] = useState<Record<string, number>>({ crotch: 0, palm: 1, finger: 0, cuff: 0, other: 0 });
  const total = Object.values(holes).reduce((sum, count) => sum + count, 0);

  return (
    <DesignSection
      id="steppers"
      description="Counts are tapped, never typed. Hold a button to repeat; arrow keys work on desktop. The minus is greyed at zero but stays focusable. The total and the accept chip update as you tap."
      source="app-specific (BUILD_SPEC 8)"
    >
      <Specimen
        label={
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span>Freedom from Holes by watertight test · Size M · n {SAMPLE}, Accept {ACCEPT} / Reject {ACCEPT + 1}</span>
            <StatusPill status={total <= ACCEPT ? "pass" : "fail"} label={total <= ACCEPT ? "Accept" : "Reject"} />
          </span>
        }
      >
        <ul className="grid gap-x-8 gap-y-3 md:grid-cols-2">
          {LOCATIONS.map(({ key, label }) => (
            <li key={key} className="flex items-center justify-between gap-4 border-b border-border pb-3">
              <span className="text-sm font-medium text-foreground">{label}</span>
              <Stepper
                label={`Holes, ${label}`}
                value={holes[key]}
                max={SAMPLE}
                onValueChange={(value) => setHoles((current) => ({ ...current, [key]: value }))}
              />
            </li>
          ))}
          <li className="flex items-center justify-between gap-4 border-b border-border pb-3">
            <span className="text-sm text-muted-foreground">Disabled (Approved Inspection)</span>
            <Stepper label="Holes, disabled example" value={2} disabled onValueChange={() => {}} />
          </li>
        </ul>
        <p className="mt-4 text-sm text-foreground">
          Total number of defects found: <span className="font-semibold tabular-nums">{total}</span>
          <span className="text-muted-foreground"> / {SAMPLE}</span>
        </p>
      </Specimen>
    </DesignSection>
  );
}
