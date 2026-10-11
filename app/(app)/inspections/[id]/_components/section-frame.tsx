"use client";

// The frame around one section of the capture screen: ModuleCard's look
// (docs/DESIGN.md: white card, title in the template's wording, result pill,
// body, inspector comment) with the photo slot in the footer where
// ModuleCard has its own two photo buttons (components/capture/photos
// PhotoSlot: the buttons and the section's photos). The body is the
// module's Capture, a plain form, or a notice. The open page's frames are in
// a PagePanel: a frame for each section on a page of two
// (lib/inspections/capture/sections.ts SHOWN_WITH: packing configuration
// below the order).
import { useId, useState, type ReactNode, type Ref } from "react";
import { StatusPill } from "@/components/qc";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { COMMENT_MAX } from "@/lib/inspections/capture/changes";
import type { Status } from "@/lib/design/status";
import { cn } from "@/lib/utils";

type SectionFrameProps = {
  /** The panel id the section tabs point at; on a page of several sections, the frame's own. */
  id: string;
  /** The section's module (or custom module) key, as `data-section-key`: landing spots and specs find the frame by it. */
  sectionKey?: string;
  /**
   * The id of the tab that opens this section, while the tab bar is how
   * sections are chosen (below 1280 px): the frame is then that tab's
   * panel, named by it. Otherwise a region named by its title.
   */
  tabLabelledBy?: string;
  title: string;
  /** The section's result; none for a section that is switched off. */
  status?: Status;
  statusLabel?: string;
  /** One line under the title, e.g. the result's summary. */
  summary?: ReactNode;
  /** Header controls, e.g. "Switch Off" for admins. */
  actions?: ReactNode;
  /** The title takes focus when a section opens from Previous or Next. */
  headingRef?: Ref<HTMLHeadingElement>;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function SectionFrame({
  id,
  sectionKey,
  tabLabelledBy,
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
      role={tabLabelledBy ? "tabpanel" : undefined}
      aria-labelledby={tabLabelledBy ?? titleId}
      data-slot="section-frame"
      data-section-key={sectionKey}
      className={cn("rounded-xl bg-card text-card-foreground shadow-sm ring-1 ring-border", className)}
    >
      {/* The result stays top right, however long the summary: the summary runs full width below. */}
      <header className="space-y-1 border-b border-border px-5 py-4">
        <div className="flex items-start justify-between gap-x-4 gap-y-2 max-sm:flex-wrap">
          <h2
            id={titleId}
            ref={headingRef}
            tabIndex={-1}
            // Focused by Previous, Next and issue links: the opaque ring shows it to keyboard users.
            className="min-w-0 rounded-sm text-lg leading-snug font-bold text-balance text-foreground outline-none focus-ring"
          >
            {title}
          </h2>
          {(actions || status) && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {actions}
              {status && <StatusPill status={status} label={statusLabel} />}
            </div>
          )}
        </div>
        {summary && <div className="text-sm text-muted-foreground touch:text-base">{summary}</div>}
      </header>
      <div className="space-y-5 px-5 py-5">{children}</div>
      {footer && (
        // The photo slot sizes its tiles to its own width (a container), so it never sits in an auto-sized column.
        <footer className="grid gap-5 rounded-b-xl border-t border-border bg-slate-50 px-5 py-4">
          {footer}
        </footer>
      )}
    </section>
  );
}

/**
 * The open page around its frames. Holding more than one section (packing
 * configuration below the order): below 1280 px the open tab's panel, named
 * by that tab, from 1280 px a plain block, a SectionFrame per section in
 * it, each a region named by its title. Holding one (`single`): that
 * section's frame is the panel, and this wrapper has no id, no role and no
 * box of its own (display: contents). It is there all the same: a page that
 * gains or loses its second section (packing configuration switched on or
 * off on another device) is the same element with the same keyed frames in
 * it, so React keeps the frame still shown, with the field being typed in
 * and its half-typed value.
 */
export function PagePanel({
  id,
  tabLabelledBy,
  single = false,
  children,
}: {
  id: string;
  tabLabelledBy?: string;
  /** One section on the page: its frame takes the id and the tab, and the wrapper adds nothing to the page. */
  single?: boolean;
  children: ReactNode;
}) {
  if (single) return <div className="contents">{children}</div>;
  return (
    <div
      id={id}
      data-slot="capture-page"
      role={tabLabelledBy ? "tabpanel" : undefined}
      aria-labelledby={tabLabelledBy}
      className="flex flex-col gap-4"
    >
      {children}
    </div>
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
  context,
}: {
  value: string | null;
  onChange: (comment: string) => void;
  readOnly: boolean;
  /**
   * The section's title, read out after the label on a page of two sections
   * ("Inspector Comment, Order"), so their comment fields have names of
   * their own.
   */
  context?: string;
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
    // Beside the photo slot (SectionFrame's footer): the heading in its first row, the box filling its
    // second; the third holds the photo slot's caption only.
    <div className="grid gap-2">
      {/* Styled as the photo slot's heading, so the two read as one row. */}
      <Label htmlFor={id} className="relative font-display text-base leading-snug font-semibold">
        Inspector Comment
        {context && <span className="sr-only">, {context}</span>}
      </Label>
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
        className="xl:h-full"
      />
    </div>
  );
}
