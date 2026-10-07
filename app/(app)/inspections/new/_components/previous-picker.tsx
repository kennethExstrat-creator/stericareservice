"use client";

// "Start From Previous" (BUILD_SPEC 8): the latest inspection of each product
// for the chosen client, manufacturer and product type, and exactly what it
// copies (lib/inspections/create.ts PREVIOUS_COPY): only what the earlier
// inspection holds and this template shows. Specs and AQL come with the
// template, so the panel says whether the template is the one used last time.
import { CopyIcon, HistoryIcon, InfoIcon } from "lucide-react";
import { FieldError } from "@/components/ui/field";
import { RadioGroup } from "@/components/ui/radio-group";
import {
  copiedInWords,
  plannedCopy,
  PREVIOUS_COPY_SUMMARY,
  type CopiedModuleKey,
  type PreviousProduct,
} from "@/lib/inspections/create";
import { formatInspectionDate } from "@/lib/inspections/format";
import { InspectionStatusBadge } from "../../_components/inspection-status-badge";
import { specsNote } from "../_lib/text";
import { PREVIOUS_SHOWN, type TemplateOption } from "../_lib/types";
import { ChoiceCard } from "./choice-card";
import { Panel } from "./panel";

/** The picker's value for "copy nothing". */
export const START_BLANK = "blank";

type PreviousPickerProps = {
  id: string;
  role: "inspector" | "admin";
  /** The client, manufacturer and product type are chosen. */
  ready: boolean;
  products: readonly PreviousProduct[];
  value: string;
  onValueChange: (value: string) => void;
  /** The template this inspection will use: the copy names its sections, the note compares it with last time's. */
  template: TemplateOption | null;
  error?: string;
  disabled?: boolean;
};

export function PreviousPicker({
  id,
  role,
  ready,
  products,
  value,
  onValueChange,
  template,
  error,
  disabled,
}: PreviousPickerProps) {
  const shown = products.slice(0, PREVIOUS_SHOWN);
  const chosen = shown.find((product) => product.inspectionId === value) ?? null;
  return (
    <Panel
      headingId={`${id}-previous-heading`}
      icon={HistoryIcon}
      title="Start From Previous"
      description="Optional. Copies the product's details from its last inspection for this client and manufacturer."
      descriptionId={`${id}-previous-hint`}
      className="gap-4"
      data-testid="previous-picker"
    >
      {!ready ? (
        <p className="text-sm text-muted-foreground touch:text-base">
          Choose the client, manufacturer and product type first.
        </p>
      ) : shown.length === 0 ? (
        <p data-testid="no-previous" className="text-sm text-muted-foreground touch:text-base">
          No earlier inspections {role === "inspector" ? "of yours " : ""}for this client, manufacturer and product type.
        </p>
      ) : (
        <>
          <RadioGroup
            value={chosen ? chosen.inspectionId : START_BLANK}
            onValueChange={onValueChange}
            disabled={disabled}
            aria-labelledby={`${id}-previous-heading`}
            aria-describedby={error ? `${id}-previous-error` : `${id}-previous-hint`}
            aria-invalid={error ? true : undefined}
            className="gap-2"
          >
            <ChoiceCard
              id={`${id}-previous-blank`}
              value={START_BLANK}
              title="Start Blank"
              description="Nothing is copied."
            />
            {shown.map((product) => (
              <ChoiceCard
                key={product.inspectionId}
                id={`${id}-previous-${product.inspectionId}`}
                value={product.inspectionId}
                title={product.productName ?? "Product name not entered"}
                muted={product.productName === null}
                description={
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="tabular-nums">{product.refNo}</span>
                    <span aria-hidden>·</span>
                    <span>{formatInspectionDate(product.inspectionDate)}</span>
                    <InspectionStatusBadge status={product.status} />
                  </span>
                }
              />
            ))}
          </RadioGroup>
          {products.length > shown.length && (
            <p className="text-sm text-muted-foreground">The {PREVIOUS_SHOWN} most recent products are listed.</p>
          )}
          {error && <FieldError id={`${id}-previous-error`}>{error}</FieldError>}
          {chosen && <CopySummary product={chosen} template={template} />}
        </>
      )}
    </Panel>
  );
}

function CopySummary({ product, template }: { product: PreviousProduct; template: TemplateOption | null }) {
  // What the earlier inspection holds, in the modules and fields this inspection's template shows;
  // before a usable template is known, everything it holds.
  const known = template?.ready ? template : null;
  const copied = plannedCopy(product.copies, known);
  const title = (key: CopiedModuleKey) => known?.titles[key] ?? PREVIOUS_COPY_SUMMARY.titles[key];
  return (
    <div data-testid="copy-summary" className="flex flex-col gap-3 rounded-lg bg-muted p-4 text-sm touch:text-base">
      <p className="flex items-center gap-2 font-semibold text-foreground">
        <CopyIcon aria-hidden className="size-4 shrink-0" />
        {copied.length > 0 ? `Copied From ${product.refNo}` : `Nothing to Copy From ${product.refNo}`}
      </p>
      {copied.length > 0 ? (
        <>
          <ul className="flex list-disc flex-col gap-1 pl-6 text-foreground">
            {copied.map(({ key, fields }) => (
              <li key={key}>
                {title(key)}: {copiedInWords(key, fields)}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">Never copied: {PREVIOUS_COPY_SUMMARY.notCopied}.</p>
        </>
      ) : (
        <p className="text-foreground">
          It holds no product details{known ? " this template uses" : ""}, so nothing is copied.
        </p>
      )}
      {template && (
        <p className="flex gap-2 text-foreground">
          <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-600" />
          <span>{specsNote(product, template)}</span>
        </p>
      )}
    </div>
  );
}
