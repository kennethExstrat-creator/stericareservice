"use client";

import { useActionState, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  BanIcon,
  EllipsisIcon,
  KeyRoundIcon,
  OctagonXIcon,
  ShieldCheckIcon,
  UserCheckIcon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import type { AccountStatus, UserRole } from "@/lib/auth/users";
import {
  changeRole,
  deactivateUser,
  reactivateUser,
  sendPasswordLink,
  type ActionResult,
} from "../actions";

export type UserActionsTarget = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: AccountStatus;
  isSelf: boolean;
};

type Kind = "make-admin" | "make-inspector" | "send-link" | "deactivate" | "reactivate" | "activate";

type ServerAction = (previous: ActionResult, formData: FormData) => Promise<ActionResult>;

type Confirmation = {
  title: string;
  description: ReactNode;
  confirm: string;
  pending: string;
  destructive?: boolean;
  action: ServerAction;
  fields: Record<string, string>;
};

const MENU_ITEM: Record<Kind, { label: string; icon: LucideIcon }> = {
  "make-admin": { label: "Make admin", icon: ShieldCheckIcon },
  "make-inspector": { label: "Make inspector", icon: UserRoundIcon },
  "send-link": { label: "Send password link", icon: KeyRoundIcon },
  deactivate: { label: "Deactivate", icon: BanIcon },
  reactivate: { label: "Reactivate", icon: UserCheckIcon },
  activate: { label: "Activate", icon: UserCheckIcon },
};

/**
 * What an admin can do to this person, in menu groups. Nobody can demote or
 * deactivate themselves (the actions refuse it too), and password links only
 * go to accounts that can sign in.
 */
function menuGroups(user: UserActionsTarget): Kind[][] {
  if (user.isSelf) return user.status === "active" ? [["send-link"]] : [];
  const roleChange: Kind = user.role === "admin" ? "make-inspector" : "make-admin";
  switch (user.status) {
    case "active":
      return [[roleChange, "send-link"], ["deactivate"]];
    case "pending":
      return [["activate", roleChange]];
    case "deactivated":
      return [["reactivate", roleChange]];
  }
}

function confirmation(kind: Kind, user: UserActionsTarget): Confirmation {
  const target = { userId: user.id };
  switch (kind) {
    case "make-admin":
      return {
        title: `Make ${user.name} an admin?`,
        description:
          "Admins invite and deactivate users, change roles, manage templates and reference data, and see, approve and reopen every inspection.",
        confirm: "Make admin",
        pending: "Saving…",
        action: changeRole,
        fields: { ...target, role: "admin" },
      };
    case "make-inspector":
      return {
        title: `Make ${user.name} an inspector?`,
        description: "Their admin access ends straight away. They keep their own inspections.",
        confirm: "Make inspector",
        pending: "Saving…",
        action: changeRole,
        fields: { ...target, role: "inspector" },
      };
    case "send-link":
      return {
        title: `Send a password link to ${user.name}?`,
        description: (
          <>
            We email <span className="font-medium text-foreground">{user.email}</span> a link to choose a new password.
            Use it when an invite was lost or a password forgotten. The link works once.
          </>
        ),
        confirm: "Send link",
        pending: "Sending…",
        action: sendPasswordLink,
        fields: target,
      };
    case "deactivate":
      return {
        title: `Deactivate ${user.name}?`,
        description:
          "They lose access straight away: they are signed out on their next page load and cannot sign in or see any data until an admin reactivates them. Their inspections stay as they are.",
        confirm: "Deactivate",
        pending: "Deactivating…",
        destructive: true,
        action: deactivateUser,
        fields: target,
      };
    case "reactivate":
      return {
        title: `Reactivate ${user.name}?`,
        description: "They can sign in again with their current password and pick up where they left off.",
        confirm: "Reactivate",
        pending: "Reactivating…",
        action: reactivateUser,
        fields: target,
      };
    case "activate":
      return {
        title: `Activate ${user.name}?`,
        description:
          "This account has never been active. Once activated they can sign in with their password, or choose one from a password link.",
        confirm: "Activate",
        pending: "Activating…",
        action: reactivateUser,
        fields: target,
      };
  }
}

/** The row menu for one person, and the confirmation each item opens. */
export function UserActions({ user }: { user: UserActionsTarget }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openingDialog = useRef(false);
  const groups = menuGroups(user);

  if (groups.length === 0) return null;

  return (
    <>
      {/* Not modal: a modal menu that opens a dialog can leave the page unclickable. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button ref={triggerRef} variant="ghost" size="icon-sm" aria-label={`Actions for ${user.name}`}>
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-60"
          onCloseAutoFocus={(event) => {
            // The dialog takes focus; giving it back to the trigger would steal it.
            if (openingDialog.current) event.preventDefault();
            openingDialog.current = false;
          }}
        >
          <DropdownMenuLabel className="truncate text-muted-foreground">{user.name}</DropdownMenuLabel>
          {groups.map((group, index) => (
            <DropdownMenuGroup key={group.join()}>
              {index > 0 && <DropdownMenuSeparator />}
              {group.map((item) => {
                const { label, icon: Icon } = MENU_ITEM[item];
                return (
                  <DropdownMenuItem
                    key={item}
                    variant={item === "deactivate" ? "destructive" : "default"}
                    onSelect={() => {
                      openingDialog.current = true;
                      setKind(item);
                    }}
                  >
                    <Icon aria-hidden />
                    {label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {kind && (
        <ConfirmDialog
          key={kind}
          confirmation={confirmation(kind, user)}
          onClose={() => setKind(null)}
          returnFocusTo={triggerRef}
        />
      )}
    </>
  );
}

const IDLE: ActionResult = { status: "idle" };

/**
 * A confirmation that runs a Server Action through a form, so the button can
 * show its pending state. Success or a partial success closes it with a toast;
 * an error stays in the dialog, next to what the admin was about to do.
 */
function ConfirmDialog({
  confirmation,
  onClose,
  returnFocusTo,
}: {
  confirmation: Confirmation;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
}) {
  const [state, formAction, pending] = useActionState(async (previous: ActionResult, formData: FormData) => {
    const result = await confirmation.action(previous, formData);
    if (result.status === "success") {
      toast.success(result.message);
      onClose();
    } else if (result.status === "warning") {
      toast.warning(result.message, { duration: 12_000 });
      onClose();
    }
    return result;
  }, IDLE);

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusTo.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <form action={formAction} className="grid gap-6">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmation.description}</AlertDialogDescription>
          </AlertDialogHeader>

          {Object.entries(confirmation.fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}

          {/* role="alert": read out as soon as it appears. */}
          {state.status === "error" && (
            <Alert variant="destructive">
              <OctagonXIcon aria-hidden />
              <AlertDescription className="text-destructive">{state.message}</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={pending}>
              Cancel
            </AlertDialogCancel>
            <Button type="submit" variant={confirmation.destructive ? "destructive" : "default"} disabled={pending}>
              {pending && <Spinner aria-hidden />}
              {pending ? confirmation.pending : confirmation.confirm}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
