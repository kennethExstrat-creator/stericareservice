"use client";

// New Client and New Manufacturer, in Source Documents' summary where it said
// "“X” is not in the client list" (docs/AI.md, "Reading order documents";
// Kenneth, 27 October 2026: "the Steri AI should be able to read doc to use
// existing client and manufacturer or create new one"). A document's client
// or manufacturer that neither list has shows as new, with what the document
// prints filled in and editable, and one tap on Add adds it and chooses it
// (../reference-actions.ts): never without that tap. Before the tap, each
// says what Add will do, comparing the names with the lists as the server
// does (lib/inspections/reference-match.ts): a name that reads like a listed
// one is chosen, not added again, and a manufacturer's listed brand or
// company is reused, only what is missing added.
//
// They sit inside the form: Enter in a field adds (it would otherwise submit
// Create Inspection), and the fields have no name, so Create never posts
// them. iPad first: 44 px fields and buttons, 16 px text; the manufacturer's
// fields go two to a row once the summary is 36rem wide.
import { PlusIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { countrySuggestions } from "@/lib/admin/manufacturers";
import { fieldErrors, LIMITS } from "@/lib/admin/reference";
import {
  directoryOptions,
  findByName,
  planManufacturer,
  type ManufacturerDirectory,
  type ManufacturerFields,
} from "@/lib/inspections/reference-match";
import { cn } from "@/lib/utils";
import {
  CHECK_FIELDS,
  clientListedHint,
  NewClientSchema,
  NewManufacturerSchema,
  planWords,
  SEVERAL_CLIENTS,
  UNREACHABLE,
  type AddClientResult,
  type AddManufacturerResult,
  type ClientAdded,
  type ManufacturerAdded,
  type NewManufacturerField,
} from "../_lib/new-entries";
import type { Option } from "../_lib/types";
import { addClientFromDocument, addManufacturerFromDocument } from "../reference-actions";

/** As the summary's own titles (Filled In, Added on Create). */
const TITLE = "text-xs font-semibold tracking-wide text-muted-foreground uppercase";

/** An Add that never got an answer (dropped Wi-Fi, a new deployment) comes back as a message. */
async function reach<Result>(add: () => Promise<Result>): Promise<Result | { status: "error"; message: string }> {
  try {
    return await add();
  } catch (error) {
    console.error(error);
    return { status: "error", message: UNREACHABLE };
  }
}

/** Enter adds instead of submitting the form around it; not while an input method is composing a word. */
function isAddKey(event: KeyboardEvent<HTMLInputElement>): boolean {
  if (event.key !== "Enter" || event.nativeEvent.isComposing) return false;
  event.preventDefault();
  return true;
}

function Unlisted({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2">
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
      <span className="min-w-0 break-words text-warn">{children}</span>
    </p>
  );
}

type EntryFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: { text: string; warn: boolean } | null;
  maxLength: number;
  /** The id of a <datalist> of the names already listed. */
  list?: string;
  multiline?: boolean;
  onEnter: () => void;
  className?: string;
};

/** A labelled field with its hint or error below (docs/DESIGN.md, Field). No name: Create never posts it. */
function EntryField({ id, label, value, onChange, error, hint, maxLength, list, multiline = false, onEnter, className }: EntryFieldProps) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const shared = {
    id,
    value,
    maxLength,
    autoComplete: "off",
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
  } as const;
  return (
    <Field data-invalid={error ? true : undefined} className={cn("gap-2", className)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {multiline ? (
        <Textarea {...shared} rows={3} className="min-h-16" autoCapitalize="words" onChange={(event) => onChange(event.target.value)} />
      ) : (
        <Input
          {...shared}
          list={list}
          autoCapitalize="words"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (isAddKey(event)) onEnter();
          }}
        />
      )}
      {error ? (
        <FieldError id={`${id}-error`}>{error}</FieldError>
      ) : (
        hint && (
          <FieldDescription id={`${id}-hint`} className={hint.warn ? "text-warn" : undefined}>
            {hint.text}
          </FieldDescription>
        )
      )}
    </Field>
  );
}

function AddButton({ label, pending, disabled, describedBy, onClick }: { label: string; pending: boolean; disabled: boolean; describedBy?: string; onClick: () => void }) {
  return (
    <Button type="button" className="self-start" disabled={disabled || pending} aria-describedby={describedBy} onClick={onClick}>
      {pending ? <Spinner aria-hidden /> : <PlusIcon aria-hidden />}
      {pending ? "Adding…" : label}
    </Button>
  );
}

