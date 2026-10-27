"use client";

// A phone field that formats a Malaysian number as it is typed, "+60 17-370
// 1066" or "017-370 1066", and leaves any other country's as typed
// (lib/auth/phone-format.ts). The caret keeps its place by the digits around
// it, and Backspace on a hyphen or space takes the digit before it. It works
// controlled (`value` with `onValueChange`) or inside a form with
// `defaultValue`, which posts what the field shows.
import { useLayoutEffect, useRef, useState, type ChangeEvent, type ComponentProps, type Ref } from "react";
import { phoneEdit } from "@/lib/auth/phone-format";
import { Input } from "./input";

type PhoneInputProps = Omit<ComponentProps<"input">, "type" | "value" | "defaultValue" | "onChange"> & {
  value?: string;
  defaultValue?: string;
  /** Called with the formatted number after each edit. */
  onValueChange?: (value: string) => void;
};

export function PhoneInput({ value, defaultValue, onValueChange, ref, ...props }: PhoneInputProps) {
  const controlled = value !== undefined;
  const [own, setOwn] = useState(defaultValue ?? "");
  // A form's new default (its action's answer) replaces what an uncontrolled field shows, as it
  // arrives (React's "adjusting state when a prop changes").
  const [lastDefault, setLastDefault] = useState(defaultValue);
  if (defaultValue !== lastDefault) {
    setLastDefault(defaultValue);
    if (!controlled) setOwn(defaultValue ?? "");
  }
  const shown = controlled ? value : own;
  const element = useRef<HTMLInputElement | null>(null);
  const caret = useRef<number | null>(null);

  // After the formatted value is on screen, the caret goes back beside its digit.
  useLayoutEffect(() => {
    const input = element.current;
    if (caret.current === null || !input || input.ownerDocument.activeElement !== input) return;
    input.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const edit = phoneEdit({
      previous: shown,
      typed: input.value,
      caret: input.selectionStart ?? input.value.length,
      inputType: (event.nativeEvent as InputEvent).inputType,
    });
    caret.current = edit.caret;
    if (!controlled) setOwn(edit.value);
    onValueChange?.(edit.value);
  };

  const setRef = (node: HTMLInputElement | null) => {
    element.current = node;
    assignRef(ref, node);
  };

  return <Input {...props} ref={setRef} type="tel" inputMode="tel" value={shown} onChange={change} />;
}

function assignRef<T>(ref: Ref<T> | undefined, node: T | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}
