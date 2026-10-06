"use client";

// /inspections/new (BUILD_SPEC 4.4, 8, 10): pick the client, manufacturer and
// product type; the template follows live from lib/templates' rule (an admin
// can choose another); optionally start from the last inspection of the same
// product. Create checks the form here first, then the Server Action decides
// everything again and opens the new inspection.
//
// iPad: one column, 44 px targets, 16 px text. From 1024 px the template and
// the Create button sit in a column on the right that stays in view.
//
// Create runs from onSubmit, not from the form's action prop: React resets a
// form after every action, and the pickers (Radix Select and RadioGroup) go
// back to empty on a reset, so a failed attempt would lose the choices and
// the message saying why.
import { ClipboardListIcon, OctagonXIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { startTransition, useActionState, useEffect, useId, useRef, useState, type FormEvent } from "react";
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
import { templateLabel } from "../_lib/text";
import type { Option, PreviousProduct, TemplateOption } from "../_lib/types";
import { ChoiceCard } from "./choice-card";
import { Panel } from "./panel";
import { PreviousPicker, START_BLANK } from "./previous-picker";
import { TemplatePanel } from "./template-panel";

type FieldErrors = Partial<Record<NewInspectionField, string>>;

const IDLE: CreateInspectionState = { status: "idle" };

const CHECK_FIELDS = "Check the highlighted fields.";
const UNREACHABLE = "Could not reach the server. Check the connection, then try again.";

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

type NewInspectionFormProps = {
  role: "inspector" | "admin";
  clients: readonly Option[];
  manufacturers: readonly Option[];
  templates: readonly TemplateOption[];
  previous: readonly PreviousProduct[];
};

export function NewInspectionForm({ role, clients, manufacturers, templates, previous }: NewInspectionFormProps) {
  const id = useId();
  const [clientId, setClientId] = useState("");
  const [manufacturerId, setManufacturerId] = useState("");
  const [productType, setProductType] = useState<ProductType | null>(null);
  /** The product name as the user typed it. */
  const [typedName, setTypedName] = useState("");
  /** The earlier inspection whose product name fills the field, until the user edits it. */
  const [nameFrom, setNameFrom] = useState<string | null>(null);
  const [previousId, setPreviousId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);

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
        return settle({ status: "error", message: `${templateLabel(option)} cannot be used yet: an admin needs to save it again.` });
      }
      try {
        return settle(await createInspection(current, formData));
      } catch (error) {
        // The Server Action redirects to the new inspection by throwing: let Next.js have it.
        unstable_rethrow(error);
        console.error(error);
        return settle({ status: "error", message: UNREACHABLE });
      }
    },
    IDLE,
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  // After a failed attempt: focus the first field that needs attention, else the message.
  useEffect(() => {
    if (state.status !== "error") return;
    const field = FIELD_ORDER.find((key) => state.fieldErrors?.[key]);
    const control = field ? document.getElementById(focusTargetId(id, field)) : null;
    (control ?? alertRef.current)?.focus();
  }, [state, id]);

  /** A change clears that field's error and the message about the last attempt. */
  function changed(field: NewInspectionField) {
    setMessage(null);
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  }

  const names = {
    client: client ? (clients.find((entry) => entry.id === client)?.label ?? null) : null,
    manufacturer: manufacturers.find((entry) => entry.id === manufacturerId)?.label ?? null,
  };

  return (
    <form onSubmit={submit} noValidate aria-busy={pending || undefined} data-testid="new-inspection-form">
      <fieldset disabled={pending} className="relative m-0 min-w-0 border-0 p-0">
        <legend className="sr-only">New inspection</legend>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] lg:items-start">
          <div className="flex min-w-0 flex-col gap-6">
            <Panel
              headingId={`${id}-order-heading`}
              icon={ClipboardListIcon}
              title="What you are inspecting"
              description="The client and manufacturer as on the order, and the type of glove."
            >
              <div className="grid gap-5 md:grid-cols-2">
                <Field data-invalid={errors.clientId ? true : undefined}>
                  <FieldLabel htmlFor={`${id}-client`}>Client</FieldLabel>
                  <Select
                    value={clientId}
                    onValueChange={(value) => {
                      setClientId(value);
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
                      <SelectItem value={NO_CLIENT}>No client</SelectItem>
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
                      setManufacturerId(value);
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
                <FieldLegend variant="label" className={errors.productType ? "mb-0 text-destructive" : "mb-0"}>
                  Product type
                </FieldLegend>
                <RadioGroup
                  value={productType ?? ""}
                  onValueChange={(value) => {
                    const parsed = ProductTypeSchema.safeParse(value);
                    if (!parsed.success) return;
                    setProductType(parsed.data);
                    changed("productType");
                  }}
                  aria-invalid={errors.productType ? true : undefined}
                  className="grid gap-3 sm:grid-cols-2"
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
                  Product name <span className="font-normal text-muted-foreground">(optional)</span>
                </FieldLabel>
                <Input
                  id={`${id}-product`}
                  name="productName"
                  // What was typed is kept for a template that has the field again.
                  value={nameOff ? "" : productName}
                  disabled={nameOff}
                  onChange={(event) => {
                    setTypedName(event.target.value);
                    setNameFrom(null);
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

            <PreviousPicker
              id={id}
              role={role}
              ready={picks !== null}
              products={products}
              value={fromPrevious?.inspectionId ?? START_BLANK}
              onValueChange={(value) => {
                const product = products.find((entry) => entry.inspectionId === value) ?? null;
                setPreviousId(product?.inspectionId ?? "");
                // A named product fills in its name; Start blank or an unnamed one gives back what was typed.
                setNameFrom(product?.productName ? product.inspectionId : null);
                changed("previousId");
              }}
              template={chosen}
              error={errors.previousId}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-[calc(var(--shell-top)+1.5rem)]">
            <TemplatePanel
              id={id}
              role={role}
              picks={[
                { label: "Client", done: client !== undefined },
                { label: "Manufacturer", done: manufacturerId !== "" },
                { label: "Product type", done: productType !== null },
              ]}
              productType={productType}
              names={names}
              choice={choice}
              chosen={chosen}
              overrides={templates}
              overrideId={overrideId}
              onOverrideChange={(value) => {
                setTemplateId(value);
                changed("templateId");
              }}
              overrideError={errors.templateId}
              disabled={pending}
            />

            {message && (
              <Alert ref={alertRef} tabIndex={-1} variant="destructive" className="outline-none" data-testid="form-error">
                <OctagonXIcon aria-hidden />
                <AlertDescription className="text-destructive">{message}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button asChild variant="outline">
                <Link href={INSPECTIONS_PATH}>Cancel</Link>
              </Button>
              <Button type="submit" className="min-w-44">
                {pending ? <Spinner aria-hidden /> : <PlusIcon aria-hidden />}
                {pending ? "Creating…" : "Create inspection"}
              </Button>
            </div>
          </div>
        </div>
      </fieldset>

      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="manufacturerId" value={manufacturerId} />
      <input type="hidden" name="productType" value={productType ?? ""} />
      <input type="hidden" name="previousId" value={fromPrevious?.inspectionId ?? ""} />
      {role === "admin" && <input type="hidden" name="templateId" value={overrideId} />}
    </form>
  );
}
