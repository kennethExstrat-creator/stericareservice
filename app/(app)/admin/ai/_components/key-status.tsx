// Where the API key in use comes from, and its last four characters: never
// the key itself.
import { CheckCircle2Icon, TriangleAlertIcon } from "lucide-react";
import { keyLabel, type AiSettingsView } from "@/lib/schemas/ai-settings";

const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Kuala_Lumpur",
});

export function KeyStatus({ view }: { view: AiSettingsView }) {
  const changed =
    view.updatedAt !== null ? ` Last changed ${WHEN.format(new Date(view.updatedAt))}${view.updatedBy ? ` by ${view.updatedBy}` : ""}.` : "";
  const { key } = view;
  const line =
    key.source === "saved"
      ? { ok: true, text: `In use: ${keyLabel(key.hint)}.${changed}` }
      : key.source === "unreadable"
        ? { ok: false, text: `The saved key (${keyLabel(key.hint)}) can no longer be read: the server's secret key changed. Enter it again.` }
        : key.source === "environment"
          ? { ok: true, text: "In use: the ANTHROPIC_API_KEY set on the server. A key saved here replaces it." }
          : { ok: false, text: "No key yet: Steri-AI features are switched off until one is saved." };
  return (
    <p
      data-testid="ai-key-status"
      className={`flex gap-2 rounded-lg px-3 py-2 text-sm touch:text-base ${line.ok ? "bg-pass-tint text-pass" : "bg-warn-tint text-warn"}`}
    >
      {line.ok ? <CheckCircle2Icon aria-hidden className="mt-0.5 size-4 shrink-0" /> : <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />}
      {line.text}
    </p>
  );
}
