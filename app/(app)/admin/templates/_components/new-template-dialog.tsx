"use client";

// "New Template" on /admin/templates (BUILD_SPEC 4.5 step 2): a code, a name,
// the template to build on and where it applies; Create writes version 1 as
// a draft and opens the template editor (actions.ts). The form is submitted
// by hand (lib/admin/submit.ts): it holds Radix Selects, which React's reset
// after a form action would empty, so a refused attempt keeps every choice.
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { FilePlus2Icon, InfoIcon, OctagonXIcon } from "lucide-react";
import { unstable_rethrow } from "next/navigation";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
  ANY,
  codeTakenMessage,
  defaultSizing,
  NEW_TEMPLATE_IDLE,
  NEW_TEMPLATE_LIMITS,
  NewTemplateInputSchema,
  NO_BASE,
  normaliseTemplateCode,
  readNewTemplateForm,
  type BaseOption,
  type NewTemplateField,
  type NewTemplateResult,
} from "@/lib/admin/new-template";
import { fieldErrors } from "@/lib/admin/reference";
import { submitAction } from "@/lib/admin/submit";
import { ProductTypeSchema, StandardSchema, type ProductType, type Standard } from "@/lib/schemas/common";
import { createTemplate } from "../actions";

export type ScopeOption = { id: string; name: string };

const PRODUCT_TYPE_LABEL: Readonly<Record<ProductType, string>> = {
  examination: "Examination Gloves",
  surgical: "Surgical Gloves",
};

const STANDARD_LABEL: Readonly<Record<Standard, string>> = {
  EN455: "EN 455",
  ASTM_D6319: "ASTM D6319",
  ASTM_D3578: "ASTM D3578",
  ASTM_D3577: "ASTM D3577",
  custom: "Custom",
};

const UNIT_WORD = { pcs: "pieces", pairs: "pairs" } as const;

/** Fields in the order they appear: the first with an error takes the focus. */
const FIELD_ORDER: readonly NewTemplateField[] = ["base", "code", "name", "productType", "standard", "clientId", "manufacturerId"];

const UNREACHABLE = "Could not reach the server. Check the connection, then try again.";

type FieldErrors = Partial<Record<NewTemplateField, string>>;

type NewTemplateProps = {
  /** The active version of every template: what a new one can build on. */
  bases: readonly BaseOption[];
  clients: readonly ScopeOption[];
  manufacturers: readonly ScopeOption[];
  /** Every code in use, so a taken code is named before anything is sent. */
  takenCodes: readonly string[];
};

