"use client";

// Who is signed in, and the way out. The top bar (iPad) shows a compact
// trigger, the sidebar (desktop) a block with name and email; both open the
// same menu: name, email, role and Sign out.
import { ChevronDownIcon, ChevronsUpDownIcon, LogOutIcon } from "lucide-react";
import { useFormStatus } from "react-dom";
import { signOut } from "@/lib/auth/actions";
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
import type { ShellUser } from "./user";

type UserMenuProps = {
  user: ShellUser;
  /** `bar`: iPad top bar. `sidebar`: the block at the foot of the desktop sidebar. */
  variant: "bar" | "sidebar";
};

export function UserMenu({ user, variant }: UserMenuProps) {
  const label = `${user.name}, account menu`;
  return (
    <DropdownMenu>
      {variant === "bar" ? (
        <DropdownMenuTrigger asChild>
          {/*
            Right-aligned (ml-auto). It is what gives way when the bar runs out of
            room (app-shell.tsx): min-w-0 and shrink let the name truncate, and
            below 640 px only the avatar shows. The name stays in the label and
            the menu.
          */}
          <Button
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
          aria-label={label}
          className="flex w-full items-center gap-3 rounded-lg p-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=open]:bg-muted touch:min-h-14"
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
        <form action={signOut}>
          <SignOutItem />
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SignOutItem() {
  const { pending } = useFormStatus();
  return (
    <DropdownMenuItem
      asChild
      // Stay open while signing out, so the pending state shows; the redirect
      // to /login closes everything.
      onSelect={(event) => event.preventDefault()}
    >
      <button type="submit" disabled={pending} className="w-full font-medium">
        {pending ? <Spinner aria-hidden="true" /> : <LogOutIcon aria-hidden />}
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </DropdownMenuItem>
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
