"use client";

// A Claude model picker: the models CLAUDE_MODELS lists, then Other Claude
// Model… with a field for any other model id. A hidden input posts the id.
// A model the price list has no price for says so: its calls would cost
// nothing in Steri-AI Cost until it has one.
import { TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { priceFor, type AiPriceList } from "@/lib/schemas/ai-prices";
import { CLAUDE_MODELS } from "@/lib/schemas/ai-settings";

const OTHER = "other";

/** Steri-AI Cost's price list (view-state.ts writes the same address). */
const PRICE_LIST_HREF = "/admin/ai?view=cost#price-list";

export function ModelField({
  id,
  name,
  scope,
  hint,
  value,
  onChange,
  prices,
  error,
  disabled,
}: {
  id: string;
  name: string;
  /** The job the model does ("Reading Documents"), for screen readers: each card's picker is labelled Model. */
  scope: string;
  /** What the job is for; the chosen model's own hint follows it. */
  hint: string;
  value: string;
  onChange: (value: string) => void;
  /** The price list each call is priced with. */
  prices: AiPriceList;
  error?: string;
  disabled?: boolean;
}) {
  const [other, setOther] = useState(!CLAUDE_MODELS.some((model) => model.id === value));
  const known = CLAUDE_MODELS.find((model) => model.id === value);
  const describedBy = `${id}-${error ? "error" : "hint"}`;
  const unpriced = value.trim() !== "" && priceFor(prices, value.trim(), 0) === null;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id} className="relative">
        Model<span className="sr-only"> for {scope}</span>
      </FieldLabel>
      <Select
        value={other ? OTHER : value}
        onValueChange={(next) => {
          setOther(next === OTHER);
          if (next !== OTHER) onChange(next);
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full" aria-invalid={error ? true : undefined} aria-describedby={describedBy}>
          {/* The words given here also show before the browser has the picker's items (server render). */}
          <SelectValue>{other ? "Other Claude Model…" : (known?.label ?? value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {CLAUDE_MODELS.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.label}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={OTHER}>Other Claude Model…</SelectItem>
        </SelectContent>
      </Select>
      {other && (
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="claude-…"
          aria-label={`Model ID for ${scope}`}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
      )}
      <input type="hidden" name={name} value={value} />
      {error ? (
        <FieldError id={`${id}-error`}>{error}</FieldError>
      ) : (
        <FieldDescription id={`${id}-hint`} className="touch:text-base">
          {known ? `${hint} ${known.hint}` : hint}
        </FieldDescription>
      )}
      {unpriced && (
        <p className="flex gap-1.5 text-sm text-warn touch:text-base" data-testid="model-unpriced">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 touch:mt-1" />
          <span>
            No price for this model yet: add it under{" "}
            <Link
              href={PRICE_LIST_HREF}
              className="rounded-sm font-medium underline underline-offset-4 focus-ring touch:inline-flex touch:min-h-11 touch:items-center"
            >
              Steri-AI Cost
            </Link>
            .
          </span>
        </p>
      )}
    </Field>
  );
}
