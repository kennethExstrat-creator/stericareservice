"use client";

import { useActionState, useId, useRef, useState } from "react";
import { InfoIcon, OctagonXIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  CLASS_LABEL,
  CODE_RULE,
  IDLE,
  LIMITS,
  MESSAGES,
  failed,
  foundSummary,
  normaliseCode,
  templateVersionLabel,
  unreachable,
  whereLabel,
  type InspectionLabels,
  type LabelTarget,
  type MapField,
  type OneOffLabel,
} from "@/lib/admin/defects";
import { submitAction } from "@/lib/admin/submit";
import { RadioCard } from "../../_components/radio-card";
import { mapDefectLabel, type MapLabelResult } from "../actions";
import { TextField } from "./text-field";

/** An active code the label can be mapped to. */
export type CodeOption = { code: string; name: string };

type Mode = "existing" | "new";
type FieldErrors = Partial<Record<MapField, string>>;

const MODES: { value: Mode; title: string; description: string }[] = [
  { value: "existing", title: "An Existing Code", description: "One of the active codes." },
  { value: "new", title: "A New Code", description: "Add a code for this label first." },
];

/** The fields of each mode in the order they appear, so the first one with an error takes the focus. */
const FIELDS: Record<Mode, readonly MapField[]> = { existing: ["code"], new: ["newCode", "name", "description"] };

function CodeItem({ option }: { option: CodeOption }) {
  return (
    <SelectItem value={option.code}>
      <span>{option.name}</span>
      <span className="font-mono text-xs text-muted-foreground">{option.code}</span>
    </SelectItem>
  );
}

