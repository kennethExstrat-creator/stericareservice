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
  CLIENT_FIELDS,
  IDLE,
  LIMITS,
  clientValues,
  followVersion,
  multiLine,
  oneLine,
  readForm,
  unreachable,
  type ClientField,
  type ClientItem,
  type Snapshot,
} from "@/lib/admin/reference";
import { DeleteSection } from "../../manufacturers/_components/reference-delete";
import { TextField } from "../../manufacturers/_components/reference-field";
import { ReferencePanel, type PanelTarget } from "../../manufacturers/_components/reference-panel";
import { deleteClient, saveClient, type SaveClientResult } from "../actions";
import { ClientLogo } from "./client-logo";

type Values = Record<ClientField, string>;
type FieldErrors = Partial<Record<ClientField, string>>;

/** Fields in the order they appear, so the first one with an error gets the focus. */
const FIELDS: readonly ClientField[] = ["name", "notes"];

/** The fields as the server stores them (ClientInputSchema cleans them the same way). */
const cleaned = (values: Values): Values => ({ name: oneLine(values.name), notes: multiLine(values.notes) });

const snapshotOf = (item: ClientItem): Snapshot<ClientField> => ({ version: item.updatedAt, values: clientValues(item) });

type ClientPanelProps = {
  open: boolean;
  target: PanelTarget;
  /** The row being edited as the page has it now, or null (adding, or deleted meanwhile). */
  item: ClientItem | null;
  onClose: () => void;
  /** A new client was added: the panel stays open on it, for the logo. */
  onCreated: (id: string) => void;
};

/** Add or edit one client, with its logo; deleting sits at the end of the edit panel. */
export function ClientPanel({ open, target, item, onClose, onCreated }: ClientPanelProps) {
  const id = useId();
  const formId = `${id}-form`;
  const editing = target.mode === "edit";

  // The version a save goes against, with the fields as they were at it: the
  // row as the panel opened on it (or added it). A newer copy of the row
  // moves it on only when the fields are unchanged, as after this panel's
  // own logo upload or removal. If someone else changed the name or notes,
  // the save is refused instead of quietly writing over their change.
  const [base, setBase] = useState<Snapshot<ClientField> | null>(() => (item ? snapshotOf(item) : null));
  // The last copy of the row this panel saw: it keeps showing while the
  // panel closes after a delete, when the row has already left the list.
  const [shown, setShown] = useState(item);
  if (item && item !== shown) {
    setShown(item);
    // No version yet only if a new client's answer came without one: start from the list's.
    const next = base ? followVersion(base, snapshotOf(item)) : editing ? snapshotOf(item) : null;
    if (next !== base) setBase(next);
  }
  // A client this panel has just added may reach the list a moment after the answer.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const gone = open && editing && !item && target.id !== createdId;

  const [values, setValues] = useState<Values>(() => clientValues(item));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [logoPending, setLogoPending] = useState(false);

  const [state, formAction, pending] = useActionState(
    async (previous: SaveClientResult, formData: FormData): Promise<SaveClientResult> => {
      const result: SaveClientResult = await saveClient(previous, formData).catch(unreachable);
      if (result.status === "success") {
        toast.success(result.message);
        if (editing || !result.id) {
          onClose();
        } else {
          // Stay on the new client, as saved, so its logo can go up next.
          if (result.version) setBase({ version: result.version, values: cleaned(readForm(formData, CLIENT_FIELDS)) });
          setValues(cleaned);
          setCreatedId(result.id);
          onCreated(result.id);
        }
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
  const saved = base?.values ?? clientValues(null);
  const dirty = FIELDS.some((field) => values[field] !== saved[field]);
  const formError = state.status === "error" && !state.fieldErrors ? state.message : null;
  const busy = pending || logoPending;

  function field(name: ClientField) {
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
      busy={busy}
      onClose={onClose}
      title={editing ? "Edit client" : "Add client"}
      description={
        editing
          ? "The name and logo as they should appear on reports."
          : "The name as it should read on reports. The logo comes next."
      }
      footer={
        gone ? (
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {dirty ? "Cancel" : "Close"}
            </Button>
            <Button type="submit" form={formId} disabled={busy}>
              {pending && <Spinner aria-hidden />}
              {pending ? (editing ? "Saving…" : "Adding…") : editing ? "Save changes" : "Add client"}
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
            <EmptyDescription>Someone has deleted this client.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <form id={formId} action={formAction} noValidate>
            <input type="hidden" name="id" value={editing ? target.id : ""} />
            <input type="hidden" name="version" value={editing ? (base?.version ?? "") : ""} />
            <FieldGroup className="gap-5">
              <TextField {...field("name")} label="Name" autoCapitalize="words" />
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
            <>
              <ClientLogo
                clientId={shown.id}
                clientName={shown.name}
                logo={shown.logo}
                onPendingChange={setLogoPending}
              />
              <DeleteSection
                kind="client"
                id={shown.id}
                name={shown.name}
                usage={shown.usage}
                action={deleteClient}
                alsoDeletes={shown.logo ? "Its logo is deleted too." : undefined}
                onDeleted={onClose}
              />
            </>
          )}
        </>
      )}
    </ReferencePanel>
  );
}
