"use client";

import { useActionState, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OctagonXIcon, UserPlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { submitAction } from "@/lib/admin/submit";
import { defaultRole, needsLead, roleValue, type RoleOption } from "@/lib/auth/org";
import type { InviteDelivery, LeadOption, UserField } from "@/lib/auth/users";
import { inviteUser, type InviteLinkResult } from "../actions";
import { RadioCard } from "../../_components/radio-card";
import { cn } from "@/lib/utils";
import { copyLinkAgain, copyNewLink, InviteLinkView } from "./invite-link-dialog";
import { focusRole, LeadField, RoleField, SCROLLING_DIALOG } from "./role-fields";
import { unreachable } from "./unreachable";

type FieldErrors = Partial<Record<UserField, string>>;

/**
 * "Invite User": the button and its dialog, which asks for the address, the
 * role (and the lead inspector of a role that needs one) and how the invite
 * goes: Send Email, or Create Link (Kenneth, 27 October 2026: Supabase's
 * built-in mailer only reaches the project's team), which makes the account
 * without an email and shows the link to send by hand, as Copy Invite Link
 * does. No name: the invitee gives their name, phone and password on Account
 * Creation, from the link. Disabled, with the reason shown on the page, when
 * the server has no secret key to invite with.
 */
export function InviteUserDialog({
  disabled = false,
  label = "Invite User",
  teams = true,
  leads = [],
  roles = [],
}: {
  disabled?: boolean;
  label?: string;
  /** False until the project has lead inspectors (migration 20261007170000): roles only. */
  teams?: boolean;
  /** Active lead inspectors, for the lead of a role that needs one. */
  leads?: readonly LeadOption[];
  /** The roles to choose from (UserDirectory.roles): the built-in ones first, then custom roles. */
  roles?: readonly RoleOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // A fresh form, with empty fields and no old errors, every time it opens.
  const [formKey, setFormKey] = useState(0);
  const pending = useRef(false);
  // A link was made, and inviteUser left the list as it was (the new row could take this dialog off the page):
  // it is drawn again once the dialog closes.
  const linkMade = useRef(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending.current) return;
        if (next) setFormKey((key) => key + 1);
        if (!next && linkMade.current) {
          linkMade.current = false;
          router.refresh();
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={disabled}>
          <UserPlusIcon aria-hidden />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent
        className={cn("sm:max-w-lg", SCROLLING_DIALOG)}
        onInteractOutside={(event) => {
          if (pending.current) event.preventDefault();
        }}
      >
        <InviteForm
          key={formKey}
          teams={teams}
          leads={leads}
          roles={roles}
          onPendingChange={(value) => {
            pending.current = value;
          }}
          onLinkMade={() => {
            linkMade.current = true;
          }}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

const IDLE: InviteLinkResult = { status: "idle" };

function InviteForm({
  teams,
  leads,
  roles,
  onDone,
  onPendingChange,
  onLinkMade,
}: {
  teams: boolean;
  leads: readonly LeadOption[];
  roles: readonly RoleOption[];
  onDone: () => void;
  onPendingChange: (pending: boolean) => void;
  onLinkMade: () => void;
}) {
  const id = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const roleRef = useRef<HTMLDivElement>(null);
  const leadRef = useRef<HTMLButtonElement>(null);
  // Controlled, and submitted by hand (submitAction): React resets a form after its action, and the role's and the
  // invitation's RadioGroups and the lead's Select would go back to their first values on that reset, so a failed
  // invite keeps everything the admin chose. The role starts on Inspector, the least anyone is given.
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(() => {
    const start = defaultRole(roles);
    return start ? roleValue(start) : "";
  });
  const [leadId, setLeadId] = useState("");
  const [delivery, setDelivery] = useState<InviteDelivery>("email");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [copied, setCopied] = useState(false);

  const [state, formAction, pending] = useActionState(async (previous: InviteLinkResult, formData: FormData) => {
    onPendingChange(true);
    try {
      const result = await inviteUser(previous, formData).catch(unreachable);
      const errors = result.status === "error" ? (result.fieldErrors ?? {}) : {};
      setFieldErrors(errors);
      // To the first field marked, in the form's order. With nobody to lead
      // them the action marks the role, not the empty, disabled picker.
      if (errors.email) emailRef.current?.focus();
      else if (errors.role) focusRole(roleRef.current);
      else if (errors.leadId) leadRef.current?.focus();

      if (result.status === "link") {
        // The dialog stays open on the link, copied when the browser lets it.
        onLinkMade();
        setCopied(await copyNewLink(result.link, invitedAddress(formData)));
      } else if (result.status === "success") {
        toast.success(result.message);
        onDone();
      } else if (result.status === "warning") {
        toast.warning(result.message, { duration: 12_000 });
        onDone();
      }
      return result;
    } finally {
      onPendingChange(false);
    }
  }, IDLE);

  if (state.status === "link") {
    return (
      <InviteLinkView
        // A new account has its UID, but nothing here has read it: the list shows it once the dialog closes.
        user={{ uid: null, name: email.trim().toLowerCase() }}
        link={state.link}
        message={state.message}
        copied={copied}
        onCopy={async (field) => setCopied(await copyLinkAgain(field, state.link))}
      />
    );
  }

  const formError = state.status === "error" && !state.fieldErrors ? state.message : null;
  const emailError = fieldErrors.email;
  const chosen = roles.find((option) => roleValue(option) === role);
  const byLink = delivery === "link";

  return (
    <form onSubmit={submitAction(formAction, pending)} noValidate className="grid gap-6">
      <DialogHeader>
        <DialogTitle className="text-lg font-bold">Invite a User</DialogTitle>
        {/* One line, so the dialog fits an iPad in landscape: How to Invite says how the link goes. */}
        <DialogDescription>They create their account from a link: their name, phone and password.</DialogDescription>
      </DialogHeader>

      <FieldGroup className="gap-5">
        <Field data-invalid={emailError ? true : undefined}>
          <FieldLabel htmlFor={`${id}-email`}>Email</FieldLabel>
          <Input
            ref={emailRef}
            id={`${id}-email`}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (emailError) setFieldErrors((errors) => ({ ...errors, email: undefined }));
            }}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? `${id}-email-error` : undefined}
          />
          {emailError && <FieldError id={`${id}-email-error`}>{emailError}</FieldError>}
        </Field>

        <RoleField
          id={id}
          value={role}
          roles={roles}
          error={fieldErrors.role}
          groupRef={roleRef}
          onChange={(next) => {
            setRole(next);
            if (fieldErrors.role) setFieldErrors((errors) => ({ ...errors, role: undefined }));
          }}
        />

        {teams && chosen && needsLead(chosen.access) && (
          <LeadField
            id={id}
            value={leadId}
            leads={leads}
            error={fieldErrors.leadId}
            triggerRef={leadRef}
            onChange={(next) => {
              setLeadId(next);
              if (fieldErrors.leadId) setFieldErrors((errors) => ({ ...errors, leadId: undefined }));
            }}
          />
        )}

        <DeliveryField
          id={id}
          value={delivery}
          error={fieldErrors.delivery}
          onChange={(next) => {
            setDelivery(next);
            if (fieldErrors.delivery) setFieldErrors((errors) => ({ ...errors, delivery: undefined }));
          }}
        />
      </FieldGroup>

      {formError && (
        <Alert variant="destructive">
          <OctagonXIcon aria-hidden />
          <AlertDescription className="text-destructive">{formError}</AlertDescription>
        </Alert>
      )}

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={pending}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending && <Spinner aria-hidden />}
          {byLink ? (pending ? "Creating Link…" : "Create Link") : pending ? "Sending Invite…" : "Send Invite"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** The address an invite went to, as the action reads it: trimmed and lower-cased. */
function invitedAddress(formData: FormData): string {
  return String(formData.get("email") ?? "").trim().toLowerCase();
}

/**
 * How the invite reaches them: Send Email, or Create Link, a link the admin
 * sends by hand (the link, once made, says where to paste it). Two cards
 * side by side from 640 px, each a line of words, so the dialog stays as
 * short as it can on an iPad in landscape.
 */
function DeliveryField({
  id,
  value,
  onChange,
  error,
}: {
  id: string;
  value: InviteDelivery;
  onChange: (value: InviteDelivery) => void;
  error?: string;
}) {
  return (
    <FieldSet className="gap-3" aria-describedby={error ? `${id}-delivery-error` : undefined}>
      {/* Its own mb-3 sets the gap under it, as under Role (role-fields.tsx). */}
      <FieldLegend id={`${id}-delivery-legend`} variant="label" className="leading-snug">
        How to Invite
      </FieldLegend>
      <RadioGroup
        value={value}
        onValueChange={(next) => {
          if (next === "email" || next === "link") onChange(next);
        }}
        className="grid gap-2 sm:grid-cols-2"
        aria-labelledby={`${id}-delivery-legend`}
        aria-invalid={error ? true : undefined}
      >
        <RadioCard id={`${id}-delivery-email`} value="email" title="Send Email" description="We email them the link." />
        <RadioCard id={`${id}-delivery-link`} value="link" title="Create Link" description="You send it yourself." />
      </RadioGroup>
      {error && <FieldError id={`${id}-delivery-error`}>{error}</FieldError>}
      <input type="hidden" name="delivery" value={value} />
    </FieldSet>
  );
}
