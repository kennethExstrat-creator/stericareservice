"use client";

// Retag and caption one photo (BUILD_SPEC 8.1): the module it belongs to and
// the size, hand, defect, box, packaging level or list entry (a document, a
// loading stage) it shows, in the inspection's own wording.
// A photo still on this device is retagged in the upload queue (works
// offline); an uploaded one through the updatePhotoTags action. A refused
// save (a field error, no connection) keeps everything chosen and typed:
// every field is controlled, and the form is submitted by hand rather than
// through its action prop, because React resets a form after each form
// action and Radix Select and RadioGroup answer that reset by going back to
// their first value, controlled or not.
import { Fragment, startTransition, useActionState, useEffect, useId, useRef, useState } from "react";
import { OctagonXIcon } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { Textarea } from "@/components/ui/textarea";
import { IDLE_PHOTO_ACTION, type PhotoActionState } from "@/lib/inspections/photos/messages";
import { CAPTION_MAX_LENGTH } from "@/lib/inspections/photos/schemas";
import {
  defectChoices,
  itemName,
  levelName,
  moduleOption,
  moduleTitle,
  type ListChoice,
  type PhotoTagOptions,
} from "@/lib/inspections/photos/view";
import { parseTarget, type PhotoTarget } from "@/lib/photos/target";
import { savePhotoEdit } from "./edit-flows";
import type { SlotPhoto } from "./photo-model";

/** Select items cannot have an empty value; this one stands for "none". */
const NONE = "__none__";

const FOCUSABLE = "button, input, textarea, select, [tabindex]:not([tabindex='-1'])";

/** What a module's own list holds, as the field is named. */
const ITEM_FIELD_LABEL: Readonly<Record<string, string>> = { documents: "Document", loading: "Loading stage" };

type PhotoEditDialogProps = {
  inspectionId: string;
  photo: SlotPhoto;
  options: PhotoTagOptions;
  /** What the photo shows, for the title's screen-reader text. */
  alt: string;
  onClose: () => void;
};

export function PhotoEditDialog({ inspectionId, photo, options, alt, onClose }: PhotoEditDialogProps) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        // The slot puts focus back itself: the control that opened this may be gone.
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <EditForm inspectionId={inspectionId} photo={photo} options={options} alt={alt} onDone={onClose} onPendingChange={setPending} />
      </DialogContent>
    </Dialog>
  );
}

