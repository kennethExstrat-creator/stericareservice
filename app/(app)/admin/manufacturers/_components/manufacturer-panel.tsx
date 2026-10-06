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
  manufacturerLabel,
  unreachable,
  type ManufacturerField,
  type ManufacturerItem,
} from "@/lib/admin/reference";
import { deleteManufacturer, saveManufacturer, type SaveManufacturerResult } from "../actions";
import { DeleteSection } from "./reference-delete";
import { TextField } from "./reference-field";
import { ReferencePanel, type PanelTarget } from "./reference-panel";

type Values = Record<ManufacturerField, string>;
type FieldErrors = Partial<Record<ManufacturerField, string>>;

/** Fields in the order they appear, so the first one with an error gets the focus. */
const FIELDS: readonly ManufacturerField[] = ["name", "factory_name", "address", "country", "notes"];

function valuesOf(item: ManufacturerItem | null): Values {
  return {
    name: item?.name ?? "",
    factory_name: item?.factoryName ?? "",
    address: item?.address ?? "",
    country: item?.country ?? "",
    notes: item?.notes ?? "",
  };
}

type ManufacturerPanelProps = {
  open: boolean;
  target: PanelTarget;
  /** The row being edited as the page has it now, or null (adding, or deleted meanwhile). */
  item: ManufacturerItem | null;
  /** Suggestions for the country field. */
  countries: readonly string[];
  onClose: () => void;
};

/** Add or edit one manufacturer; deleting sits at the end of the edit panel. */
export function ManufacturerPanel({ open, target, item, countries, onClose }: ManufacturerPanelProps) {
  const id = useId();
  const formId = `${id}-form`;
  const editing = target.mode === "edit";

  // The last version of the row this panel saw: it keeps showing while the
  // panel closes after a delete, when the row has already left the list.
  const [shown, setShown] = useState(item);
  if (item && item !== shown) setShown(item);
  const gone = open && editing && !item;

  const [values, setValues] = useState<Values>(() => valuesOf(item));
  const [errors, setErrors] = useState<FieldErrors>({});

  const [state, formAction, pending] = useActionState(
    async (previous: SaveManufacturerResult, formData: FormData): Promise<SaveManufacturerResult> => {
      const result: SaveManufacturerResult = await saveManufacturer(previous, formData).catch(unreachable);
      if (result.status === "success") {
        toast.success(result.message);
        onClose();
      } else if (result.status === "error") {
        const fieldErrors = result.fieldErrors ?? {};
        setErrors(fieldErrors);
        const first = FIELDS.find((field) => fieldErrors[field]);
        if (first) document.getElementById(`${id}-${first}`)?.focus();
      }
      return result;
    },
    IDLE,
  );

  const saved = valuesOf(shown);
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
            <input type="hidden" name="version" value={editing ? (item?.updatedAt ?? "") : ""} />
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
              onDeleted={onClose}
            />
          )}
        </>
      )}
    </ReferencePanel>
  );
}
