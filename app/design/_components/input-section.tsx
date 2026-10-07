"use client";

import { useId, useState } from "react";
import { NumericCell, type InvalidEntry } from "@/components/qc";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CONCLUSION_LABELS } from "@/modules/conclusion/config";
import { DesignSection, Specimen } from "./design-section";

const INNER_UNITS = ["Inner box", "Plastic pack", "Dispenser box", "Pouch"];
const RESULTS = ["pass", "fail", "hold"] as const;

export function InputSection() {
  const id = useId();
  const [weight, setWeight] = useState<number | null>(3.6);
  const [palm, setPalm] = useState<number | null>(null);
  const [palmInvalid, setPalmInvalid] = useState<InvalidEntry | null>({
    raw: "2 42",
    error: "One number per cell: remove the space (“2 42” → 242).",
  });
  const [verified, setVerified] = useState(true);
  const [handSplit, setHandSplit] = useState(false);

  return (
    <DesignSection
      id="inputs"
      description="White fields with slate-300 borders and labels above, as on the website's forms. Measurements open the decimal keypad and reject anything that is not a number. Computed values are read-only on grey: never typed."
      source="contact-form.tsx (field styling)"
    >
      <Specimen>
        <div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${id}-product`}>Product Name (Brand, Code &amp; Description)</Label>
            <Input id={`${id}-product`} defaultValue="Example nitrile examination glove" />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-weight`}>Indicative Weight (Size M)</Label>
            <NumericCell id={`${id}-weight`} value={weight} onValueChange={setWeight} unit="g" min={0} />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-unit`}>Inner Unit</Label>
            <Select defaultValue="Inner box">
              <SelectTrigger id={`${id}-unit`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INNER_UNITS.map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {unit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-date`}>Inspection Date</Label>
            <Input id={`${id}-date`} type="date" defaultValue="2026-10-06" />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-palm`}>Palm Thickness · Error State</Label>
            <NumericCell
              id={`${id}-palm`}
              value={palm}
              onValueChange={setPalm}
              invalid={palmInvalid}
              onInvalidChange={setPalmInvalid}
              unit="mm"
              min={0}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-case`}># Gloves per Case · Computed</Label>
            <Input id={`${id}-case`} readOnly value="1,000" aria-describedby={`${id}-case-hint`} />
            <p id={`${id}-case-hint`} className="text-sm text-muted-foreground">
              100 per inner box × 10 inner boxes
            </p>
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor={`${id}-remark`}>Remark</Label>
            <Textarea id={`${id}-remark`} placeholder="Anything the client should know" />
          </div>
        </div>
      </Specimen>

      <Specimen label="Choices">
        <div className="flex flex-wrap items-start gap-x-10 gap-y-6">
          <div className="flex items-center gap-3">
            <Checkbox id={`${id}-lot`} checked={verified} onCheckedChange={(value) => setVerified(value === true)} />
            <Label htmlFor={`${id}-lot`}>Lot Number Verified</Label>
          </div>
          <div className="flex items-center gap-3">
            <Switch id={`${id}-hand`} checked={handSplit} onCheckedChange={setHandSplit} />
            <Label htmlFor={`${id}-hand`}>Record R and L Separately</Label>
          </div>
          {/* The overall result in the template's words, as the conclusion module shows it (docs/DESIGN.md). */}
          <RadioGroup defaultValue="pass" aria-label={CONCLUSION_LABELS.finalResult} className="flex flex-wrap gap-6">
            {RESULTS.map((value) => (
              <div key={value} className="flex items-center gap-3">
                <RadioGroupItem id={`${id}-result-${value}`} value={value} />
                <Label htmlFor={`${id}-result-${value}`}>{CONCLUSION_LABELS[value]}</Label>
              </div>
            ))}
          </RadioGroup>
        </div>
      </Specimen>
    </DesignSection>
  );
}
