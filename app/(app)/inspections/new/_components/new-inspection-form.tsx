"use client";

// /inspections/new (BUILD_SPEC 4.4, 8, 10): pick the client, manufacturer and
// product type; the template follows live from lib/templates' rule (an admin
// can choose another); optionally start from the last inspection of the same
// product. Create checks the form here first, then the Server Action decides
// everything again and answers the new inspection's id; the form then hands
// the Source Documents it holds to the upload queue and Auto-Sort for it, and
// opens it on Source Documents, where the uploads and the sort carry on.
//
// Source Documents (source-documents-panel.tsx, use-held-sources.ts): the
// capture screen's first step, here so every file can come in at once. They
// stay in the browser until Create. Steri-AI reads the documents one at a
// time until the client, manufacturer, product type and product name are
// filled; a reading fills only what is still empty, and the PO, codes, dates
// and order lines it read go in with Create (documentFill).
//
// Uploading the documents is where a new inspection starts and Steri-AI
// fills in the picks from them, so from 1024 px Source Documents is the main
// column, with the template and Start From Previous under it, and the picks
// and the Create button are the side column (Kenneth, 26 October 2026). Below
// 1024 px: one column in that order, 44 px targets, 16 px text. Until the
// three picks are made, the template lists the ones it still needs. Cards
// have their title and no line under it (Kenneth, 12 October 2026).
//
// Create runs from onSubmit, not from the form's action prop: React resets a
// form after every action, and the pickers (Radix Select and RadioGroup) go
// back to empty on a reset, so a failed attempt would lose the choices and
// the message saying why.
//
// Every change is kept in the tab as it happens (../_lib/draft.ts), so a
// reload or a tab the iPad dropped brings the choices and the typed name
// back. Create and Cancel remove them. The files held are not kept: leaving
// the page drops them.
import { ClipboardListIcon, OctagonXIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type MouseEvent,
} from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  chooseTemplate,
  fieldErrorsOf,
  headerHidesProductName,
  NewInspectionInputSchema,
  NO_CLIENT,
  previousFor,
  PRODUCT_NAME_MAX,
  productNameField,
  PRODUCT_TYPE_LABEL,
  readNewInspectionForm,
  type NewInspectionField,
} from "@/lib/inspections/create";
import { INSPECTIONS_PATH } from "@/lib/inspections/search-params";
import { ProductTypeSchema, type ProductType } from "@/lib/schemas/common";
import { createInspection, type CreateInspectionState } from "../actions";
import {
  draftKey,
  foundDraftStore,
  NO_CHOICES,
  readDraft,
  removeDraft,
  restoreChoices,
  tabStorage,
  writeDraft,
  type NewInspectionChoices,
} from "../_lib/draft";
import { formFill, type DocumentRead } from "../_lib/sources";
import { templateInSentence } from "../_lib/text";
import type { Option, PreviousProduct, TemplateOption } from "../_lib/types";
import { ChoiceCard } from "./choice-card";
import { Panel } from "./panel";
import { PreviousPicker, START_BLANK } from "./previous-picker";
import { SourceDocumentsPanel, type SummaryLine } from "./source-documents-panel";
import { TemplatePanel } from "./template-panel";
import { useHeldSources, type HeldSources } from "./use-held-sources";

type FieldErrors = Partial<Record<NewInspectionField, string>>;

const IDLE: CreateInspectionState = { status: "idle" };

const CHECK_FIELDS = "Check the highlighted fields.";
const UNREACHABLE = "Could not reach the server. Check the connection, then try again.";
/** In the product name field when the template's header has none. */
const NO_PRODUCT_NAME = "None with this template";

/** Where focus goes when a field needs attention, in reading order. */
const FIELD_ORDER = ["clientId", "manufacturerId", "productType", "productName", "previousId", "templateId"] as const;

const PRODUCT_TYPE_HINT: Readonly<Record<ProductType, string>> = {
  examination: "Disposable examination gloves, counted in pieces.",
  surgical: "Sterile surgical gloves, counted in pairs.",
};

/** The control that takes focus for a field's error (ids are set below and in the panels). */
function focusTargetId(id: string, field: NewInspectionField): string {
  switch (field) {
    case "clientId":
      return `${id}-client`;
    case "manufacturerId":
      return `${id}-manufacturer`;
    case "productType":
      return `${id}-type-${ProductTypeSchema.options[0]}`;
    case "productName":
      return `${id}-product`;
    case "previousId":
      return `${id}-previous-blank`;
    case "templateId":
      return `${id}-template`;
  }
}

