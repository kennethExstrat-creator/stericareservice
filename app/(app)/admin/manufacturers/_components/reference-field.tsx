"use client";

// Shared by /admin/manufacturers and /admin/clients (see reference-panel.tsx).

import type { ReactNode } from "react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type TextFieldProps = {
  id: string;
  name: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  error?: string;
  description?: ReactNode;
  maxLength: number;
  /** A textarea for addresses and notes. */
  multiline?: boolean;
  /** The id of a <datalist> with suggestions. */
  list?: string;
  autoCapitalize?: "words" | "sentences" | "none";
};

/**
 * A labelled text field with its hint and error (docs/DESIGN.md: label above,
 * error below in fail red). Controlled, so a failed save keeps what was typed:
 * React resets uncontrolled fields after every form action.
 */
export function TextField({
  id,
  name,
  label,
  value,
  onValueChange,
  error,
  description,
  maxLength,
  multiline = false,
  list,
  autoCapitalize = "sentences",
}: TextFieldProps) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  const shared = {
    id,
    name,
    value,
    maxLength,
    autoCapitalize,
    autoComplete: "off",
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    onChange: (event: { target: { value: string } }) => onValueChange(event.target.value),
  } as const;

  return (
    <Field data-invalid={error ? true : undefined} className="gap-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {multiline ? (
        <Textarea rows={3} className="min-h-16" {...shared} />
      ) : (
        <Input list={list} {...shared} />
      )}
      {description && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </Field>
  );
}
