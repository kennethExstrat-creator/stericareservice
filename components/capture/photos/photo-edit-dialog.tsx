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
// their first value, controlled or not. The caption typed is kept in the tab
// until it is saved or cancelled (lib/drafts/tab-draft.ts), so a reload loses
// nothing.
import { Fragment, startTransition, useActionState, useContext, useEffect, useId, useRef, useState, type RefObject } from "react";
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
import { readTextDraft, useTabDraft, writeTextDraft } from "@/lib/drafts/tab-draft";
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
// The loading module's own caption for its stage picker: its config only, no module code.
import { LOADING_LABELS } from "@/modules/loading/config";
import { savePhotoEdit } from "./edit-flows";
import { PhotoUserContext } from "./hooks";
import type { SlotPhoto } from "./photo-model";

/** Select items cannot have an empty value; this one stands for "none". */
const NONE = "__none__";

const FOCUSABLE = "button, input, textarea, select, [tabindex]:not([tabindex='-1'])";

/**
 * What a module's own list holds, as the field is named: loading's stage
 * picker by the module's own caption, word for word as lib/coverage lists it
 * (the tag options do not carry a template's rewording of it); a documents
 * checklist entry in the app's word.
 */
const ITEM_FIELD_LABEL: Readonly<Record<string, string>> = { documents: "Document", loading: LOADING_LABELS.loadingStage };

/** The choice for a tag the photo does not have: no hand, level or list entry recorded. */
const NOT_RECORDED = "Not Recorded";

/** After a module switched off for this inspection, in the module list. */
const SWITCHED_OFF_NOTE = "(Switched Off)";

type PhotoEditDialogProps = {
  inspectionId: string;
  photo: SlotPhoto;
  options: PhotoTagOptions;
  /** What the photo shows, for the title's screen-reader text. */
  alt: string;
  onClose: () => void;
};

/** The caption a user is typing for one photo, which keeps its id from this device's queue to the server. */
export function captionDraftKey(userId: string, photoId: string): string {
  return `stericare:photo-draft:caption:${userId}:${photoId}`;
}

/** The caption as typed, as a draft: none while it reads as the photo's saved caption. */
export function captionDraft(typed: string, saved: string | null): string | null {
  return typed === (saved ?? "") ? null : typed;
}

export function PhotoEditDialog({ inspectionId, photo, options, alt, onClose }: PhotoEditDialogProps) {
  const [pending, setPending] = useState(false);
  // The caption as typed, kept in the tab for this user and photo: after a
  // reload it is back when the dialog opens. The user is the one the page
  // names for its photo queue (PhotoQueueProvider); without one, only the
  // field keeps the caption.
  const userId = useContext(PhotoUserContext);
  const [draft, setDraft, forgetDraft] = useTabDraft(
    userId === null ? null : captionDraftKey(userId, photo.id),
    readTextDraft,
    writeTextDraft,
  );
  const captionRef = useRef<HTMLTextAreaElement>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open || pending) return;
        // Cancelled (Cancel, Escape, a tap outside): the caption typed goes with it.
        setDraft(null);
        onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        // A caption brought back from before a reload: it takes focus, and goes on where it stopped.
        onOpenAutoFocus={(event) => {
          const field = captionRef.current;
          if (draft === null || !field) return;
          event.preventDefault();
          field.focus();
          field.setSelectionRange(field.value.length, field.value.length);
        }}
        // The slot puts focus back itself: the control that opened this may be gone.
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <EditForm
          inspectionId={inspectionId}
          photo={photo}
          options={options}
          alt={alt}
          caption={draft ?? photo.caption ?? ""}
          captionRef={captionRef}
          onCaptionChange={(typed) => setDraft(captionDraft(typed, photo.caption))}
          onDone={() => {
            // Saved: the caption is the photo's now, no longer a draft.
            forgetDraft();
            onClose();
          }}
          onPendingChange={setPending}
        />
      </DialogContent>
    </Dialog>
  );
}

function EditForm({
  inspectionId,
  photo,
  options,
  alt,
  caption,
  captionRef,
  onCaptionChange,
  onDone,
  onPendingChange,
}: Omit<PhotoEditDialogProps, "onClose"> & {
  /** The caption as typed so far, before a reload too. */
  caption: string;
  captionRef: RefObject<HTMLTextAreaElement | null>;
  onCaptionChange: (caption: string) => void;
  onDone: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
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
          Edit Photo<span className="sr-only">: {alt}</span>
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
              <SelectItem value={NONE}>Not Tagged</SelectItem>
              {moduleItems.length > 0 && <SelectSeparator />}
              {moduleItems.map((entry) => (
                <SelectItem key={entry.key} value={entry.key}>
                  {entry.title}
                  {entry.included ? null : ` ${SWITCHED_OFF_NOTE}`}
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
                <SelectItem value={NONE}>No Size</SelectItem>
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
            {/* A fieldset's legend is no flex item, so the FieldSet's gap never reaches it: its own mb-3
                keeps the 12 px a Field has between label and control, and leading-snug the FieldLabel's line. */}
            <FieldLegend variant="label" className="leading-snug">
              Hand
            </FieldLegend>
            <RadioGroup
              value={hand || NONE}
              onValueChange={(value) => setHand(value === NONE ? "" : value)}
              aria-invalid={errors.hand ? true : undefined}
              className="flex flex-wrap gap-x-6 gap-y-3"
            >
              {[
                { value: NONE, label: NOT_RECORDED },
                { value: "R", label: "Right Hand" },
                { value: "L", label: "Left Hand" },
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
                <SelectItem value={NONE}>No Defect</SelectItem>
                {defects.oneOff && (
                  <SelectItem value={defects.oneOff.value}>{defects.oneOff.label} (One-Off Label)</SelectItem>
                )}
                {/* The module's own defects first, in its wording; headings only when there are both lists. */}
                {defects.groups.map((group) => (
                  <Fragment key={group.key}>
                    <SelectSeparator />
                    <SelectGroup>
                      {defects.groups.length > 1 && (
                        <SelectLabel>{group.key === "module" ? (chosen?.title ?? "This Module") : "Other Defects"}</SelectLabel>
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
            <FieldLabel htmlFor={`${id}-box`}>Box (Carton Number)</FieldLabel>
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
            {/* As Hand's: the legend's own margin, not the FieldSet's gap, keeps it off the choices. */}
            <FieldLegend variant="label" className="leading-snug">
              Level
            </FieldLegend>
            <RadioGroup
              value={level || NONE}
              onValueChange={(value) => setLevel(value === NONE ? "" : value)}
              aria-invalid={errors.level ? true : undefined}
              className="flex flex-wrap gap-x-6 gap-y-3"
            >
              {[{ value: NONE, label: NOT_RECORDED }, ...levelItems].map((option) => (
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
                <SelectItem value={NONE}>{NOT_RECORDED}</SelectItem>
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
            ref={captionRef}
            id={`${id}-caption`}
            name="caption"
            rows={3}
            maxLength={CAPTION_MAX_LENGTH}
            value={caption}
            onChange={(event) => onCaptionChange(event.target.value)}
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
