"use client";

import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";

type PasswordInputProps = Omit<ComponentProps<"input">, "type"> & { id: string };

/**
 * Password field with a show/hide toggle. The toggle is a pressed/unpressed
 * button with a fixed name, and the field goes back to hidden whenever its form
 * is submitted or reset, so a shown password is never left on screen.
 */
export function PasswordInput({ id, ref, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const form = groupRef.current?.closest("form");
    if (!form) return;
    const hide = () => setVisible(false);
    form.addEventListener("submit", hide);
    form.addEventListener("reset", hide);
    return () => {
      form.removeEventListener("submit", hide);
      form.removeEventListener("reset", hide);
    };
  }, []);

  return (
    <InputGroup ref={groupRef}>
      <InputGroupInput
        {...props}
        ref={ref}
        id={id}
        type={visible ? "text" : "password"}
        // Typed text stays dark on a flagged field: the border and the message carry the error.
        className="text-foreground"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-sm"
          aria-label="Show password"
          aria-pressed={visible}
          aria-controls={id}
          onClick={() => setVisible((shown) => !shown)}
        >
          {visible ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
