"use client";

import { useState } from "react";
import { DefectChipGroup, StatusPill, type DefectChipItem } from "@/components/qc";
import { DesignSection, Specimen } from "./design-section";

const MAJOR: DefectChipItem[] = [
  { key: "thin_spot", label: "Thin spot on glove body", count: 2 },
  { key: "stain", label: "Oil stain", count: 1 },
  { key: "thin_crotch_area", label: "Thin area between fingers (crotch)", count: 0 },
  { key: "thin_crotch_ring", label: "Ring-shaped thin area (crotch)", count: 0 },
  { key: "thin_body_area", label: "Thin area on glove body", count: 0 },
  { key: "dirt_nonremovable", label: "Non-removable dirt", count: 0 },
  { key: "foreign_matter", label: "Residue material / foreign matter", count: 0 },
  { key: "bead_defective", label: "Defective bead", count: 0 },
  { key: "lump_big", label: "Big Lumps (>2mm)", count: 0 },
  { key: "custom-torn-cuff", label: "Torn cuff edge", count: 1, unmapped: true },
];

const CRITICAL: DefectChipItem[] = [
  { key: "embedded_insect", label: "Embedded insects", count: 0 },
  { key: "embedded_metal", label: "Embedded metal debris", count: 0 },
];

function useCounts(initial: DefectChipItem[]) {
  const [items, setItems] = useState(initial);
  return {
    items,
    setCount: (key: string, count: number) =>
      setItems((current) => current.map((item) => (item.key === key ? { ...item, count } : item))),
    addLabel: (label: string) =>
      setItems((current) => [...current, { key: `custom-${current.length}`, label, count: 1, unmapped: true }]),
  };
}

function verdict(total: number, accept: number) {
  return <StatusPill size="sm" status={total <= accept ? "pass" : "fail"} label={total <= accept ? "Accept" : "Reject"} />;
}

export function DefectSection() {
  const major = useCounts(MAJOR);
  const critical = useCounts(CRITICAL);
  const majorTotal = major.items.reduce((sum, item) => sum + item.count, 0);
  const criticalTotal = critical.items.reduce((sum, item) => sum + item.count, 0);

  return (
    <DesignSection
      id="defects"
      title="Defect chips"
      description="Tap a chip to add one, use its minus to remove one. Most-used defects come first. A one-off label is allowed: it is saved unmapped (dashed amber edge, flag) for an admin to map to a defect code."
      source="app-specific (BUILD_SPEC 4.2 rule 4, 8)"
    >
      <Specimen className="space-y-8">
        <DefectChipGroup
          legend="Critical Defects (AQL 0.0)"
          description={<span className="inline-flex items-center gap-2">Acc. = 0 / Rej. = 1 {verdict(criticalTotal, 0)}</span>}
          items={critical.items}
          onCountChange={critical.setCount}
        />
        <DefectChipGroup
          legend="Major Defects (AQL 2.5)"
          description={<span className="inline-flex items-center gap-2">n 80 · Accept 5 / Reject 6 {verdict(majorTotal, 5)}</span>}
          items={major.items}
          onCountChange={major.setCount}
          onAddLabel={major.addLabel}
        />
      </Specimen>
    </DesignSection>
  );
}
