"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ClipboardCopyIcon } from "lucide-react";
import { MeasurementGrid, ResultChip, type Measure, type MeasurementValues } from "@/components/qc";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { summarizeColumn } from "@/lib/stats";
import type { Status } from "@/lib/design/status";
import { DesignSection, Specimen } from "./design-section";

// Illustrative specs, not SteriCare's: chosen so pass, fail and NA all show.
const thickness = (key: string, label: string, min?: number): Measure => ({
  key,
  label,
  unit: "mm",
  decimals: 2,
  min: 0,
  max: 5,
  spec: min === undefined ? { kind: "na" } : { kind: "min", min },
});

const measuresFor = (width: Measure["spec"]): Measure[] => [
  { key: "length", label: "Length", unit: "mm", decimals: 0, min: 0, max: 400, spec: { kind: "min", min: 240 } },
  { key: "width", label: "Width", unit: "mm", decimals: 0, min: 0, max: 200, spec: width },
  thickness("finger", "Finger Thickness", 0.1),
  thickness("palm", "Palm Thickness", 0.05),
  thickness("cuff", "Cuff Thickness"),
];

const SIZES = [
  { size: "S", measures: measuresFor({ kind: "tolerance", nominal: 80, tolerance: 10 }) },
  { size: "M", measures: measuresFor({ kind: "tolerance", nominal: 95, tolerance: 10 }) },
  { size: "L", measures: measuresFor({ kind: "tolerance", nominal: 110, tolerance: 10 }) },
] as const;

const INITIAL: Record<string, MeasurementValues> = {
  S: {},
  M: {
    length: [243, 245, 242, 244, 246, 243, 241, 244, 245, 243, 242, 244, 243],
    width: [95, 96, 94, 95, 97, 95, 94, 96, 95, 95, 94, 96, 95],
    finger: [0.09, 0.1, 0.09, 0.08, 0.09, 0.1, 0.09, 0.09, 0.08, 0.09, 0.1, 0.09, 0.09],
    palm: [0.07, 0.07, 0.06, 0.07, 0.08, 0.07, 0.07, 0.06, 0.07, 0.07, 0.08, 0.07, 0.07],
    cuff: [0.05, 0.06, 0.05, 0.05, 0.06, 0.05, 0.05, 0.05, 0.06, 0.05, 0.05, 0.05, 0.06],
  },
  L: {
    length: [246, 248, 245, 247, 249, 246],
    width: [109, 111, 110, 108, 112, 110],
  },
};

// 15 values for 13 gloves: one is rejected, and the two past the last row are listed under the grid.
const TEST_COLUMN = ["244", "246", "243", "245", "247", "2 42", "244", "245", "243", "246", "244", "245", "243", "246", "244"].join(
  "\n",
);

/** The dimensions result for a size: fail if any measure fails, not done until all are judged. */
function sizeResult(measures: readonly Measure[], values: MeasurementValues): Status {
  const outcomes = measures.map(
    (measure) => summarizeColumn(values[measure.key] ?? [], 13, "median", measure.spec, measure.decimals).outcome,
  );
  if (outcomes.includes("fail")) return "fail";
  if (outcomes.includes("not_done")) return "not_done";
  return "pass";
}

export function GridSection() {
  const [values, setValues] = useState(INITIAL);

  const copyTestColumn = async () => {
    try {
      await navigator.clipboard.writeText(TEST_COLUMN);
      toast.info("15 values copied. Click the first Length cell in size S and paste: 13 fit.");
    } catch {
      toast.error("The browser blocked the clipboard. Copy a column from a spreadsheet instead.");
    }
  };

  return (
    <DesignSection
      id="grid"
      description={
        <>
          13 gloves by 5 measures, in the report&apos;s wording. Type a value and press Enter to move down the column;
          arrows move between cells; pasting a column fills down from the focused cell, and values past the last row
          are listed under the grid, never dropped silently. A reading like “2 42” is rejected and never stored. The
          median shows <em>Not Done</em> until a column has data, and P/F waits for the whole column.
        </>
      }
      source="app-specific (BUILD_SPEC 6.1 dimensions, 6.2, 8)"
    >
      <Specimen>
        <Tabs defaultValue="M" className="gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList aria-label="Glove size">
              {SIZES.map(({ size, measures }) => (
                <TabsTrigger key={size} value={size} className="min-w-16">
                  Size {size}
                  <ResultChip status={sizeResult(measures, values[size])} />
                </TabsTrigger>
              ))}
            </TabsList>
            <Button variant="outline" size="sm" onClick={copyTestColumn}>
              <ClipboardCopyIcon aria-hidden />
              Copy a Test Column
            </Button>
          </div>
          {SIZES.map(({ size, measures }) => (
            <TabsContent key={size} value={size} className="space-y-3">
              <p className="font-display text-base font-semibold text-foreground">Dimension - Size {size}</p>
              <MeasurementGrid
                caption={`Dimension - Size ${size}`}
                measures={measures}
                values={values[size]}
                onValuesChange={(next) => setValues((current) => ({ ...current, [size]: next }))}
                statistic="median"
              />
              <p className="text-xs text-muted-foreground">Specs here are illustrative, not SteriCare&apos;s.</p>
            </TabsContent>
          ))}
        </Tabs>
      </Specimen>
    </DesignSection>
  );
}
