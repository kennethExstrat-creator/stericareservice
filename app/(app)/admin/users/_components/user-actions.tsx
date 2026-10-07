"use client";

import Link from "next/link";
import { useActionState, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  BanIcon,
  EllipsisIcon,
  KeyRoundIcon,
  LockOpenIcon,
  OctagonXIcon,
  TriangleAlertIcon,
  UserCheckIcon,
  UserCogIcon,
  UsersRoundIcon,
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { submitAction } from "@/lib/admin/submit";
import { currentPlacement, needsLead, TEAM_MESSAGES, type RoleChoice } from "@/lib/auth/org";
import type { LeadOption, UserField } from "@/lib/auth/users";
import {
  assignLead,
  changeRole,
  deactivateUser,
  reactivateUser,
  sendPasswordLink,
  type ActionResult,
} from "../actions";
import { teamHref } from "../_lib/team-filter";
import { cn } from "@/lib/utils";
import { focusRole, LeadField, RoleField, roleChoicesFor, SCROLLING_DIALOG } from "./role-fields";
import { unreachable } from "./unreachable";
import {
  activationNeedsPlacement,
  leadChoicesFor,
  menuGroups,
  type MenuAction as Kind,
  type UserActionsTarget,
} from "./user-menu";

type ServerAction = (previous: ActionResult, formData: FormData) => Promise<ActionResult>;

const MENU_ITEM: Record<Kind, { label: string; icon: LucideIcon }> = {
  "change-role": { label: "Change role", icon: UserCogIcon },
  "change-lead": { label: "Change lead inspector", icon: UsersRoundIcon },
  "send-link": { label: "Send password link", icon: KeyRoundIcon },
  unblock: { label: "Lift sign-in block", icon: LockOpenIcon },
  deactivate: { label: "Deactivate", icon: BanIcon },
  reactivate: { label: "Reactivate", icon: UserCheckIcon },
  activate: { label: "Activate", icon: UserCheckIcon },
};

type Confirmation = {
  title: string;
  description: ReactNode;
  confirm: string;
  pending: string;
  destructive?: boolean;
  action: ServerAction;
  fields: Record<string, string>;
};

function confirmation(kind: "send-link" | "unblock" | "deactivate" | "reactivate" | "activate", user: UserActionsTarget): Confirmation {
  const target = { userId: user.id };
  const team = user.lead ? ` They are back in ${user.lead.name}'s team.` : "";
  switch (kind) {
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
    case "unblock":
      return {
        title: `Let ${user.name} sign in again?`,
        description:
          "Their account is active, but Supabase still blocks their sign-in, for example after a deactivation and a reactivation at the same moment. This lifts the block.",
        confirm: "Lift block",
        pending: "Lifting…",
        action: reactivateUser,
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
        description: `They can sign in again with their current password and pick up where they left off.${team}`,
        confirm: "Reactivate",
        pending: "Reactivating…",
        action: reactivateUser,
        fields: target,
      };
    case "activate":
      return {
        title: `Activate ${user.name}?`,
        description: `This account has never been active. Once activated they can sign in with their password, or choose one from a password link.${team}`,
        confirm: "Activate",
        pending: "Activating…",
        action: reactivateUser,
        fields: target,
      };
  }
}

/** The row menu for one person, and the dialog each item opens. */
export function UserActions({
  user,
  teams = true,
  leads = [],
}: {
  user: UserActionsTarget;
  /** False until the project has lead inspectors (migration 20261007170000). */
  teams?: boolean;
  /** Active lead inspectors, for the lead pickers. */
  leads?: readonly LeadOption[];
}) {
  const [kind, setKind] = useState<Kind | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openingDialog = useRef(false);
  const noteId = useId();
  const groups = menuGroups(user, { teams });

  if (groups.length === 0) return null;

  const close = () => setKind(null);
  // Nobody leads themselves; the only lead inspector is told there is no other one.
  const { choices: leadChoices, emptyHint } = leadChoicesFor(user.id, leads);

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
          className="w-64"
          // Arrow keys move between items only, so the note is the menu's description.
          aria-describedby={user.isSelf ? noteId : undefined}
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
          {user.isSelf && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel id={noteId} className="font-normal whitespace-normal touch:text-sm">
                Only another admin can change your role or deactivate you.
              </DropdownMenuLabel>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {kind === "change-role" && (
        <PlacementDialog
          key={kind}
          user={user}
          title={`Change ${user.name}'s role`}
          description={teams ? currentPlacement(user.role, user.lead?.name ?? null) : "Only admins manage users and approve inspections."}
          confirm="Save role"
          pending="Saving…"
          action={changeRole}
          choices={roleChoicesFor(teams)}
          askLead={teams}
          leads={leadChoices}
          emptyHint={emptyHint}
          onClose={close}
          returnFocusTo={triggerRef}
        />
      )}
      {kind === "change-lead" && (
        <PlacementDialog
          key={kind}
          user={user}
          title={`Change ${user.name}'s lead inspector`}
          description={user.lead ? `They work in ${user.lead.name}'s team now.` : "They are in no lead inspector's team yet."}
          confirm="Save lead inspector"
          pending="Saving…"
          action={assignLead}
          choices={null}
          askLead
          leads={leadChoices}
          emptyHint={emptyHint}
          onClose={close}
          returnFocusTo={triggerRef}
        />
      )}
      {(kind === "activate" || kind === "reactivate") && activationNeedsPlacement(user, teams) && (
        <PlacementDialog
          key={kind}
          user={user}
          title={`${kind === "activate" ? "Activate" : "Reactivate"} ${user.name}?`}
          description="An inspector works in a lead inspector's team. Choose their role, and their lead inspector if they are an inspector."
          confirm={kind === "activate" ? "Activate" : "Reactivate"}
          pending={kind === "activate" ? "Activating…" : "Reactivating…"}
          action={reactivateUser}
          choices={roleChoicesFor(teams)}
          askLead
          leads={leadChoices}
          emptyHint={emptyHint}
          onClose={close}
          returnFocusTo={triggerRef}
        />
      )}
      {kind === "deactivate" && user.team.length > 0 && (
        <LeadsTeamDialog key={kind} user={user} onClose={close} returnFocusTo={triggerRef} />
      )}
      {kind !== null &&
        kind !== "change-role" &&
        kind !== "change-lead" &&
        !((kind === "activate" || kind === "reactivate") && activationNeedsPlacement(user, teams)) &&
        !(kind === "deactivate" && user.team.length > 0) && (
          <ConfirmDialog
            key={kind}
            confirmation={confirmation(kind, user)}
            onClose={close}
            returnFocusTo={triggerRef}
          />
        )}
    </>
  );
}

const IDLE: ActionResult = { status: "idle" };

/** Success or a partial success closes the dialog with a toast; an error stays in it. */
function announce(result: ActionResult, onClose: () => void) {
  if (result.status === "success") {
    toast.success(result.message);
    onClose();
  } else if (result.status === "warning") {
    toast.warning(result.message, { duration: 12_000 });
    onClose();
  }
}

/**
 * A confirmation that runs a Server Action through a form, so the button can
 * show its pending state. It holds no Radix control, so the form's own
 * action (and React's reset after it) is fine here.
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
    const result = await confirmation.action(previous, formData).catch(unreachable);
    announce(result, onClose);
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
          {state.status === "error" && <ErrorAlert message={state.message} />}

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

function ErrorAlert({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <OctagonXIcon aria-hidden />
      <AlertDescription className="text-destructive">{message}</AlertDescription>
    </Alert>
  );
}

/** Rule 5 in words: someone who leads a team stays a lead inspector until it has moved. */
function TeamNote({ user }: { user: UserActionsTarget }) {
  return (
    <div
      role="status"
      data-slot="team-note"
      className="flex gap-2 rounded-lg border border-warn-border bg-warn-tint px-3 py-2 text-sm text-warn"
    >
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p>{TEAM_MESSAGES.leadsTeam(user.name, user.team)}</p>
    </div>
  );
}

/**
 * The role and lead of one person: Change role, Change lead inspector, and
 * activating an inspector who is in no team. It holds a Radix RadioGroup
 * and Select, so it submits by hand (submitAction): a refused change leaves
 * every choice where the admin put it, next to the reason.
 */
function PlacementDialog({
  user,
  title,
  description,
  confirm,
  pending: pendingLabel,
  action,
  choices,
  askLead,
  leads,
  emptyHint,
  onClose,
  returnFocusTo,
}: {
  user: UserActionsTarget;
  title: string;
  description: ReactNode;
  confirm: string;
  pending: string;
  action: ServerAction;
  /** The roles to choose from, or null to keep their role (Change lead inspector). */
  choices: readonly RoleChoice[] | null;
  /** Ask for a lead when the role needs one (teams exist). */
  askLead: boolean;
  leads: readonly LeadOption[];
  /** What the lead picker says when there is nobody to choose. */
  emptyHint: string;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
}) {
  const id = useId();
  const [role, setRole] = useState<RoleChoice>(choices && !choices.includes(user.role) ? choices[0] : user.role);
  const [leadId, setLeadId] = useState(user.lead && leads.some((lead) => lead.id === user.lead?.id) ? user.lead.id : "");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<UserField, string>>>({});
  const roleRef = useRef<HTMLDivElement>(null);
  const leadRef = useRef<HTMLButtonElement>(null);

  const [state, formAction, pending] = useActionState(async (previous: ActionResult, formData: FormData) => {
    const result = await action(previous, formData).catch(unreachable);
    const errors = result.status === "error" ? (result.fieldErrors ?? {}) : {};
    setFieldErrors(errors);
    // To the first field marked. With nobody to lead them the action marks the role, not the empty, disabled picker.
    if (errors.role) focusRole(roleRef.current);
    else if (errors.leadId) leadRef.current?.focus();
    announce(result, onClose);
    return result;
  }, IDLE);

  const formError = state.status === "error" && !state.fieldErrors ? state.message : null;
  const showLead = askLead && needsLead(role);
  // Someone who leads a team keeps leading it until it has moved (the action refuses too).
  const leadsTeam = choices !== null && user.role === "lead" && role !== "lead" && user.team.length > 0;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        className={cn("sm:max-w-lg", SCROLLING_DIALOG)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusTo.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <form onSubmit={submitAction(formAction, pending)} noValidate className="grid gap-6" data-testid="placement-form">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <input type="hidden" name="userId" value={user.id} />

          {choices && (
            <RoleField
              id={id}
              value={role}
              choices={choices}
              error={fieldErrors.role}
              groupRef={roleRef}
              onChange={(next) => {
                setRole(next);
                if (fieldErrors.role) setFieldErrors((errors) => ({ ...errors, role: undefined }));
              }}
            />
          )}
          {showLead && (
            <LeadField
              id={id}
              value={leadId}
              leads={leads}
              error={fieldErrors.leadId}
              emptyHint={emptyHint}
              triggerRef={leadRef}
              onChange={(next) => {
                setLeadId(next);
                if (fieldErrors.leadId) setFieldErrors((errors) => ({ ...errors, leadId: undefined }));
              }}
            />
          )}

          {leadsTeam && !formError && <TeamNote user={user} />}
          {formError && <ErrorAlert message={formError} />}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner aria-hidden />}
              {pending ? pendingLabel : confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Deactivate on someone who leads a team: what to do first, and the way to their team. */
function LeadsTeamDialog({
  user,
  onClose,
  returnFocusTo,
}: {
  user: UserActionsTarget;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusTo.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{`${user.name} still leads a team`}</AlertDialogTitle>
          <AlertDialogDescription>{TEAM_MESSAGES.leadsTeam(user.name, user.team)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel type="button">Close</AlertDialogCancel>
          <Button asChild>
            <Link href={teamHref(user.id)} onClick={onClose}>
              <UsersRoundIcon aria-hidden />
              Show their team
            </Link>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
