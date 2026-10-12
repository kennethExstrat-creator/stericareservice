// The notices both settings views share: why nothing can be saved, and how a
// save, a removal or a connection test went.
import { CheckCircle2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { AiSettingsView } from "@/lib/schemas/ai-settings";

export const UNREACHABLE = "Could not reach the server. Check the connection, then try again.";

/** Nothing when the settings can be saved; else why not. */
export function StorageAlert({ storage }: { storage: AiSettingsView["storage"] }) {
  if (storage === "ready") return null;
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon aria-hidden />
      <AlertDescription className="text-destructive">
        {storage === "no_secret_key"
          ? "The server needs SUPABASE_SECRET_KEY before Steri-AI settings can be saved here."
          : "The saved Steri-AI settings could not be read. Reload the page to try again."}
      </AlertDescription>
    </Alert>
  );
}

/** A result in words, with a tick or a cross. */
export function ResultAlert({ ok, message, ...props }: { ok: boolean; message: string } & ComponentProps<typeof Alert>) {
  return (
    <Alert variant={ok ? "default" : "destructive"} {...props}>
      {ok ? <CheckCircle2Icon aria-hidden className="text-pass" /> : <OctagonXIcon aria-hidden />}
      <AlertDescription className={ok ? "text-foreground" : "text-destructive"}>{message}</AlertDescription>
    </Alert>
  );
}