function EditForm({
  inspectionId,
  photo,
  options,
  alt,
  onDone,
  onPendingChange,
}: Omit<PhotoEditDialogProps, "onClose"> & { onDone: () => void; onPendingChange: (pending: boolean) => void }) {
  const id = useId();
  const initial = parseTarget(photo.target);
  const start: PhotoTarget = initial.ok ? initial.target : {};
  const [moduleKey, setModuleKey] = useState<string | null>(photo.moduleKey);
  const [size, setSize] = useState(start.size ?? "");
  const [hand, setHand] = useState(start.hand ?? "");
  const [defect, setDefect] = useState(start.defect ?? "");
  const [box, setBox] = useState(start.box !== undefined ? String(start.box) : "");
  const [level, setLevel] = useState<string>(start.level ?? "");
  const [item, setItem] = useState(start.item ?? "");
  const [caption, setCaption] = useState(photo.caption ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  /** Where focus was when Save was pressed (Save itself, or a field submitted with Enter). */
  const submittedFrom = useRef<HTMLElement | null>(null);

  const [state, formAction, pending] = useActionState(
    async (previous: PhotoActionState, formData: FormData): Promise<PhotoActionState> => {
      onPendingChange(true);
      try {
        const result = await savePhotoEdit(inspectionId, photo, previous, formData);
        if (result.status === "success") {
          toast.success(result.message);
          onDone();
        }
        return result;
      } finally {
        onPendingChange(false);
      }
    },
    IDLE_PHOTO_ACTION,
  );

  // A refused save: focus the first field to fix, else back where Save was pressed (it was disabled
  // meanwhile, which drops focus to the dialog), so the keyboard carries on from there.
  useEffect(() => {
    if (state.status !== "error") return;
    const form = formRef.current;
    if (!form) return;
    const invalid = form.querySelector<HTMLElement>('[aria-invalid="true"]');
    const field = invalid && (invalid.matches(FOCUSABLE) ? invalid : invalid.querySelector<HTMLElement>(FOCUSABLE));
    const from = submittedFrom.current;
    const back = from && from.isConnected && !from.matches(":disabled") ? from : null;
    (field ?? back ?? form.querySelector<HTMLElement>('button[type="submit"]'))?.focus();
  }, [state]);

  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const formError = state.status === "error" && !state.fieldErrors ? state.message : (errors.form ?? errors.photoId ?? null);
  const chosen = moduleOption(moduleKey, options);
  const records = new Set(chosen?.targetKeys ?? []);
  const showHand = records.has("hand") && (chosen?.handSplit === true || hand !== "");

  const moduleItems = options.modules.filter((entry) => entry.included || entry.key === photo.moduleKey);
  if (photo.moduleKey && !moduleItems.some((entry) => entry.key === photo.moduleKey)) {
    moduleItems.push({ key: photo.moduleKey, title: moduleTitle(photo.moduleKey, options), targetKeys: [], handSplit: false, included: false });
  }
  const sizeItems = [...options.sizes];
  if (size && !sizeItems.some((entry) => entry.value === size)) sizeItems.push({ value: size, label: size });
  const defects = defectChoices(moduleKey, defect, options);
  const levelItems: readonly ListChoice[] = (moduleKey ? options.levels?.[moduleKey] : undefined) ?? [
    { value: "inner", label: levelName(moduleKey, "inner", options) },
    { value: "carton", label: levelName(moduleKey, "carton", options) },
  ];
  const listItems: ListChoice[] = [...((moduleKey ? options.items?.[moduleKey] : undefined) ?? [])];
  // The photo's own entry stays choosable when the list no longer has it.
  if (item && !listItems.some((entry) => entry.value === item)) listItems.push({ value: item, label: itemName(moduleKey, item, options) });

  const described = (field: string, error?: string) => (error ? `${id}-${field}-error` : undefined);

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        // No action prop: see the note at the top of this file.
        event.preventDefault();
        if (pending) return;
        submittedFrom.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const formData = new FormData(event.currentTarget);
        startTransition(() => formAction(formData));
      }}
      noValidate
      className="grid gap-6"
    >
      <DialogHeader>
        <DialogTitle className="text-lg font-bold">
          Edit photo<span className="sr-only">: {alt}</span>
        </DialogTitle>
        <DialogDescription>
          Tag the photo with what it shows, and add a caption for the report.
          {photo.queued ? " It is still on this device, so the change is saved here and goes up with it." : null}
        </DialogDescription>
      </DialogHeader>

      <input type="hidden" name="photoId" value={photo.id} />
      <input type="hidden" name="moduleKey" value={moduleKey ?? ""} />
      {records.has("size") && <input type="hidden" name="size" value={size} />}
      {showHand && <input type="hidden" name="hand" value={hand} />}
      {records.has("defect") && <input type="hidden" name="defect" value={defect} />}
      {records.has("level") && <input type="hidden" name="level" value={level} />}
      {records.has("item") && <input type="hidden" name="item" value={item} />}

      <FieldGroup className="gap-5">
        <Field data-invalid={errors.moduleKey ? true : undefined}>
          <FieldLabel htmlFor={`${id}-module`}>Module</FieldLabel>
          <Select value={moduleKey ?? NONE} onValueChange={(value) => setModuleKey(value === NONE ? null : value)}>
            <SelectTrigger
              id={`${id}-module`}
              className="w-full"
              aria-invalid={errors.moduleKey ? true : undefined}
              aria-describedby={described("module", errors.moduleKey)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value={NONE}>Not tagged</SelectItem>
              {moduleItems.length > 0 && <SelectSeparator />}
              {moduleItems.map((entry) => (
                <SelectItem key={entry.key} value={entry.key}>
                  {entry.title}
                  {entry.included ? null : " (switched off)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.moduleKey && <FieldError id={`${id}-module-error`}>{errors.moduleKey}</FieldError>}
        </Field>

        {records.has("size") && (
          <Field data-invalid={errors.size ? true : undefined}>
            <FieldLabel htmlFor={`${id}-size`}>Size</FieldLabel>
            <Select value={size || NONE} onValueChange={(value) => setSize(value === NONE ? "" : value)}>
              <SelectTrigger
                id={`${id}-size`}
                className="w-full"
                aria-invalid={errors.size ? true : undefined}
                aria-describedby={described("size", errors.size)}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value={NONE}>No size</SelectItem>
                {sizeItems.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    {entry.label === entry.value ? entry.value : `${entry.label} (${entry.value})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.size && <FieldError id={`${id}-size-error`}>{errors.size}</FieldError>}
          </Field>
        )}

        {showHand && (
          <FieldSet className="gap-3" aria-describedby={described("hand", errors.hand)}>
            <FieldLegend variant="label" className="mb-0">
              Hand
            </FieldLegend>
            <RadioGroup
              value={hand || NONE}
              onValueChange={(value) => setHand(value === NONE ? "" : value)}
              aria-invalid={errors.hand ? true : undefined}
              className="flex flex-wrap gap-x-6 gap-y-3"
            >
              {[
                { value: NONE, label: "Not recorded" },
                { value: "R", label: "Right hand" },
                { value: "L", label: "Left hand" },
              ].map((option) => (
                <Field key={option.value} orientation="horizontal" className="w-auto">
                  <RadioGroupItem value={option.value} id={`${id}-hand-${option.value}`} />
                  <FieldLabel htmlFor={`${id}-hand-${option.value}`} className="font-normal">
                    {option.label}
                  </FieldLabel>
                </Field>
              ))}
            </RadioGroup>
            {errors.hand && <FieldError id={`${id}-hand-error`}>{errors.hand}</FieldError>}
          </FieldSet>
        )}

        {records.has("defect") && (
          <Field data-invalid={errors.defect ? true : undefined}>
            <FieldLabel htmlFor={`${id}-defect`}>Defect</FieldLabel>
            <Select value={defect || NONE} onValueChange={(value) => setDefect(value === NONE ? "" : value)}>
              <SelectTrigger
                id={`${id}-defect`}
                className="w-full"
                aria-invalid={errors.defect ? true : undefined}
                aria-describedby={described("defect", errors.defect)}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-72">
                <SelectItem value={NONE}>No defect</SelectItem>
                {defects.oneOff && (
                  <SelectItem value={defects.oneOff.value}>{defects.oneOff.label} (one-off label)</SelectItem>
                )}
                {/* The module's own defects first, in its wording; headings only when there are both lists. */}
                {defects.groups.map((group) => (
                  <Fragment key={group.key}>
                    <SelectSeparator />
                    <SelectGroup>
                      {defects.groups.length > 1 && (
                        <SelectLabel>{group.key === "module" ? (chosen?.title ?? "This module") : "Other defects"}</SelectLabel>
                      )}
                      {group.items.map((entry) => (
                        <SelectItem key={entry.value} value={entry.value}>
                          {entry.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </Fragment>
                ))}
              </SelectContent>
            </Select>
            {errors.defect && <FieldError id={`${id}-defect-error`}>{errors.defect}</FieldError>}
          </Field>
        )}

        {records.has("box") && (
          <Field data-invalid={errors.box ? true : undefined}>
            <FieldLabel htmlFor={`${id}-box`}>Box (carton number)</FieldLabel>
            <Input
              id={`${id}-box`}
              name="box"
              inputMode="numeric"
              autoComplete="off"
              value={box}
              onChange={(event) => setBox(event.target.value)}
              className="max-w-40"
              aria-invalid={errors.box ? true : undefined}
              aria-describedby={described("box", errors.box)}
            />
            {errors.box && <FieldError id={`${id}-box-error`}>{errors.box}</FieldError>}
          </Field>
        )}

        {records.has("level") && (
          <FieldSet className="gap-3" aria-describedby={described("level", errors.level)}>
            <FieldLegend variant="label" className="mb-0">
              Level
            </FieldLegend>
            <RadioGroup
              value={level || NONE}
              onValueChange={(value) => setLevel(value === NONE ? "" : value)}
              aria-invalid={errors.level ? true : undefined}
              className="flex flex-wrap gap-x-6 gap-y-3"
            >
              {[{ value: NONE, label: "Not recorded" }, ...levelItems].map((option) => (
                <Field key={option.value} orientation="horizontal" className="w-auto">
                  <RadioGroupItem value={option.value} id={`${id}-level-${option.value}`} />
                  <FieldLabel htmlFor={`${id}-level-${option.value}`} className="font-normal">
                    {option.label}
                  </FieldLabel>
                </Field>
              ))}
            </RadioGroup>
            {errors.level && <FieldError id={`${id}-level-error`}>{errors.level}</FieldError>}
          </FieldSet>
        )}

        {records.has("item") && (
          <Field data-invalid={errors.item ? true : undefined}>
            <FieldLabel htmlFor={`${id}-item`}>{ITEM_FIELD_LABEL[chosen?.key ?? ""] ?? "Item"}</FieldLabel>
            <Select value={item || NONE} onValueChange={(value) => setItem(value === NONE ? "" : value)}>
              <SelectTrigger
                id={`${id}-item`}
                className="w-full"
                aria-invalid={errors.item ? true : undefined}
                aria-describedby={described("item", errors.item)}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-72">
                <SelectItem value={NONE}>Not recorded</SelectItem>
                {listItems.length > 0 && <SelectSeparator />}
                {listItems.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.item && <FieldError id={`${id}-item-error`}>{errors.item}</FieldError>}
          </Field>
        )}

        <Field data-invalid={errors.caption ? true : undefined}>
          <FieldLabel htmlFor={`${id}-caption`}>Caption</FieldLabel>
          <Textarea
            id={`${id}-caption`}
            name="caption"
            rows={3}
            maxLength={CAPTION_MAX_LENGTH}
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            placeholder="What the photo shows, for the report"
            aria-invalid={errors.caption ? true : undefined}
            aria-describedby={errors.caption ? `${id}-caption-error` : `${id}-caption-hint`}
          />
          {errors.caption ? (
            <FieldError id={`${id}-caption-error`}>{errors.caption}</FieldError>
          ) : (
            <FieldDescription id={`${id}-caption-hint`}>Up to {CAPTION_MAX_LENGTH} characters.</FieldDescription>
          )}
        </Field>
      </FieldGroup>

      {formError && (
        <Alert variant="destructive">
          <OctagonXIcon aria-hidden />
          <AlertDescription className="text-destructive">{formError}</AlertDescription>
        </Alert>
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending && <Spinner aria-hidden />}
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