/** The server and hydration see no draft, so the form renders as the server sent it. */
const NO_DRAFT = () => null;

type NewInspectionFormProps = {
  /** The signed-in user: the draft kept in the tab is theirs alone. */
  userId: string;
  role: "inspector" | "admin";
  clients: readonly Option[];
  manufacturers: readonly Option[];
  templates: readonly TemplateOption[];
  previous: readonly PreviousProduct[];
};

/**
 * The form, starting from the user's draft kept in the tab, as far as the page
 * still offers its choices. A draft found after hydration starts the form
 * again from it (the key), so the pickers mount with the choices rather than
 * change to them: a Radix Select whose value changes before its options are
 * in place reports itself cleared.
 */
export function NewInspectionForm({ userId, ...offered }: NewInspectionFormProps) {
  const storageKey = draftKey(userId);
  const draftStore = useMemo(() => foundDraftStore(() => readDraft(tabStorage(), storageKey)), [storageKey]);
  const found = useSyncExternalStore(draftStore.subscribe, draftStore.get, NO_DRAFT);
  return (
    <ChoicesForm
      key={`${storageKey}:${found ? "draft" : "new"}`}
      {...offered}
      userId={userId}
      storageKey={storageKey}
      initial={found ? restoreChoices(found, offered) : NO_CHOICES}
    />
  );
}

type ChoicesFormProps = NewInspectionFormProps & {
  /** Where the tab keeps the draft. */
  storageKey: string;
  /** The choices the form opens with. */
  initial: NewInspectionChoices;
};