/* ------------------------------------------------------------------ *
 * New Client
 * ------------------------------------------------------------------ */

type NewClientEntryProps = {
  /** The client's name as the document prints it. */
  printed: string;
  /** The client picker's options: a name that reads like one of them is that client. */
  clients: readonly Option[];
  /** Create is under way. */
  disabled: boolean;
  onAdded: (result: ClientAdded) => void;
};

export function NewClientEntry({ printed, clients, disabled, onAdded }: NewClientEntryProps) {
  const id = useId();
  const [name, setName] = useState(printed);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const found = findByName(name, clients, (client) => client.label);
  const hint =
    found.kind === "one"
      ? { text: clientListedHint(found.entry.label), warn: false }
      : found.kind === "several"
        ? { text: SEVERAL_CLIENTS, warn: true }
        : null;

  function refuse(why: string) {
    setError(why);
    input.current?.focus();
  }

  async function add() {
    if (pending) return;
    setMessage(null);
    const parsed = NewClientSchema.safeParse({ name });
    if (!parsed.success) return refuse(fieldErrors(parsed.error).name ?? CHECK_FIELDS);
    if (found.kind === "several") return refuse(SEVERAL_CLIENTS);
    setError(null);
    setPending(true);
    const result: AddClientResult = await reach(() => addClientFromDocument({ name }));
    setPending(false);
    if (result.status !== "error") return onAdded(result);
    if (result.fieldErrors?.name) refuse(result.fieldErrors.name);
    else setMessage(result.message);
  }

  return (
    <section aria-labelledby={`${id}-title`} aria-busy={pending || undefined} className="flex flex-col gap-2" data-testid="new-client">
      <h3 id={`${id}-title`} className={TITLE}>
        New Client
      </h3>
      <Unlisted>“{printed}” is not in the client list.</Unlisted>
      <Field data-invalid={error ? true : undefined} className="gap-2">
        <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
        <Input
          ref={input}
          id={`${id}-name`}
          value={name}
          maxLength={LIMITS.name}
          autoComplete="off"
          autoCapitalize="words"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-name-error` : hint ? `${id}-name-hint` : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (isAddKey(event)) void add();
          }}
        />
        {error ? (
          <FieldError id={`${id}-name-error`}>{error}</FieldError>
        ) : (
          hint && (
            <FieldDescription id={`${id}-name-hint`} className={hint.warn ? "text-warn" : undefined}>
              {hint.text}
            </FieldDescription>
          )
        )}
      </Field>
      {message && (
        <p role="alert" className="text-destructive">
          {message}
        </p>
      )}
      <AddButton label="Add Client" pending={pending} disabled={disabled} onClick={() => void add()} />
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * New Manufacturer
 * ------------------------------------------------------------------ */

/** In the order the fields are laid out, for focus. */
const MANUFACTURER_FIELDS = ["brand", "company", "factory", "country", "address"] as const satisfies readonly NewManufacturerField[];

const BY_NAME = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

/** The countries the factories have, with the common ones (as Admin > Manufacturers suggests them), each once, by name. */
function countriesOf(directory: ManufacturerDirectory): string[] {
  const seen = new Map<string, string>();
  for (const country of [...directory.factories.map((factory) => factory.country), ...countrySuggestions([])]) {
    if (country && !seen.has(country.toLowerCase())) seen.set(country.toLowerCase(), country);
  }
  return [...seen.values()].sort(BY_NAME.compare);
}

type NewManufacturerEntryProps = {
  /** The manufacturer as the document prints it. */
  printed: string;
  /** The fields as the document fills them (manufacturerDraft). */
  draft: ManufacturerFields;
  /** The brands, companies and factories listed: what is reused, and the names suggested. */
  directory: ManufacturerDirectory;
  /** Create is under way. */
  disabled: boolean;
  onAdded: (result: ManufacturerAdded) => void;
};

export function NewManufacturerEntry({ printed, draft, directory, disabled, onAdded }: NewManufacturerEntryProps) {
  const id = useId();
  const [values, setValues] = useState(draft);
  const [errors, setErrors] = useState<Partial<Record<NewManufacturerField, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const labels = useMemo(() => new Map(directoryOptions(directory).map((option) => [option.id, option.label])), [directory]);
  const countries = useMemo(() => countriesOf(directory), [directory]);
  const label = (factoryId: string) => labels.get(factoryId) ?? "";
  // What Add will do, once the fields would be accepted: under the buttons, or under the field that stops it.
  const parsed = NewManufacturerSchema.safeParse(values);
  const plan = parsed.success ? planManufacturer(parsed.data, directory) : null;
  const words = plan ? planWords(plan, label) : null;
  const hintFor = (key: NewManufacturerField) => (words?.field === key ? { text: words.text, warn: true } : null);

  function refuse(found: Partial<Record<NewManufacturerField, string>>) {
    setErrors(found);
    const first = MANUFACTURER_FIELDS.find((field) => found[field]);
    if (first) document.getElementById(`${id}-${first}`)?.focus();
  }

  async function add() {
    if (pending) return;
    setMessage(null);
    if (!parsed.success) return refuse(fieldErrors(parsed.error));
    if (words?.field) return refuse({ [words.field]: words.text });
    setErrors({});
    setPending(true);
    const result: AddManufacturerResult = await reach(() => addManufacturerFromDocument(values));
    setPending(false);
    if (result.status !== "error") return onAdded(result);
    if (result.fieldErrors && Object.keys(result.fieldErrors).length > 0) refuse(result.fieldErrors);
    else setMessage(result.message);
  }

  const field = (key: NewManufacturerField) => ({
    id: `${id}-${key}`,
    value: values[key],
    error: errors[key],
    hint: hintFor(key),
    onChange: (value: string) => {
      setValues((current) => ({ ...current, [key]: value }));
      setErrors((current) => ({ ...current, [key]: undefined }));
    },
    onEnter: () => void add(),
  });

  return (
    <section
      aria-labelledby={`${id}-title`}
      aria-busy={pending || undefined}
      // A size container: the fields two to a row once the summary is wide enough.
      className="@container flex flex-col gap-2"
      data-testid="new-manufacturer"
    >
      <h3 id={`${id}-title`} className={TITLE}>
        New Manufacturer
      </h3>
      <Unlisted>“{printed}” is not in the manufacturer list.</Unlisted>
      {/* One field a row in a narrow summary (beside the files on a wide card); from 36rem the brand beside the
          company, which gets the room a registered name needs, and the factory beside the country. */}
      <div className="grid gap-3 @xl:grid-cols-6">
        <EntryField
          {...field("brand")}
          hint={hintFor("brand") ?? { text: "Choose a listed brand, or type a new one.", warn: false }}
          label="Brand"
          maxLength={LIMITS.name}
          list={`${id}-brands`}
          className="@xl:col-span-2"
        />
        <EntryField {...field("company")} label="Company" maxLength={LIMITS.name} list={`${id}-companies`} className="@xl:col-span-4" />
        <EntryField {...field("factory")} label="Factory (Optional)" maxLength={LIMITS.factory_name} className="@xl:col-span-3" />
        <EntryField {...field("country")} label="Country" maxLength={LIMITS.country} list={`${id}-countries`} className="@xl:col-span-3" />
        <EntryField {...field("address")} label="Address" maxLength={LIMITS.address} multiline className="@xl:col-span-6" />
      </div>
      <datalist id={`${id}-brands`}>
        {directory.brands.map((brand) => (
          <option key={brand.id} value={brand.name} />
        ))}
      </datalist>
      <datalist id={`${id}-companies`}>
        {directory.companies.map((company) => (
          <option key={company.id} value={company.name} />
        ))}
      </datalist>
      <datalist id={`${id}-countries`}>
        {countries.map((country) => (
          <option key={country} value={country} />
        ))}
      </datalist>
      {words && !words.field && (
        <p id={`${id}-plan`} className="text-muted-foreground" data-testid="new-manufacturer-plan">
          {words.text}
        </p>
      )}
      {message && (
        <p role="alert" className="text-destructive">
          {message}
        </p>
      )}
      <AddButton
        label="Add Manufacturer"
        pending={pending}
        disabled={disabled}
        describedBy={words && !words.field ? `${id}-plan` : undefined}
        onClick={() => void add()}
      />
    </section>
  );
}
