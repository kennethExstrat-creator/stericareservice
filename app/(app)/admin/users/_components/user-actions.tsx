"use client";

import Link from "next/link";
import { useActionState, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  BanIcon,
  EllipsisIcon,
  KeyRoundIcon,
  LinkIcon,
  LockOpenIcon,
  MailXIcon,
  OctagonXIcon,
  SendIcon,
  TriangleAlertIcon,
  UserCheckIcon,
  UserCogIcon,
  UserPenIcon,
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
import { currentPlacement, defaultRole, needsLead, roleValue, TEAM_MESSAGES, type RoleOption } from "@/lib/auth/org";
import type { LeadOption, UserField } from "@/lib/auth/users";
import {
  assignLead,
  cancelInvite,
  changeRole,
  deactivateUser,
  reactivateUser,
  resendInvite,
  sendPasswordLink,
  type ActionResult,
} from "../actions";
import { teamHref } from "../_lib/team-filter";
import { cn } from "@/lib/utils";
import { DetailsDialog } from "./details-dialog";
import { InviteLinkDialog } from "./invite-link-dialog";
import { focusRole, LeadField, RoleField, SCROLLING_DIALOG } from "./role-fields";
import { TitleWithUid } from "./uid-badge";
import { unreachable } from "./unreachable";
import {
  activationNeedsPlacement,
  DESTRUCTIVE,
  DIALOG_TITLE,
  leadChoicesFor,
  MENU_LABEL,
  menuGroups,
  type MenuAction as Kind,
  type UserActionsTarget,
} from "./user-menu";

type ServerAction = (previous: ActionResult, formData: FormData) => Promise<ActionResult>;

/** Each menu item's icon; its words are MENU_LABEL (user-menu.ts). */
const MENU_ICON: Record<Kind, LucideIcon> = {
  "edit-details": UserPenIcon,
  "change-role": UserCogIcon,
  "change-lead": UsersRoundIcon,
  "send-link": KeyRoundIcon,
  unblock: LockOpenIcon,
  "resend-invite": SendIcon,
  "copy-invite-link": LinkIcon,
  "cancel-invite": MailXIcon,
  deactivate: BanIcon,
  reactivate: UserCheckIcon,
  activate: UserCheckIcon,
};

export type Confirmation = {
  title: string;
  /** The person's UID, beside the title. */
  uid: string | null;
  description: ReactNode;
  confirm: string;
  pending: string;
  /** The button that changes nothing, when "Cancel" would read as the action itself (Cancel Invite). */
  dismiss?: string;
  destructive?: boolean;
  action: ServerAction;
  fields: Record<string, string>;
};

export function confirmation(
  kind: "send-link" | "unblock" | "resend-invite" | "cancel-invite" | "deactivate" | "reactivate" | "activate",
  user: UserActionsTarget,
): Confirmation {
  const title = DIALOG_TITLE[kind](user.name);
  const uid = user.uid;
  const target = { userId: user.id };
  const team = user.lead ? ` They are back in ${user.lead.name}'s team.` : "";
  switch (kind) {
    case "send-link":
      return {
        title,
        uid,
        description: (
          <>
            We email <span className="font-medium text-foreground">{user.email}</span> a link to choose a new password.
            Use it when an invite was lost or a password forgotten. The link works once.
          </>
        ),
        confirm: "Send Link",
        pending: "Sending…",
        action: sendPasswordLink,
        fields: target,
      };
    case "unblock":
      return {
        title,
        uid,
        description:
          "Their account is active, but Supabase still blocks their sign-in, for example after a deactivation and a reactivation at the same moment. This lifts the block.",
        confirm: "Lift Block",
        pending: "Lifting…",
        action: reactivateUser,
        fields: target,
      };
    case "resend-invite":
      return {
        title,
        uid,
        description: (
          <>
            We email <span className="font-medium text-foreground">{user.email}</span> a new link to create their
            account: name, phone and password. Any link sent or copied before stops working. If email does not reach
            them, choose Copy Invite Link instead and send the link yourself.
          </>
        ),
        confirm: "Resend Invite",
        pending: "Sending…",
        action: resendInvite,
        fields: target,
      };
    case "cancel-invite":
      return {
        title,
        uid,
        description: (
          <>
            This removes the account the invite made for{" "}
            <span className="font-medium text-foreground">{user.email}</span>: the links sent to it stop working, and
            they leave this list. You can invite the address again later.
          </>
        ),
        confirm: "Cancel Invite",
        pending: "Cancelling…",
        dismiss: "Keep Invite",
        destructive: true,
        action: cancelInvite,
        fields: target,
      };
    case "deactivate":
      return {
        title,
        uid,
        description:
          "They lose access straight away: they are signed out on their next page load and cannot sign in or see any data until an admin reactivates them. Their inspections stay as they are.",
        confirm: "Deactivate",
        pending: "Deactivating…",
        destructive: true,
        action: deactivateUser,
        fields: target,
      };
    // Someone invited who has not created their account has no password yet: a link to create it is what they need.
    case "reactivate":
      return {
        title,
        uid,
        description: user.joined
          ? `They can sign in again with their current password and pick up where they left off.${team}`
          : `They have not created their account yet. Once it is active again, send them a new link to create it: Resend Invite or Copy Invite Link, next to their name.${team}`,
        confirm: "Reactivate",
        pending: "Reactivating…",
        action: reactivateUser,
        fields: target,
      };
    case "activate":
      return {
        title,
        uid,
        description: user.joined
          ? `This account has never been active. Once activated they can sign in with their password, or choose one from a password link.${team}`
          : `This account has never been active, and they have not created it yet. Once it is active, send them a link to create it: Resend Invite or Copy Invite Link, next to their name.${team}`,
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
  roles = [],
  invites = true,
}: {
  user: UserActionsTarget;
  /** False until the project has lead inspectors (migration 20261007170000). */
  teams?: boolean;
  /** Active lead inspectors, for the lead pickers. */
  leads?: readonly LeadOption[];
  /** The roles to choose from (UserDirectory.roles), for Change Role and an activation that places someone. */
  roles?: readonly RoleOption[];
  /** False without the secret key: no invite can be resent, copied or cancelled. */
  invites?: boolean;
}) {
  const [kind, setKind] = useState<Kind | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openingDialog = useRef(false);
  const noteId = useId();
  const groups = menuGroups(user, { teams, invites });

  if (groups.length === 0) return null;

  const close = () => setKind(null);
  // Nobody leads themselves; the only lead inspector is told there is no other one.
  const { choices: leadChoices, emptyHint } = leadChoicesFor(user.id, leads);

  /** The dialog an item opens. */
  function dialogFor(item: Kind): ReactNode {
    switch (item) {
      case "edit-details":
        return <DetailsDialog key={item} user={user} onClose={close} returnFocusTo={triggerRef} />;
      case "copy-invite-link":
        return <InviteLinkDialog key={item} user={user} onClose={close} returnFocusTo={triggerRef} />;
      case "change-role":
        return (
          <PlacementDialog
            key={item}
            user={user}
            title={DIALOG_TITLE["change-role"](user.name)}
            description={teams ? currentPlacement(user.role, user.lead?.name ?? null) : "Only admins manage users and approve inspections."}
            confirm="Save Role"
            pending="Saving…"
            action={changeRole}
            choices={roles}
            askLead={teams}
            leads={leadChoices}
            emptyHint={emptyHint}
            onClose={close}
            returnFocusTo={triggerRef}
          />
        );
      case "change-lead":
        return (
          <PlacementDialog
            key={item}
            user={user}
            title={DIALOG_TITLE["change-lead"](user.name)}
            description={user.lead ? `They work in ${user.lead.name}'s team now.` : "They are in no lead inspector's team yet."}
            confirm="Save Lead Inspector"
            pending="Saving…"
            action={assignLead}
            choices={null}
            askLead
            leads={leadChoices}
            emptyHint={emptyHint}
            onClose={close}
            returnFocusTo={triggerRef}
          />
        );
      case "activate":
      case "reactivate":
        // Someone whose role needs a lead, in no team, is placed as they are let in.
        if (!activationNeedsPlacement(user, teams)) break;
        return (
          <PlacementDialog
            key={item}
            user={user}
            title={DIALOG_TITLE[item](user.name)}
            description={`People with the ${user.role.name} role work in a lead inspector's team. Choose their lead inspector, or another role.`}
            confirm={item === "activate" ? "Activate" : "Reactivate"}
            pending={item === "activate" ? "Activating…" : "Reactivating…"}
            action={reactivateUser}
            choices={roles}
            askLead
            leads={leadChoices}
            emptyHint={emptyHint}
            onClose={close}
            returnFocusTo={triggerRef}
          />
        );
      case "deactivate":
      case "cancel-invite":
        // Someone who leads a team keeps it until it has moved: the way to it instead.
        if (user.team.length === 0) break;
        return <LeadsTeamDialog key={item} user={user} onClose={close} returnFocusTo={triggerRef} />;
      case "send-link":
      case "unblock":
      case "resend-invite":
        break;
    }
    // Everything else asks once and goes: a confirmation (confirmation() words it).
    return <ConfirmDialog key={item} confirmation={confirmation(item, user)} onClose={close} returnFocusTo={triggerRef} />;
  }

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
                const Icon = MENU_ICON[item];
                return (
                  <DropdownMenuItem
                    key={item}
                    variant={DESTRUCTIVE.has(item) ? "destructive" : "default"}
                    onSelect={() => {
                      openingDialog.current = true;
                      setKind(item);
                    }}
                  >
                    <Icon aria-hidden />
                    {MENU_LABEL[item]}
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

      {kind !== null && dialogFor(kind)}
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
export function ConfirmDialog({
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
            <TitleWithUid uid={confirmation.uid}>
              <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
            </TitleWithUid>
            <AlertDialogDescription>{confirmation.description}</AlertDialogDescription>
          </AlertDialogHeader>

          {Object.entries(confirmation.fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}

          {/* role="alert": read out as soon as it appears. */}
          {state.status === "error" && <ErrorAlert message={state.message} />}

          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={pending}>
              {confirmation.dismiss ?? "Cancel"}
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

/** The role a placement dialog starts on: theirs when it is one of the choices, else the built-in Inspector. */
function startingRole(current: RoleOption, choices: readonly RoleOption[] | null): string {
  const value = roleValue(current);
  if (!choices || choices.some((option) => roleValue(option) === value)) return value;
  const fallback = defaultRole(choices);
  return fallback ? roleValue(fallback) : value;
}

/**
 * The role and lead of one person: Change Role, Change Lead Inspector, and
 * activating someone whose role needs a lead and who is in no team. It holds
 * a Radix RadioGroup and Select, so it submits by hand (submitAction): a
 * refused change leaves every choice where the admin put it, next to the
 * reason.
 */
export function PlacementDialog({
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
  /** The roles to choose from, or null to keep their role (Change Lead Inspector). */
  choices: readonly RoleOption[] | null;
  /** Ask for a lead when the role needs one (teams exist). */
  askLead: boolean;
  leads: readonly LeadOption[];
  /** What the lead picker says when there is nobody to choose. */
  emptyHint: string;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
}) {
  const id = useId();
  const [role, setRole] = useState(() => startingRole(user.role, choices));
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
  // The role chosen; Change Lead Inspector keeps theirs.
  const chosen = choices ? choices.find((option) => roleValue(option) === role) : user.role;
  const showLead = askLead && chosen !== undefined && needsLead(chosen.access);
  // Someone who leads a team keeps a role that sees their team's until it has moved (the action refuses too).
  const leadsTeam = choices !== null && user.role.access === "team" && chosen?.access !== "team" && user.team.length > 0;

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
            <TitleWithUid uid={user.uid}>
              <DialogTitle className="text-lg font-bold">{title}</DialogTitle>
            </TitleWithUid>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <input type="hidden" name="userId" value={user.id} />

          {choices && (
            <RoleField
              id={id}
              value={role}
              roles={choices}
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
export function LeadsTeamDialog({
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
          <TitleWithUid uid={user.uid}>
            <AlertDialogTitle>{DIALOG_TITLE["leads-team"](user.name)}</AlertDialogTitle>
          </TitleWithUid>
          <AlertDialogDescription>{TEAM_MESSAGES.leadsTeam(user.name, user.team)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel type="button">Close</AlertDialogCancel>
          <Button asChild>
            <Link href={teamHref(user.id)} onClick={onClose}>
              <UsersRoundIcon aria-hidden />
              Show Their Team
            </Link>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
