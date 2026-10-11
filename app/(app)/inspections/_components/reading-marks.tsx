// What Steri-AI has done with a Source Document, beside the file's name: on
// the capture screen's Files (source-documents-page.tsx) and on New
// Inspection's card, in the same words and colours.
import { BadgeCheckIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";

/** Not read yet: "Waiting for Steri-AI…", or why it waits. */
export function WaitingMark({ children = "Waiting for Steri-AI…", title }: { children?: ReactNode; title?: string }) {
  return (
    <span className="text-sm text-muted-foreground" title={title} data-testid="ai-waiting">
      {children}
    </span>
  );
}

export function ReadingMark() {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-brand-700" data-testid="ai-reading">
      <Spinner aria-hidden className="size-3.5" />
      Steri-AI is reading…
    </span>
  );
}

/** Read: "Steri-AI Verified" on the capture screen; `title`, what the document is. */
export function ReadBadge({ children, title, testId }: { children: ReactNode; title?: string; testId: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-pass-tint px-2 py-0.5 text-sm font-semibold text-pass ring-1 ring-pass-border"
      title={title || undefined}
      data-testid={testId}
    >
      <BadgeCheckIcon aria-hidden className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

/** Steri-AI could not read it; `title`, why. */
export function NotReadBadge({ title }: { title?: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn-tint px-2 py-0.5 text-sm font-semibold text-warn ring-1 ring-warn-border"
      title={title || undefined}
    >
      <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0" />
      Not Read
    </span>
  );
}
