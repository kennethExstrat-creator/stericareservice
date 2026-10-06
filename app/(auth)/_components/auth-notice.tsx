import { CircleAlertIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { LoginNotice, NoticeTone } from "@/lib/auth/forms";
import { cn } from "@/lib/utils";

// Problems use the status tokens (icon and words, never colour alone); a
// neutral note uses the brand's subtle surface.
const TONES: Record<NoticeTone, { Icon: typeof InfoIcon; role: "alert" | "status"; className: string }> = {
  error: { Icon: CircleAlertIcon, role: "alert", className: "border-fail-border bg-fail-tint text-fail" },
  warning: { Icon: TriangleAlertIcon, role: "alert", className: "border-warn-border bg-warn-tint text-warn" },
  info: { Icon: InfoIcon, role: "status", className: "border-brand-200 bg-brand-50 text-brand-700" },
};

/** A message above a sign-in form: a ?error= banner or the result of a submit. */
export function AuthNotice({
  tone,
  title,
  description,
  action,
  icon,
  className,
}: LoginNotice & { icon?: typeof InfoIcon; className?: string }) {
  const { Icon: ToneIcon, role, className: toneClass } = TONES[tone];
  const Icon = icon ?? ToneIcon;
  return (
    <Alert role={role} data-tone={tone} className={cn(toneClass, className)}>
      <Icon aria-hidden />
      <AlertTitle className="font-semibold">{title}</AlertTitle>
      {(description || action) && (
        <AlertDescription className="text-current [&_p:not(:last-child)]:mb-1">
          {description && <p>{description}</p>}
          {action && (
            <p>
              <Link
                href={action.href}
                className="font-semibold underline underline-offset-3 touch:inline-flex touch:min-h-11 touch:items-center"
              >
                {action.label}
              </Link>
            </p>
          )}
        </AlertDescription>
      )}
    </Alert>
  );
}
