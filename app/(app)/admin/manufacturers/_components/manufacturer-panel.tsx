"use client";

import { useActionState, useId, useState } from "react";
import { OctagonXIcon, SearchXIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { FieldGroup } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import {
  IDLE,
  LIMITS,
  followVersion,
  manufacturerLabel,
  manufacturerValues,
  unreachable,
  type ManufacturerField,
  type ManufacturerItem,
  type Snapshot,
} from "@/lib/admin/reference";
import { deleteManufacturer, saveManufacturer, type SaveManufacturerResult } from "../actions";
import { DeleteSection } from "./reference-delete";
import { TextField } from "./reference-field";
import { ReferencePanel, type PanelTarget } from "./reference-panel";

type Values = Record<ManufacturerField, string>;
type FieldErrors = Partial<Record<ManufacturerField, string>>;

/** Fields in the order they appear, so the first one with an error gets the focus. */
const FIELDS: readonly ManufacturerField[] = ["name", "factory_name", "address", "country", "notes"];

const snapshotOf = (item: ManufacturerItem): Snapshot<ManufacturerField> => ({
  version: item.updatedAt,
  values: manufacturerValues(item),
});

type ManufacturerPanelProps = {
  open: boolean;
  target: PanelTarget;
  /** The row being edited as the page has it now, or null (adding, or deleted meanwhile). */
  item: ManufacturerItem | null;
  /** Suggestions for the country field. */
  countries: readonly string[];
  onClose: () => void;
  /** The manufacturer was deleted: the panel closes, and its row (and Edit button) go. */
  onDeleted: () => void;
  returnFocus: () => void;
};

/** Add or edit one manufacturer; deleting sits at the end of the edit panel. */
export function ManufacturerPanel({
  open,
  target,
  item,
  countries,
  onClose,
  onDeleted,
  returnFocus,
}: ManufacturerPanelProps) {
  const id = useId();
  const formId = `${id}-form`;
  const editing = target.mode === "edit";

  // The version a save goes against, with the fields as they were at it: the
  // row as the panel opened on it. A newer copy of the row (the page
  // refreshes after any save or delete here) moves it on only when its
  // fields are unchanged; otherwise the save is refused, never quietly
  // written over someone else's change.
  const [base, setBase] = useState<Snapshot<ManufacturerField> | null>(() => (item ? snapshotOf(item) : null));
  // The last copy of the row this panel saw: it keeps showing while the
  // panel closes after a delete, when the row has already left the list.
  const [shown, setShown] = useState(item);
  if (item && item !== shown) {
    setShown(item);
    if (base) {
      const next = followVersion(base, snapshotOf(item));
      if (next !== base) setBase(next);
    }
  }
  const gone = open && editing && !item;

  const [values, setValues] = useState<Values>(() => manufacturerValues(item));
  const [errors, setErrors] = useState<FieldErrors>({});

  const [state, formAction, pending] = useActionState(
    async (previous: SaveManufacturerResult, formData: FormData): Promise<SaveManufacturerResult> => {
      const result: SaveManufacturerResult = await saveManufacturer(previous, formData).catch(unreachable);
      if (result.status === "success") {
        toast.success(result.message);
        onClose();
      } else if (result.status === "error") {
        // Refused over someone else's change: a second save replaces it, as the message offers.
        if (result.latest) setBase(result.latest);
        const fieldErrors = result.fieldErrors ?? {};
        setErrors(fieldErrors);
        const first = FIELDS.find((field) => fieldErrors[field]);
        if (first) document.getElementById(`${id}-${first}`)?.focus();
      }
      return result;
    },
    IDLE,
  );

  // Against what the panel opened on, not the latest copy: someone else's
  // change is not something typed here.
  const saved = base?.values ?? manufacturerValues(null);
  const dirty = FIELDS.some((field) => values[field] !== saved[field]);
  const formError = state.status === "error" && !state.fieldErrors ? state.message : null;

  function field(name: ManufacturerField) {
    return {
      id: `${id}-${name}`,
      name,
      value: values[name],
      error: errors[name],
      maxLength: LIMITS[name],
      onValueChange: (value: string) => {
        setValues((current) => ({ ...current, [name]: value }));
        if (errors[name]) setErrors((current) => ({ ...current, [name]: undefined }));
      },
    };
  }

  return (
    <ReferencePanel
      open={open}
      busy={pending}
      onClose={onClose}
      returnFocus={returnFocus}
      title={editing ? "Edit manufacturer" : "Add manufacturer"}
      description="Name and address as they should read in report headers."
      footer={
        gone ? (
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              {dirty ? "Cancel" : "Close"}
            </Button>
            <Button type="submit" form={formId} disabled={pending}>
              {pending && <Spinner aria-hidden />}
              {pending ? (editing ? "Saving…" : "Adding…") : editing ? "Save changes" : "Add manufacturer"}
            </Button>
          </>
        )
      }
    >
      {gone ? (
        <Empty className="border border-dashed border-border p-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>No longer on the list</EmptyTitle>
            <EmptyDescription>Someone has deleted this manufacturer.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <form id={formId} action={formAction} noValidate>
            <input type="hidden" name="id" value={editing ? target.id : ""} />
            <input type="hidden" name="version" value={editing ? (base?.version ?? "") : ""} />
            <FieldGroup className="gap-5">
              <TextField {...field("name")} label="Name" autoCapitalize="words" />
              <TextField
                {...field("factory_name")}
                label="Factory"
                autoCapitalize="words"
                description="For a company with several plants, e.g. TG Factory 40."
              />
              <TextField {...field("address")} label="Address" multiline />
              <TextField {...field("country")} label="Country" autoCapitalize="words" list={`${id}-countries`} />
              <datalist id={`${id}-countries`}>
                {countries.map((country) => (
                  <option key={country} value={country} />
                ))}
              </datalist>
              <TextField {...field("notes")} label="Notes" multiline description="For admins. Not part of reports." />
            </FieldGroup>

            {/* role="alert": read out as soon as it appears. */}
            {formError && (
              <Alert variant="destructive" className="mt-5">
                <OctagonXIcon aria-hidden />
                <AlertDescription className="text-destructive">{formError}</AlertDescription>
              </Alert>
            )}
          </form>

          {editing && shown && (
            <DeleteSection
              kind="manufacturer"
              id={shown.id}
              name={manufacturerLabel(shown)}
              usage={shown.usage}
              action={deleteManufacturer}
              onDeleted={onDeleted}
            />
          )}
        </>
      )}
    </ReferencePanel>
  );
}
