"use client";

import { useState } from "react";
import { ProgressTracker } from "@/components/qc";
import { DesignSection, Specimen } from "./design-section";
import { MODULE_STEPS } from "./inspection-modules";

export function ProgressSection() {
  const [active, setActive] = useState("dimensions");

  return (
    <DesignSection
      id="progress"
      description="Progress across the modules uses the brand: done, in progress, not started. The module in view carries the signature gradient. Results stay in status colours. Click a step to move."
      source="app-specific (BUILD_SPEC 8)"
    >
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Specimen label="Bar · iPad Top Bar">
          <ProgressTracker steps={MODULE_STEPS} activeKey={active} onStepSelect={setActive} />
        </Specimen>
        <Specimen label="List · Desktop Sidebar">
          <ProgressTracker variant="list" steps={MODULE_STEPS} activeKey={active} onStepSelect={setActive} />
        </Specimen>
      </div>
    </DesignSection>
  );
}
