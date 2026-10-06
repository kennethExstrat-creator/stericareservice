"use client";

// The frame around one section of the capture screen: ModuleCard's look
// (docs/DESIGN.md: white card, title in the template's wording, result pill,
// body, inspector comment) with the photo slot in the footer where
// ModuleCard has its own two photo buttons, which the photo build replaces
// (photo-slot.tsx). The body is the module's Capture, a plain form, or a
// notice.
import { useId, useState, type ReactNode, type Ref } from "react";
import { StatusPill } from "@/components/qc";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { COMMENT_MAX } from "@/lib/inspections/capture/changes";
import type { Status } from "@/lib/design/status";
import { cn } from "@/lib/utils";

type SectionFrameProps = {
  /** The panel id the section tabs point at. */
  id: string;
  title: string;
  /** The section's result; none for a section that is switched off. */
  status?: Status;
  statusLabel?: string;
  /** One line under the title, e.g. the result's summary. */
  summary?: ReactNode;
  /** Header controls, e.g. "Switch off" for admins. */
  actions?: ReactNode;
  /** The title takes focus when a section opens from Previous or Next. */
  headingRef?: Ref<HTMLHeadingElement>;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function SectionFrame({
  id,
  title,
  status,
  statusLabel,
  summary,
  actions,
  headingRef,
  children,
  footer,
  className,
}: SectionFrameProps) {
  const titleId = `${id}-title`;
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      data-slot="section-frame"
      className={cn("rounded-xl bg-card text-card-foreground shadow-sm ring-1 ring-border", className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-border px-5 py-4">
        <div className="min-w-0 space-y-1">
          <h2
            id={titleId}
            ref={headingRef}
            tabIndex={-1}
            className="scroll-mt-[calc(var(--capture-sticky-top,0px)_+_1rem)] text-lg leading-snug font-bold text-balance text-foreground outline-none"
          >
            {title}
          </h2>
          {summary && <div className="text-sm text-muted-foreground touch:text-base">{summary}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {status && <StatusPill status={status} label={statusLabel} />}
        </div>
      </header>
      <div className="space-y-5 px-5 py-5">{children}</div>
      {footer && (
        <footer className="grid gap-4 rounded-b-xl border-t border-border bg-slate-50 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          {footer}
        </footer>
      )}
    </section>
  );
}

/**
 * The inspector comment every section carries (BUILD_SPEC 4.2 rule 7). Typed
 * text is kept as typed, spaces included, while the stored comment drops a
 * blank one; the field is remounted (keyed) when the section changes.
 */
export function SectionComment({
  value,
  onChange,
  readOnly,
}: {
  value: string | null;
  onChange: (comment: string) => void;
  readOnly: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(value ?? "");
  // Data replaced from outside (a restored copy, the other device's version):
  // show it. A blank stored comment still leaves spaces being typed alone.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    const blank = value === null && text.trim() === "";
    if (!blank && (value ?? "") !== text) setText(value ?? "");
  }
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Inspector comment</Label>
      <Textarea
        id={id}
        value={text}
        maxLength={COMMENT_MAX}
        onChange={(event) => {
          setText(event.target.value);
          onChange(event.target.value);
        }}
        readOnly={readOnly}
        aria-readonly={readOnly || undefined}
        placeholder={readOnly ? undefined : "Anything the report should mention"}
        rows={2}
      />
    </div>
  );
}
