"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { TriangleAlertIcon } from "lucide-react";
import { ModuleCard, NumericCell } from "@/components/qc";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DesignSection } from "./design-section";

export function ModuleSection() {
  const id = useId();
  const [perInner, setPerInner] = useState<number | null>(100);
  const [innersPerCase, setInnersPerCase] = useState<number | null>(10);
  const [perCase, setPerCase] = useState<number | null>(1100);
  const [comment, setComment] = useState("");
  const [photos, setPhotos] = useState(2);

  const expected = perInner !== null && innersPerCase !== null ? perInner * innersPerCase : null;
  const complete = expected !== null && perCase !== null;
  const mismatch = complete && perCase !== expected;
  const status = !complete ? "not_done" : mismatch ? "warn" : "info";

  return (
    <DesignSection
      id="module"
      description="Every module is a card: the title in the template's wording, its live result, the capture form, an inspector comment and the two photo buttons. Change a number below and the result follows."
      source="ui.tsx.txt (Card, without the hover lift)"
    >
      <ModuleCard
        title="Packing configuration"
        description="Gloves per inner box, inner boxes per case and gloves per case, as printed on the carton."
        status={status}
        comment={comment}
        onCommentChange={setComment}
        photoCount={photos}
        onFiles={(files, source) => {
          setPhotos((count) => count + files.length);
          toast.info(
            `${files.length} ${files.length === 1 ? "photo" : "photos"} from the ${source === "camera" ? "camera" : "library"}. Nothing is uploaded on this page.`,
          );
        }}
      >
        <div className="grid gap-x-6 gap-y-5 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor={`${id}-unit`}>Inner Unit</Label>
            <Select defaultValue="Inner box">
              <SelectTrigger id={`${id}-unit`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["Inner box", "Plastic pack", "Dispenser box", "Pouch"].map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {unit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-per-inner`}># glove per inner box</Label>
            <NumericCell id={`${id}-per-inner`} value={perInner} onValueChange={setPerInner} min={1} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-inners`}># inners per case</Label>
            <NumericCell id={`${id}-inners`} value={innersPerCase} onValueChange={setInnersPerCase} min={1} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-per-case`}># gloves per case</Label>
            <NumericCell id={`${id}-per-case`} value={perCase} onValueChange={setPerCase} min={1} />
          </div>
        </div>

        <div className="grid gap-x-6 gap-y-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor={`${id}-expected`}>Inner × per Case · Computed</Label>
            <Input id={`${id}-expected`} readOnly value={expected?.toLocaleString("en-GB") ?? ""} className="text-right tabular-nums" />
          </div>
          {mismatch && (
            <p
              role="status"
              className="flex items-start gap-2 self-end rounded-md border border-warn-border bg-warn-tint px-3 py-2 text-sm text-warn md:col-span-1 xl:col-span-3"
            >
              <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              {perInner} × {innersPerCase} = {expected?.toLocaleString("en-GB")}, but the carton says{" "}
              {perCase?.toLocaleString("en-GB")}. Allowed, and noted in the export.
            </p>
          )}
        </div>
      </ModuleCard>
    </DesignSection>
  );
}
