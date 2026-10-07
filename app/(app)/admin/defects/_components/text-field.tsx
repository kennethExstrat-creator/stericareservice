"use client";

import type { ReactNode } from "react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type TextFieldProps = {
  id: string;
  name: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Runs when the field loses focus, e.g. to show a typed code as it will be saved. */
  onCommit?: (value: string) => void;
  error?: string;
  description?: ReactNode;
  maxLength: number;
  multiline?: boolean;
  /** A code: monospace, no capitals or corrections from the keyboard. */
  code?: boolean;
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
  onCommit,
  error,
  description,
  maxLength,
  multiline = false,
  code = false,
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
    autoComplete: "off",
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    onChange: (event: { target: { value: string } }) => onValueChange(event.target.value),
    onBlur: onCommit ? (event: { target: { value: string } }) => onCommit(event.target.value) : undefined,
  } as const;

  return (
    <Field data-invalid={error ? true : undefined} className="gap-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {multiline ? (
        <Textarea rows={3} className="min-h-16" autoCapitalize={autoCapitalize} {...shared} />
      ) : (
        <Input
          className={cn(code && "font-mono")}
          autoCapitalize={code ? "none" : autoCapitalize}
          autoCorrect={code ? "off" : undefined}
          spellCheck={code ? false : undefined}
          {...shared}
        />
      )}
      {description && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
      {error && <FieldError id={errorId}>{error}</FieldError>}
    </Field>
  );
}
