"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CameraIcon, CheckIcon, PlusIcon, SendIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { DesignSection, Specimen } from "./design-section";

export function ButtonSection() {
  const [saving, setSaving] = useState(false);

  const save = () => {
    setSaving(true);
    window.setTimeout(() => setSaving(false), 1500);
  };

  return (
    <DesignSection
      id="buttons"
      description="Pills, as on the website, but solid: the primary button is brand-500 with white text (4.7:1) and darkens on hover. No sliding gradient, no lift, no scale. On iPad every size grows to at least 44 px."
      source="ui.tsx.txt (ButtonLink shape); fill is app-specific"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Specimen label="Variants">
          <div className="flex flex-wrap items-center gap-3">
            <Button>
              <SendIcon aria-hidden />
              Submit Inspection
            </Button>
            <Button variant="outline">Save Draft</Button>
            <Button variant="secondary">Start From Previous</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="destructive">
              <Trash2Icon aria-hidden />
              Delete Photo
            </Button>
            <Button variant="link">View Export</Button>
          </div>
        </Specimen>

        <Specimen label="Sizes (Desktop; All Are 44 px or More on iPad)">
          <div className="flex flex-wrap items-center gap-3">
            <Button size="xs">Extra Small</Button>
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon-sm" variant="outline" aria-label="Add">
              <PlusIcon aria-hidden />
            </Button>
            <Button size="icon" variant="outline" aria-label="Take Photo">
              <CameraIcon aria-hidden />
            </Button>
            <Button size="icon-lg" aria-label="Confirm">
              <CheckIcon aria-hidden />
            </Button>
          </div>
        </Specimen>

        <Specimen label="States">
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled>Disabled</Button>
            <Button variant="outline" disabled>
              Disabled
            </Button>
            <Button onClick={save} disabled={saving} aria-busy={saving}>
              {saving && <Spinner aria-hidden />}
              {saving ? "Saving…" : "Save (Try Me)"}
            </Button>
            {/* Shows the keyboard focus ring (focus-ring) without needing a keyboard. */}
            <Button tabIndex={-1} className="outline-solid outline-2 outline-offset-2 outline-ring">
              Focused
            </Button>
          </div>
        </Specimen>

        <Specimen label="Toasts (Status Colours)">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => toast.success("Inspection submitted")}>
              Success
            </Button>
            <Button variant="outline" onClick={() => toast.warning("Weight is 12% above the indicative weight")}>
              Warning
            </Button>
            <Button variant="outline" onClick={() => toast.error("Carton 253 is listed twice for size M")}>
              Error
            </Button>
            <Button variant="outline" onClick={() => toast.info("Steri-AI second opinion not connected")}>
              Info
            </Button>
          </div>
        </Specimen>
      </div>
    </DesignSection>
  );
}
