import { CircleCheckIcon, CircleIcon } from "lucide-react";
import { PASSWORD_RULES } from "@/lib/auth/forms";
import { cn } from "@/lib/utils";

/**
 * The password policy under a new password, shown before anything is typed
 * and ticked off live (the reset and Account Creation forms). The server
 * applies the same rules (lib/auth/forms.ts).
 */
export function PasswordRules({ id, value }: { id: string; value: string }) {
  return (
    <ul id={id} className="space-y-1.5 text-sm">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(value);
        const Icon = met ? CircleCheckIcon : CircleIcon;
        return (
          <li
            key={rule.key}
            data-met={met}
            className={cn("flex items-center gap-2", met ? "text-pass" : "text-muted-foreground")}
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            <span>
              {rule.label}
              <span className="sr-only">{met ? " (done)" : " (not yet)"}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