/** A note under a field: what a choice means beyond the field itself. */
function Note({ children }: { children: string }) {
  return (
    <p className="flex gap-2 text-sm text-muted-foreground" data-note>
      <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * What the template lacks when the label counts as `code`: a code outside
 * the list where the label was recorded still counts, as an extra row on the
 * inspection, but inspectors can only tap it once the template lists it.
 */
function offListNote(inspection: InspectionLabels, label: OneOffLabel, choice: CodeOption | null): string | null {
  if (label.listed.length === 0 || (choice && label.listed.includes(choice.code))) return null;
  const list =
    label.defectClass === null ? "hole locations" : `${CLASS_LABEL[label.defectClass].toLowerCase()} defects`;
  const subject = choice ? `${choice.name} (${choice.code}) is not` : "A new code is not";
  return `${subject} one of ${templateVersionLabel(inspection.template)}’s ${list}. It still counts, as an extra row on the inspection; add it in the template editor so inspectors can tap it next time.`;
}

/**
 * Map one one-off label to a code, in every size and hand it was counted in:
 * an active code (the likeliest first), or a new one added from the label.
 * The Server Action records it on the inspection's data, so the label counts
 * with that code from then on.
 */
export function MapLabelDialog({
  inspection,
  label,
  codes,
  onClose,
  returnFocus,
}: {
  inspection: InspectionLabels;
  label: OneOffLabel;
  codes: readonly CodeOption[];
  onClose: () => void;
  /** Puts the keyboard back once the dialog has closed; `mapped` when the label's row is about to go. */
  returnFocus: (mapped: boolean) => void;
}) {
  const id = useId();
  const mapped = useRef(false);
  const [mode, setMode] = useState<Mode>("existing");
  const [code, setCode] = useState("");
  const [values, setValues] = useState({
    newCode: label.newCode,
    name: label.label.slice(0, LIMITS.name),
    description: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});

  const suggested = label.suggestions.flatMap((value) => codes.filter((option) => option.code === value));
  const others = codes.filter((option) => !label.suggestions.includes(option.code));

  const [state, formAction, pending] = useActionState(
    async (previous: MapLabelResult, formData: FormData): Promise<MapLabelResult> => {
      // Nothing chosen yet: say so here, without a trip to the server.
      const result: MapLabelResult =
        formData.get("mode") === "existing" && !formData.get("code")
          ? failed<MapField>(MESSAGES.checkFields, { code: "Choose a code." })
          : await mapDefectLabel(previous, formData).catch(unreachable);
      if (result.status === "success") {
        mapped.current = true;
        toast.success(result.message);
        onClose();
      } else if (result.status === "warning") {
        toast.warning(result.message, { duration: 12_000 });
        onClose();
      } else if (result.status === "error") {
        const fieldErrors = result.fieldErrors ?? {};
        setErrors(fieldErrors);
        const first = FIELDS[mode].find((field) => fieldErrors[field]);
        if (first) document.getElementById(`${id}-${first}`)?.focus();
      }
      return result;
    },
    IDLE,
  );

  const formError = state.status === "error" && !state.fieldErrors ? state.message : null;
  const target: LabelTarget = { module: label.module, kind: label.kind, defectClass: label.defectClass, label: label.label };
  // Shown once a code is chosen, or always for a new code: the template does not list it yet.
  const chosen = codes.find((option) => option.code === code) ?? null;
  const note = mode === "existing" ? (chosen ? offListNote(inspection, label, chosen) : null) : offListNote(inspection, label, null);

  function field(name: "newCode" | "name" | "description") {
    return {
      id: `${id}-${name}`,
      name,
      value: values[name],
      error: errors[name],
      maxLength: name === "newCode" ? LIMITS.code : LIMITS[name],
      onValueChange: (value: string) => {
        setValues((current) => ({ ...current, [name]: value }));
        if (errors[name]) setErrors((current) => ({ ...current, [name]: undefined }));
      },
    };
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      {/* Header and buttons stay put; only the fields scroll when the screen is short (iPad landscape). */}
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          // Opened from code, so Radix has no Trigger to go back to.
          event.preventDefault();
          returnFocus(mapped.current);
        }}
      >
        {/* Submitted by hand: React resets a form after its action, and the mode and the code would go back to
            their first values on that reset, so a refused mapping keeps every choice (lib/admin/submit.ts). */}
        <form onSubmit={submitAction(formAction, pending)} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="border-b border-border px-6 pt-6 pb-5">
            <DialogTitle className="pr-8 text-lg font-bold [overflow-wrap:anywhere]">Map “{label.label}”</DialogTitle>
            <DialogDescription>
              {inspection.refNo} · {whereLabel(label)} · {foundSummary(label, inspection.sizes)}.{" "}
              {label.kind === "other"
                ? "These holes count as Hole, other location until you map them; then they count as the code you choose."
                : "From then on it counts as the code you choose, in every size where it was found."}
            </DialogDescription>
          </DialogHeader>

          {/* Relative, so screen-reader-only text inside stays anchored in the scroller. */}
          <div className="relative flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
            <input type="hidden" name="inspectionId" value={inspection.id} />
            <input type="hidden" name="target" value={JSON.stringify(target)} />
            <input type="hidden" name="mode" value={mode} />

            <FieldSet className="gap-3">
              <FieldLegend variant="label" className="mb-0">
                Map to
              </FieldLegend>
              <RadioGroup
                value={mode}
                onValueChange={(value) => {
                  setMode(value as Mode);
                  setErrors({});
                }}
                className="grid gap-3 sm:grid-cols-2"
              >
                {MODES.map((option) => (
                  <RadioCard
                    key={option.value}
                    id={`${id}-mode-${option.value}`}
                    value={option.value}
                    title={option.title}
                    description={option.description}
                  />
                ))}
              </RadioGroup>
            </FieldSet>

            {mode === "existing" ? (
              <Field data-invalid={errors.code ? true : undefined} className="gap-2">
                <FieldLabel htmlFor={`${id}-code`}>Defect Code</FieldLabel>
                <Select
                  name="code"
                  value={code}
                  onValueChange={(value) => {
                    setCode(value);
                    if (errors.code) setErrors((current) => ({ ...current, code: undefined }));
                  }}
                >
                  <SelectTrigger
                    id={`${id}-code`}
                    className="w-full"
                    aria-invalid={errors.code ? true : undefined}
                    aria-describedby={`${id}-code-description${errors.code ? ` ${id}-code-error` : ""}`}
                  >
                    <SelectValue placeholder="Choose a code" />
                  </SelectTrigger>
                  <SelectContent position="popper" className="max-h-80">
                    {suggested.length > 0 && (
                      <>
                        <SelectGroup>
                          <SelectLabel>Suggested</SelectLabel>
                          {suggested.map((option) => (
                            <CodeItem key={option.code} option={option} />
                          ))}
                        </SelectGroup>
                        <SelectSeparator />
                      </>
                    )}
                    <SelectGroup>
                      <SelectLabel>{suggested.length > 0 ? "Every Other Active Code" : "Active Codes"}</SelectLabel>
                      {others.map((option) => (
                        <CodeItem key={option.code} option={option} />
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription id={`${id}-code-description`}>
                  {suggested.length > 0
                    ? `Suggested from the label’s words: ${suggested.map((option) => option.name).join(", ")}.`
                    : "Inactive codes are not offered."}
                </FieldDescription>
                {errors.code && <FieldError id={`${id}-code-error`}>{errors.code}</FieldError>}
                {note && <Note>{note}</Note>}
              </Field>
            ) : (
              <FieldGroup className="gap-5">
                <TextField
                  {...field("newCode")}
                  label="Code"
                  code
                  onCommit={(value) => setValues((current) => ({ ...current, newCode: normaliseCode(value) }))}
                  description={`${CODE_RULE} It cannot change once saved.`}
                />
                <TextField {...field("name")} label="Name" />
                <TextField {...field("description")} label="Description" multiline description="Optional." />
                {note && <Note>{note}</Note>}
              </FieldGroup>
            )}

            {/* role="alert": read out as soon as it appears. */}
            {formError && (
              <Alert variant="destructive">
                <OctagonXIcon aria-hidden />
                <AlertDescription className="text-destructive">{formError}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter className="border-t border-border px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner aria-hidden />}
              {pending ? "Mapping…" : mode === "new" ? "Add Code and Map" : "Map Label"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
