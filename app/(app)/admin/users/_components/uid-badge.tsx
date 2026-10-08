// A person's UID beside their name in the user dialogs: "SC-0042", which a
// screen reader reads as "UID SC-0042". It sits next to the dialog's title,
// not inside it, so every dialog keeps its name ("Change Olga Other's Name").
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function UidBadge({ uid, className }: { uid: string; className?: string }) {
  return (
    <span
      data-slot="uid"
      className={cn(
        "relative inline-flex h-6 w-fit shrink-0 items-center rounded-full border border-border bg-slate-50 px-2 text-sm font-medium whitespace-nowrap text-slate-700 tabular-nums",
        className,
      )}
    >
      <span className="sr-only">UID </span>
      {uid}
    </span>
  );
}

/** A dialog's title with the person's UID beside it, below it when the title fills the line. */
export function TitleWithUid({ uid, children }: { uid: string | null; children: ReactNode }) {
  if (!uid) return children;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1" data-slot="title-with-uid">
      {children}
      <UidBadge uid={uid} />
    </div>
  );
}
