"use client";

import { useActionState, useEffect, useRef } from "react";
import { DownloadIcon, ExternalLinkIcon, SendIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { sendToAiReport } from "@/lib/inspections/ai/actions";
import { AI_ACTION_IDLE, type AiActionState } from "@/lib/inspections/ai/types";
import { focusIfLost } from "./focus-handoff";
import { unreachable } from "./unreachable";

/**
 * The AI report hand-off (BUILD_SPEC 9.1): "Send to AI Report" for admins
 * when a report service is connected, the link to the finished report once
 * there is one, and the export as a JSON download, which is the way out when
 * no report service is connected ("AI Not Connected").
 */
export function ReportControl({
  inspectionId,
  exportHref,
  reportUrl,
  connected,
  canSend,
}: {
  inspectionId: string;
  exportHref: string;
  reportUrl: string | null;
  connected: boolean;
  /** An admin, a submitted or approved inspection, and a report service. */
  canSend: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const [state, formAction, pending] = useActionState(async (previous: AiActionState, formData: FormData) => {
    const result = await sendToAiReport(previous, formData).catch(unreachable);
    if (result.status === "success") toast.success(result.message);
    return result;
  }, AI_ACTION_IDLE);

  // The button is disabled while the export is sent; its answer puts focus back on it.
  useEffect(() => {
    if (state.status !== "idle") focusIfLost(sendRef.current, formRef.current);
  }, [state]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {reportUrl && (
          <Button asChild variant="outline" className="relative">
            <a href={reportUrl} target="_blank" rel="noreferrer">
              <ExternalLinkIcon aria-hidden />
              Open the Report
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </Button>
        )}
        <Button asChild variant="outline">
          <a href={exportHref} download data-testid="export-download">
            <DownloadIcon aria-hidden />
            Download JSON
          </a>
        </Button>
        {connected && canSend && (
          <form ref={formRef} action={formAction}>
            <input type="hidden" name="inspectionId" value={inspectionId} />
            <Button ref={sendRef} type="submit" disabled={pending}>
              {pending ? <Spinner aria-hidden /> : <SendIcon aria-hidden />}
              {pending ? "Sending to the AI Report" : reportUrl ? "Send to AI Report Again" : "Send to AI Report"}
            </Button>
          </form>
        )}
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-sm break-words text-fail">
          {state.message}
        </p>
      )}
      {state.status === "not_connected" && (
        <p role="status" className="text-sm text-muted-foreground">
          {state.message} Use Download JSON to pass the export on.
        </p>
      )}
      {state.status === "success" && state.reportUrl && !reportUrl && (
        <p role="status" className="text-sm text-foreground">
          {state.message}{" "}
          <a href={state.reportUrl} target="_blank" rel="noreferrer" className="relative font-semibold text-brand-600 underline">
            Open it<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      )}
    </div>
  );
}