/** The button and its dialog. A fresh form, with no old errors, every time it opens. */
export function NewTemplateDialog(props: NewTemplateProps) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const pending = useRef(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending.current) return;
        if (next) setFormKey((key) => key + 1);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <FilePlus2Icon aria-hidden />
          New Template
        </Button>
      </DialogTrigger>
      {/* Header and buttons stay put; only the fields scroll when the screen is short (iPad landscape). */}
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        onInteractOutside={(event) => {
          if (pending.current) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (pending.current) event.preventDefault();
        }}
      >
        <NewTemplateForm
          key={formKey}
          {...props}
          onPendingChange={(value) => {
            pending.current = value;
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function NewTemplateForm({
  bases,
  clients,
  manufacturers,
  takenCodes,
  onPendingChange,
}: NewTemplateProps & { onPendingChange: (pending: boolean) => void }) {
  const id = useId();
  const alertRef = useRef<HTMLDivElement>(null);
  const [base, setBase] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [productType, setProductType] = useState("");
  const [standard, setStandard] = useState("");
  const [clientId, setClientId] = useState(ANY);
  const [manufacturerId, setManufacturerId] = useState(ANY);
  const [errors, setErrors] = useState<FieldErrors>({});

  /** The field errors of one attempt, which the effect below moves the focus to. */
  function settle(result: NewTemplateResult): NewTemplateResult {
    setErrors(result.status === "error" ? (result.fieldErrors ?? {}) : {});
    return result;
  }

  const [state, formAction, pending] = useActionState(
    async (previous: NewTemplateResult, formData: FormData): Promise<NewTemplateResult> => {
      // The same rules the server applies, and the codes in use: a form that cannot work never leaves the page.
      const checked = NewTemplateInputSchema.safeParse(readNewTemplateForm(formData));
      const local: FieldErrors = checked.success ? {} : fieldErrors(checked.error);
      if (checked.success && takenCodes.includes(checked.data.code)) {
        local.code = codeTakenMessage(checked.data.code);
      }
      if (Object.keys(local).length > 0) return settle({ status: "error", message: "Check the highlighted fields.", fieldErrors: local });
      onPendingChange(true);
      try {
        return settle(await createTemplate(previous, formData));
      } catch (error) {
        // The action opens the editor by throwing a redirect: let Next.js have it.
        unstable_rethrow(error);
        console.error(error);
        return settle({ status: "error", message: UNREACHABLE });
      } finally {
        onPendingChange(false);
      }
    },
    NEW_TEMPLATE_IDLE,
  );

  // After a refused attempt: the first field that needs attention, else the message.
  useEffect(() => {
    if (state.status !== "error") return;
    const field = FIELD_ORDER.find((key) => state.fieldErrors?.[key]);
    const target = field ? document.getElementById(`${id}-${field}`) : alertRef.current;
    target?.focus();
  }, [state, id]);

  const clear = (field: NewTemplateField) => {
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const chosenBase = bases.find((option) => option.code === base) ?? null;
  const formError = state.status === "error" && !state.fieldErrors ? state.message : null;
  const sizing = productType === "examination" || productType === "surgical" ? defaultSizing(productType) : null;
  const baseNote = chosenBase
    ? `Version 1 lists nothing of its own yet: every module, label and setting comes from ${chosenBase.code} v${chosenBase.version}, and so do the sizes (${chosenBase.sizes}, in ${UNIT_WORD[chosenBase.unit]}). Change any of it in the editor.`
    : base === NO_BASE
      ? `Header and conclusion only, to add modules to in the editor. Sizes ${sizing ? `${sizing.sizes.map((size) => size.value).join(", ")} in ${UNIT_WORD[sizing.unit]}` : "by product type"}, also changed in the editor.`
      : null;

  const select = (
    field: NewTemplateField,
    label: string,
    value: string,
    onChange: (value: string) => void,
    options: { value: string; label: string; detail?: string }[],
    extra: { placeholder?: string; description?: string; groups?: { label: string; options: typeof options }[] } = {},
  ) => {
    const error = errors[field];
    const describedBy = [extra.description ? `${id}-${field}-description` : null, error ? `${id}-${field}-error` : null]
      .filter(Boolean)
      .join(" ");
    const item = (option: (typeof options)[number]) => (
      <SelectItem key={option.value} value={option.value}>
        <span>{option.label}</span>
        {option.detail && <span className="text-xs text-muted-foreground">{option.detail}</span>}
      </SelectItem>
    );
    return (
      <Field data-invalid={error ? true : undefined} className="gap-2">
        <FieldLabel htmlFor={`${id}-${field}`}>{label}</FieldLabel>
        {/* The value goes with the form in a hidden field of its own: the Select only shows it. */}
        <input type="hidden" name={field} value={value} />
        <Select
          value={value}
          onValueChange={(next) => {
            onChange(next);
            clear(field);
          }}
        >
          <SelectTrigger
            id={`${id}-${field}`}
            className="w-full"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy || undefined}
          >
            <SelectValue placeholder={extra.placeholder ?? "Choose…"} />
          </SelectTrigger>
          <SelectContent position="popper" className="max-h-80">
            {extra.groups
              ? extra.groups.map((group, index) => (
                  <SelectGroup key={group.label}>
                    {index > 0 && <SelectSeparator />}
                    <SelectLabel>{group.label}</SelectLabel>
                    {group.options.map(item)}
                  </SelectGroup>
                ))
              : options.map(item)}
          </SelectContent>
        </Select>
        {extra.description && <FieldDescription id={`${id}-${field}-description`}>{extra.description}</FieldDescription>}
        {error && <FieldError id={`${id}-${field}-error`}>{error}</FieldError>}
      </Field>
    );
  };

  const text = (field: "code" | "name", label: string, value: string, onChange: (value: string) => void, description: string) => {
    const error = errors[field];
    return (
      <Field data-invalid={error ? true : undefined} className="gap-2">
        <FieldLabel htmlFor={`${id}-${field}`}>{label}</FieldLabel>
        <Input
          id={`${id}-${field}`}
          name={field}
          value={value}
          maxLength={NEW_TEMPLATE_LIMITS[field]}
          autoComplete="off"
          {...(field === "code"
            ? {
                className: "font-mono",
                autoCapitalize: "characters",
                autoCorrect: "off",
                spellCheck: false,
                // Shown as it will be saved once the admin moves on: "client eg" becomes CLIENT_EG.
                onBlur: (event: { target: { value: string } }) => setCode(normaliseTemplateCode(event.target.value)),
              }
            : { autoCapitalize: "sentences" })}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-${field}-description${error ? ` ${id}-${field}-error` : ""}`}
          onChange={(event) => {
            onChange(event.target.value);
            clear(field);
          }}
        />
        <FieldDescription id={`${id}-${field}-description`}>{description}</FieldDescription>
        {error && <FieldError id={`${id}-${field}-error`}>{error}</FieldError>}
      </Field>
    );
  };

  return (
    <form
      onSubmit={submitAction(formAction, pending)}
      noValidate
      aria-busy={pending || undefined}
      className="flex min-h-0 flex-1 flex-col"
      data-testid="new-template-form"
    >
      <DialogHeader className="border-b border-border px-6 pt-6 pb-5">
        <DialogTitle className="pr-8 text-lg font-bold">New Template</DialogTitle>
        <DialogDescription>
          Build on the template closest to the new form, then switch modules, wording and settings in the editor until
          every field of the form is covered.
        </DialogDescription>
      </DialogHeader>

      {/* Relative, so screen-reader-only text inside stays anchored in the scroller. */}
      <div className="relative flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-5">
        <fieldset disabled={pending} className="m-0 min-w-0 border-0 p-0">
          <legend className="sr-only">The new template</legend>
          <FieldGroup className="gap-5">
            {select(
              "base",
              "Build on",
              base,
              (next) => {
                setBase(next);
                // Where it applies starts as the base's: a client template usually keeps its product type.
                const option = bases.find((entry) => entry.code === next);
                if (option) {
                  setProductType(option.productType);
                  setStandard(option.standard);
                  clear("productType");
                  clear("standard");
                }
              },
              [],
              {
                placeholder: "Choose a template",
                groups: [
                  ...(bases.length > 0
                    ? [
                        {
                          label: "Active Templates",
                          options: bases.map((option) => ({
                            value: option.code,
                            label: option.code,
                            detail: [option.name, `v${option.version}`].filter(Boolean).join(" · "),
                          })),
                        },
                      ]
                    : []),
                  { label: "Nothing", options: [{ value: NO_BASE, label: "None", detail: "Header and conclusion only" }] },
                ],
              },
            )}
            {baseNote && (
              <p className="-mt-2 flex gap-2 text-sm text-muted-foreground" data-note>
                <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>{baseNote}</span>
              </p>
            )}
            <div className="grid gap-5 sm:grid-cols-2">
              {text("code", "Code", code, setCode, "Capitals, digits and _, e.g. CLIENT_EG. It never changes.")}
              {text("name", "Name", name, setName, "How admins and inspectors know it.")}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              {select(
                "productType",
                "Product Type",
                productType,
                setProductType,
                ProductTypeSchema.options.map((option) => ({ value: option, label: PRODUCT_TYPE_LABEL[option] })),
              )}
              {select(
                "standard",
                "Standard",
                standard,
                setStandard,
                StandardSchema.options.map((option) => ({ value: option, label: STANDARD_LABEL[option] })),
              )}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              {select(
                "clientId",
                "Client",
                clientId,
                setClientId,
                [{ value: ANY, label: "Any Client" }, ...clients.map((option) => ({ value: option.id, label: option.name }))],
                { description: "A client's own template wins over the standard one for its inspections." },
              )}
              {select(
                "manufacturerId",
                "Manufacturer",
                manufacturerId,
                setManufacturerId,
                [
                  { value: ANY, label: "Any Manufacturer" },
                  ...manufacturers.map((option) => ({ value: option.id, label: option.name })),
                ],
              )}
            </div>
          </FieldGroup>
        </fieldset>

        {/* role="alert": read out as soon as it appears. */}
        {formError && (
          <Alert variant="destructive" ref={alertRef} tabIndex={-1}>
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
          {pending ? "Creating…" : "Create and Edit"}
        </Button>
      </DialogFooter>
    </form>
  );
}
