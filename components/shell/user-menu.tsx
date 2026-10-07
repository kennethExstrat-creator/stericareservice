"use client";

// Who is signed in, and the way out. The top bar (iPad) shows a compact
// trigger, the sidebar (desktop) a block with name and email; both open the
// same menu: name, email, role and Sign out.
//
// Sign out checks first (use-sign-out.ts): photos or files still waiting on
// this device, or a page's unsaved work, and the user is asked in a dialog
// (Stay signed in / Sign out anyway). With nothing waiting it signs out at
// once. The menu stays open while it checks and signs out, so the pending
// state shows. Both steps have a time limit: the check at most 20 s, the
// request 15 s. The redirect to /login closes everything; a sign-out that
// fails or gets no answer in time gives the menu back, with a toast.
import { ChevronDownIcon, ChevronsUpDownIcon, LogOutIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { PendingWorkDialog } from "./pending-work-dialog";
import { loadPhotoQueue } from "./sign-out-check";
import { useSignOut } from "./use-sign-out";
import type { ShellUser } from "./user";

type UserMenuProps = {
  user: ShellUser;
  /** `bar`: iPad top bar. `sidebar`: the block at the foot of the desktop sidebar. */
  variant: "bar" | "sidebar";
};

export function UserMenu({ user, variant }: UserMenuProps) {
  const label = `${user.name}, account menu`;
  const [open, setOpen] = useState(false);
  const signOut = useSignOut();
  const trigger = useRef<HTMLButtonElement>(null);
  // The dialog takes over from the menu: the menu must not hand focus back to its trigger meanwhile.
  const handingOver = useRef(false);

  function onOpenChange(next: boolean) {
    // Checking or signing out: the menu stays, showing it.
    if (!next && signOut.busy) return;
    setOpen(next);
    // Sign out's check needs the photo queue's code: start loading it now, off the critical path.
    if (next) void loadPhotoQueue().catch(() => undefined);
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        {variant === "bar" ? (
          <DropdownMenuTrigger asChild>
            {/*
              Right-aligned (ml-auto). It is what gives way when the bar runs out of
              room (app-shell.tsx): min-w-0 and shrink let the name truncate, and
              below 640 px only the avatar shows. The name stays in the label and
              the menu.
            */}
            <Button
              ref={trigger}
              variant="ghost"
              aria-label={label}
              className="ml-auto h-10 min-w-0 shrink gap-2 pr-3 pl-1 touch:h-11 touch:pr-3 touch:pl-1 touch:text-sm"
            >
              <UserAvatar user={user} />
              <span className="max-w-48 truncate font-medium max-sm:hidden">{user.name}</span>
              <ChevronDownIcon aria-hidden className="text-slate-500" />
            </Button>
          </DropdownMenuTrigger>
        ) : (
          <DropdownMenuTrigger
            ref={trigger}
            aria-label={label}
            className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted focus-ring-inset data-[state=open]:bg-muted touch:min-h-14"
          >
            <UserAvatar user={user} size="lg" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-foreground">{user.name}</span>
              <span className="block truncate text-sm text-muted-foreground">{user.email}</span>
            </span>
            <ChevronsUpDownIcon aria-hidden className="size-4 shrink-0 text-slate-500" />
          </DropdownMenuTrigger>
        )}

        <DropdownMenuContent
          side={variant === "bar" ? "bottom" : "top"}
          align={variant === "bar" ? "end" : "start"}
          sideOffset={8}
          className="w-72 p-1.5"
          onCloseAutoFocus={(event) => {
            if (!handingOver.current) return;
            handingOver.current = false;
            event.preventDefault();
          }}
        >
          <DropdownMenuLabel className="flex items-start gap-3 px-2 py-2 text-sm font-normal text-foreground">
            <UserAvatar user={user} size="lg" />
            <span className="flex min-w-0 flex-col items-start gap-1">
              <span className="max-w-full truncate font-semibold">{user.name}</span>
              <span className="max-w-full text-muted-foreground [overflow-wrap:anywhere]">{user.email}</span>
              <RoleBadge user={user} />
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            aria-disabled={signOut.busy || undefined}
            className="font-medium"
            onSelect={(event) => {
              // Stay open while it checks and signs out.
              event.preventDefault();
              if (signOut.busy) return;
              void signOut.request(() => {
                handingOver.current = true;
                setOpen(false);
              });
            }}
          >
            {signOut.busy ? <Spinner aria-hidden="true" /> : <LogOutIcon aria-hidden />}
            {signOut.busy ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PendingWorkDialog
        open={signOut.phase === "asking"}
        onOpenChange={(next) => {
          if (!next) signOut.stay();
        }}
        title="Sign out now?"
        reasons={signOut.reasons}
        stayLabel="Stay signed in"
        goLabel="Sign out anyway"
        goingLabel="Signing out…"
        going={signOut.signingOut}
        onGo={signOut.confirm}
        returnFocus={() => trigger.current}
      />
    </>
  );
}

function UserAvatar({ user, size = "default" }: { user: ShellUser; size?: "default" | "lg" }) {
  return (
    <Avatar aria-hidden size={size}>
      <AvatarFallback
        className={cn("bg-brand-100 font-bold text-brand-700", size === "lg" ? "text-sm" : "text-xs")}
      >
        {user.initials}
      </AvatarFallback>
    </Avatar>
  );
}

function RoleBadge({ user }: { user: ShellUser }) {
  return (
    <Badge variant="secondary" className="shrink-0 font-semibold">
      {user.roleLabel}
    </Badge>
  );
}