function ChoicesForm({ userId, storageKey, initial, role, clients, manufacturers, templates, previous }: ChoicesFormProps) {
  const id = useId();
  const router = useRouter();
  const [choices, setChoices] = useState(initial);
  /** The choices as last changed, ahead of the next render: two changes in one go both count. */
  const latest = useRef(initial);
  const { clientId, manufacturerId, productType, templateId } = choices;
  /** The product name as the user typed it. */
  const typedName = choices.productName;
  const previousId = choices.previous;
  /** The earlier inspection whose product name fills the field, until the user edits it. */
  const nameFrom = choices.nameFromPrevious ? choices.previous : null;
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  /** What Steri-AI filled in above, as it filled it: the card names what still stands. */
  const [aiFilled, setAiFilled] = useState<Partial<NewInspectionChoices>>({});
  const alertRef = useRef<HTMLDivElement>(null);
  /** Hands the Source Documents held to the new inspection (use-held-sources.ts). */
  const handOver = useRef<HeldSources["handOver"] | null>(null);

  // The picks the template rule needs. The client is a deliberate choice: "" is not chosen yet.
  const client = clientId === "" ? undefined : clientId === NO_CLIENT ? null : clientId;
  const picks =
    client !== undefined && manufacturerId !== "" && productType !== null
      ? { clientId: client, manufacturerId, productType }
      : null;
  const products = picks ? previousFor(previous, picks) : [];
  const fromPrevious = products.find((product) => product.inspectionId === previousId) ?? null;
  const productName = productNameField(typedName, nameFrom, fromPrevious);
  const overrideId =
    role === "admin" && templates.some((template) => template.id === templateId && template.productType === productType)
      ? templateId
      : "";
  const choice = picks ? chooseTemplate(templates, { ...picks, templateId: overrideId || undefined }, role) : null;
  const chosen = choice?.ok ? (templates.find((template) => template.id === choice.template.id) ?? null) : null;
  // The row keeps the header's product name (BUILD_SPEC 6.2 rule 10): a template whose
  // header has none keeps no name, so the field says so instead of taking one.
  const nameOff = chosen !== null && chosen.ready && headerHidesProductName(chosen);

  /** Field errors and the message from one attempt; the effect below moves focus to them. */
  function settle(result: CreateInspectionState): CreateInspectionState {
    setErrors(result.status === "error" ? (result.fieldErrors ?? {}) : {});
    setMessage(result.status === "error" ? result.message : null);
    return result;
  }

  const [state, formAction, pending] = useActionState(
    async (current: CreateInspectionState, formData: FormData): Promise<CreateInspectionState> => {
      const parsed = NewInspectionInputSchema.safeParse(readNewInspectionForm(formData));
      if (!parsed.success) return settle({ status: "error", message: CHECK_FIELDS, fieldErrors: fieldErrorsOf(parsed.error) });
      // The same rule the server applies, so a form that cannot work never leaves the iPad.
      const check = chooseTemplate(templates, parsed.data, role);
      if (!check.ok) {
        return settle({ status: "error", message: check.message, ...(check.field ? { fieldErrors: { [check.field]: check.message } } : {}) });
      }
      const option = templates.find((template) => template.id === check.template.id);
      if (option && !option.ready) {
        return settle({ status: "error", message: `${templateInSentence(option)} cannot be used yet: an admin needs to save it again.` });
      }
      let result: CreateInspectionState;
      try {
        result = await createInspection(current, formData);
      } catch (error) {
        console.error(error);
        return settle({ status: "error", message: UNREACHABLE });
      }
      if (result.status === "created") {
        // It exists: the draft goes, the files held follow it, and it opens on Source Documents.
        removeDraft(tabStorage(), storageKey);
        try {
          await handOver.current?.(result.id, userId);
        } catch (error) {
          console.error("[inspections/new] handing over the Source Documents failed", error);
        }
        router.push(`${INSPECTIONS_PATH}/${result.id}`);
      }
      return settle(result);
    },
    IDLE,
  );
  /** Create is under way, or done and the inspection opening: the form stays as it is. */
  const creating = pending || state.status === "created";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    startTransition(() => formAction(new FormData(event.currentTarget)));
  }

  // After a failed attempt: focus the first field that needs attention, else the message.
  useEffect(() => {
    if (state.status !== "error") return;
    const field = FIELD_ORDER.find((key) => state.fieldErrors?.[key]);
    const control = field ? document.getElementById(focusTargetId(id, field)) : null;
    (control ?? alertRef.current)?.focus();
  }, [state, id]);

  /** A change of choice or name, kept in the tab as it happens. */
  function update(change: Partial<NewInspectionChoices>) {
    const next = { ...latest.current, ...change };
    latest.current = next;
    setChoices(next);
    writeDraft(tabStorage(), storageKey, next);
  }

  /** A change clears that field's error and the message about the last attempt. */
  function changed(field: NewInspectionField) {
    setMessage(null);
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  }

  /** A document read fills the pickers and the product name where nothing is chosen or typed yet: the first answer wins. */
  function applyRead(read: DocumentRead) {
    const change = formFill(latest.current, read.form, previous);
    if (Object.keys(change).length === 0) return;
    update(change);
    setMessage(null);
    setErrors((current) => ({
      ...current,
      ...(change.clientId ? { clientId: undefined } : {}),
      ...(change.manufacturerId ? { manufacturerId: undefined } : {}),
      ...(change.productType ? { productType: undefined } : {}),
      ...(change.productName ? { productName: undefined } : {}),
    }));
    setAiFilled((current) => ({ ...current, ...change }));
  }

  // Documents are read until the form has its client, manufacturer, product type and product name.
  const sources = useHeldSources({
    needsValues: picks === null || (!nameOff && productName.trim() === ""),
    paused: creating,
    onRead: applyRead,
  });
  useEffect(() => {
    handOver.current = sources.handOver;
  }, [sources.handOver]);

  /** Cancel drops the draft; a click that opens the list in another tab keeps it. */
  function cancel(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    removeDraft(tabStorage(), storageKey);
  }

  const names = {
    client: client ? (clients.find((entry) => entry.id === client)?.label ?? null) : null,
    manufacturer: manufacturers.find((entry) => entry.id === manufacturerId)?.label ?? null,
  };

  // What Steri-AI filled in above, where it still stands; and the companies it read that neither list has.
  const filled: SummaryLine[] = [];
  if (aiFilled.clientId && aiFilled.clientId === clientId && names.client) filled.push({ label: "Client", value: names.client });
  if (aiFilled.manufacturerId && aiFilled.manufacturerId === manufacturerId && names.manufacturer) {
    filled.push({ label: "Manufacturer", value: names.manufacturer });
  }
  if (aiFilled.productType && aiFilled.productType === productType) {
    filled.push({ label: "Product Type", value: PRODUCT_TYPE_LABEL[aiFilled.productType] });
  }
  if (aiFilled.productName && aiFilled.productName === productName && !nameOff) filled.push({ label: "Product Name", value: productName });
  const readForms = sources.documents.flatMap((document) => (document.state.step === "read" ? [document.state.read.form] : []));
  const unlisted: SummaryLine[] = [];
  const clientRead = client === undefined ? readForms.find((form) => !form.clientId && form.clientName)?.clientName : null;
  if (clientRead) unlisted.push({ label: "Client", value: `“${clientRead}” is not in the client list` });
  const manufacturerRead =
    manufacturerId === "" ? readForms.find((form) => !form.manufacturerId && form.manufacturerName)?.manufacturerName : null;
  if (manufacturerRead) unlisted.push({ label: "Manufacturer", value: `“${manufacturerRead}” is not in the manufacturer list` });

  return (
    <form onSubmit={submit} noValidate aria-busy={creating || undefined} data-testid="new-inspection-form">
      <fieldset disabled={creating} className="relative m-0 min-w-0 border-0 p-0">
        <legend className="sr-only">New Inspection</legend>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] min-[80rem]:grid-cols-[minmax(0,1fr)_30rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <SourceDocumentsPanel id={id} sources={sources} disabled={creating} filled={filled} unlisted={unlisted} />

            <TemplatePanel
              id={id}
              role={role}
              picks={[
                { label: "Client", done: client !== undefined },
                { label: "Manufacturer", done: manufacturerId !== "" },
                { label: "Product Type", done: productType !== null },
              ]}
              productType={productType}
              names={names}
              choice={choice}
              chosen={chosen}
              overrides={templates}
              overrideId={overrideId}
              onOverrideChange={(value) => {
                update({ templateId: value });
                changed("templateId");
              }}
              overrideError={errors.templateId}
              disabled={creating}
            />

            <PreviousPicker
              id={id}
              role={role}
              ready={picks !== null}
              products={products}
              value={fromPrevious?.inspectionId ?? START_BLANK}
              onValueChange={(value) => {
                const product = products.find((entry) => entry.inspectionId === value) ?? null;
                // A named product fills in its name; Start Blank or an unnamed one gives back what was typed.
                update({ previous: product?.inspectionId ?? "", nameFromPrevious: Boolean(product?.productName) });
                changed("previousId");
              }}
              template={chosen}
              error={errors.previousId}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <Panel
              headingId={`${id}-order-heading`}
              icon={ClipboardListIcon}
              title="What You Are Inspecting"
              // A size container: client and manufacturer, and the two product types, side by side only where the card is wide.
              className="@container"
            >
              <div className="grid gap-5 @lg:grid-cols-2">
                <Field data-invalid={errors.clientId ? true : undefined}>
                  <FieldLabel htmlFor={`${id}-client`}>Client</FieldLabel>
                  <Select
                    value={clientId}
                    onValueChange={(value) => {
                      update({ clientId: value });
                      changed("clientId");
                    }}
                  >
                    <SelectTrigger
                      id={`${id}-client`}
                      className="w-full"
                      aria-invalid={errors.clientId ? true : undefined}
                      aria-describedby={`${id}-client-${errors.clientId ? "error" : "hint"}`}
                    >
                      <SelectValue placeholder="Choose the client" />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          <span className="truncate">{entry.label}</span>
                        </SelectItem>
                      ))}
                      {clients.length > 0 && <SelectSeparator />}
                      <SelectItem value={NO_CLIENT}>No Client</SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.clientId ? (
                    <FieldError id={`${id}-client-error`}>{errors.clientId}</FieldError>
                  ) : (
                    <FieldDescription id={`${id}-client-hint`}>A client&apos;s own template wins over the standard one.</FieldDescription>
                  )}
                </Field>

                <Field data-invalid={errors.manufacturerId ? true : undefined}>
                  <FieldLabel htmlFor={`${id}-manufacturer`}>Manufacturer</FieldLabel>
                  <Select
                    value={manufacturerId}
                    onValueChange={(value) => {
                      update({ manufacturerId: value });
                      changed("manufacturerId");
                    }}
                    disabled={manufacturers.length === 0}
                  >
                    <SelectTrigger
                      id={`${id}-manufacturer`}
                      className="w-full"
                      aria-invalid={errors.manufacturerId ? true : undefined}
                      aria-describedby={`${id}-manufacturer-${errors.manufacturerId ? "error" : "hint"}`}
                    >
                      <SelectValue placeholder={manufacturers.length === 0 ? "No manufacturers yet" : "Choose the manufacturer"} />
                    </SelectTrigger>
                    <SelectContent>
                      {manufacturers.map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          <span className="truncate">{entry.label}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.manufacturerId ? (
                    <FieldError id={`${id}-manufacturer-error`}>{errors.manufacturerId}</FieldError>
                  ) : (
                    <FieldDescription id={`${id}-manufacturer-hint`}>
                      {manufacturers.length > 0
                        ? "The factory the gloves come from. Its address goes into the header."
                        : role === "admin"
                          ? "Add the manufacturer under Admin first."
                          : "Ask an admin to add the manufacturer."}
                    </FieldDescription>
                  )}
                </Field>
              </div>

              <FieldSet
                aria-describedby={errors.productType ? `${id}-type-error` : undefined}
                data-invalid={errors.productType ? true : undefined}
                className="gap-3"
              >
                {/* A fieldset's legend is no flex item, so the FieldSet's gap never reaches it: its own
                    mb-3 keeps the 12 px a Field has between label and control, and leading-snug the
                    FieldLabel's line, so the cards sit as far below it as the pickers below theirs. */}
                <FieldLegend variant="label" className={errors.productType ? "leading-snug text-destructive" : "leading-snug"}>
                  Product Type
                </FieldLegend>
                <RadioGroup
                  value={productType ?? ""}
                  onValueChange={(value) => {
                    const parsed = ProductTypeSchema.safeParse(value);
                    if (!parsed.success) return;
                    update({ productType: parsed.data });
                    changed("productType");
                  }}
                  aria-invalid={errors.productType ? true : undefined}
                  className="grid gap-3 @md:grid-cols-2"
                >
                  {ProductTypeSchema.options.map((type) => (
                    <ChoiceCard
                      key={type}
                      id={`${id}-type-${type}`}
                      value={type}
                      title={PRODUCT_TYPE_LABEL[type]}
                      description={PRODUCT_TYPE_HINT[type]}
                      invalid={Boolean(errors.productType)}
                    />
                  ))}
                </RadioGroup>
                {errors.productType && <FieldError id={`${id}-type-error`}>{errors.productType}</FieldError>}
              </FieldSet>

              <Field data-invalid={errors.productName ? true : undefined}>
                <FieldLabel htmlFor={`${id}-product`}>
                  Product Name <span className="font-normal text-muted-foreground">(Optional)</span>
                </FieldLabel>
                <Input
                  id={`${id}-product`}
                  name="productName"
                  // What was typed is kept for a template that has the field again.
                  value={nameOff ? "" : productName}
                  disabled={nameOff}
                  // Greyed, not faded (docs/DESIGN.md): faded, it read as an empty field to type in.
                  placeholder={nameOff ? NO_PRODUCT_NAME : undefined}
                  className={nameOff ? "disabled:bg-muted disabled:opacity-100 disabled:shadow-none" : undefined}
                  onChange={(event) => {
                    update({ productName: event.target.value, nameFromPrevious: false });
                    changed("productName");
                  }}
                  maxLength={PRODUCT_NAME_MAX}
                  autoComplete="off"
                  autoCapitalize="words"
                  aria-invalid={errors.productName ? true : undefined}
                  aria-describedby={`${id}-product-${errors.productName ? "error" : "hint"}`}
                />
                {errors.productName ? (
                  <FieldError id={`${id}-product-error`}>{errors.productName}</FieldError>
                ) : (
                  <FieldDescription id={`${id}-product-hint`} data-testid="product-name-hint">
                    {nameOff
                      ? "This template's header has no product name, so none is recorded."
                      : "Brand, product code and description, as on the order. You can change it in the header later."}
                  </FieldDescription>
                )}
              </Field>
            </Panel>

            {message && (
              <Alert ref={alertRef} tabIndex={-1} variant="destructive" className="outline-none" data-testid="form-error">
                <OctagonXIcon aria-hidden />
                <AlertDescription className="text-destructive">{message}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button asChild variant="outline">
                <Link href={INSPECTIONS_PATH} onClick={cancel}>
                  Cancel
                </Link>
              </Button>
              <Button type="submit" className="min-w-44">
                {creating ? <Spinner aria-hidden /> : <PlusIcon aria-hidden />}
                {creating ? "Creating…" : "Create Inspection"}
              </Button>
            </div>
          </div>
        </div>
      </fieldset>

      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="manufacturerId" value={manufacturerId} />
      <input type="hidden" name="productType" value={productType ?? ""} />
      <input type="hidden" name="previousId" value={fromPrevious?.inspectionId ?? ""} />
      <input type="hidden" name="documentFill" value={sources.fill ? JSON.stringify(sources.fill) : ""} />
      {role === "admin" && <input type="hidden" name="templateId" value={overrideId} />}
    </form>
  );
}
