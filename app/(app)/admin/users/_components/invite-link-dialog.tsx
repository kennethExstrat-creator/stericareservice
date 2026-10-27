"use client";

// Copy Invite Link (user-menu.ts): a link for someone invited, for the admin
// to send by WhatsApp or any chat, since Supabase's built-in mailer only
// reaches the project's team, a few emails an hour. The dialog asks first: a
// new link stops every earlier one working, the emailed invite's included.
// Then it copies the link and shows it in a field, with Copy Link for when
// the browser would not copy it by itself: the iPad copies only straight from
// a tap, and the server's answer comes after the tap; the app opened by its
// local network address (plain http) has no Clipboard API at all. Invite
// User's Create Link shows its link the same way (InviteLinkView).
import { useActionState, useEffect, useId, useRef, useState, type RefObject } from "react";
import { CopyIcon, OctagonXIcon } from "lucide-react";
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
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { createInviteLink, type InviteLinkResult } from "../actions";
import { SCROLLING_DIALOG } from "./role-fields";
import { TitleWithUid } from "./uid-badge";
import { unreachable } from "./unreachable";
import { DIALOG_TITLE, type UserActionsTarget } from "./user-menu";

const IDLE: InviteLinkResult = { status: "idle" };

/** Copies with the Clipboard API where the page may use it (HTTPS, or localhost); false when the browser refuses. */
async function writeClipboard(text: string): Promise<boolean> {
  if (!window.isSecureContext || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The field's text, selected and copied the older way, which needs no Clipboard API. Called straight from a tap. */
function copySelection(field: HTMLInputElement | null): boolean {
  if (!field) return false;
  field.focus();
  field.setSelectionRange(0, field.value.length);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

/** Copy Link, from a tap: the Clipboard API, else the selected field; the field stays selected either way. */
function copyFromField(field: HTMLInputElement | null, text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => copySelection(field),
    );
  }
  return Promise.resolve(copySelection(field));
}

/** A link the server just made, onto the clipboard where the browser lets it, said in a toast. True once copied. */
export async function copyNewLink(link: string, name: string): Promise<boolean> {
  const done = await writeClipboard(link);
  if (done) toast.success(`Invite link for ${name} copied.`);
  return done;
}

/** Copy Link's tap: copied again, else left selected in its field to copy by hand. True once copied. */
export async function copyLinkAgain(field: HTMLInputElement | null, link: string): Promise<boolean> {
  const done = await copyFromField(field, link);
  if (done) toast.success("Invite link copied.");
  else toast.error("The browser would not copy the link. It is selected in the field: copy it from there.");
  return done;
}

export function InviteLinkDialog({
  user,
  onClose,
  returnFocusTo,
}: {
  user: Pick<UserActionsTarget, "id" | "uid" | "name">;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
}) {
  const [copied, setCopied] = useState(false);

  const [state, formAction, pending] = useActionState(async (previous: InviteLinkResult, formData: FormData) => {
    const result = await createInviteLink(previous, formData).catch(unreachable);
    if (result.status === "link") setCopied(await copyNewLink(result.link, user.name));
    return result;
  }, IDLE);
  const created = state.status === "link" ? state : null;

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
        {created ? (
          <InviteLinkView
            user={user}
            link={created.link}
            message={created.message}
            copied={copied}
            onCopy={async (field) => setCopied(await copyLinkAgain(field, created.link))}
          />
        ) : (
          <form action={formAction} className="grid gap-6" data-testid="invite-link-form">
            <DialogHeader>
              <TitleWithUid uid={user.uid}>
                <DialogTitle className="text-lg font-bold">{DIALOG_TITLE["copy-invite-link"](user.name)}</DialogTitle>
              </TitleWithUid>
              <DialogDescription>
                A link to send them yourself, by WhatsApp or any chat, when the invite email does not reach them. It
                signs them in to create their account: name, phone and password. Any link sent or copied before stops
                working, the one in their invite email included.
              </DialogDescription>
            </DialogHeader>

            <input type="hidden" name="userId" value={user.id} />

            {/* role="alert": read out as soon as it appears. */}
            {state.status === "error" && (
              <Alert variant="destructive">
                <OctagonXIcon aria-hidden />
                <AlertDescription className="text-destructive">{state.message}</AlertDescription>
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
                {pending ? "Creating…" : "Create Link"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The link once made: in a read-only field, focused and selected as it
 * shows, with what it does, whether it is on the clipboard, Copy Link and
 * Done.
 */
export function InviteLinkView({
  user,
  link,
  message,
  copied,
  onCopy,
}: {
  user: Pick<UserActionsTarget, "uid" | "name">;
  link: string;
  /** What the server says the link does, how long it works and what it replaced. */
  message: string;
  /** On the clipboard already. */
  copied: boolean;
  /** Copy Link: given the field, to copy from by hand when the browser will not. */
  onCopy: (field: HTMLInputElement | null) => void;
}) {
  const id = useId();
  const fieldRef = useRef<HTMLInputElement>(null);

  // The link in view: into its field, all of it selected, to copy by hand if need be.
  useEffect(() => {
    fieldRef.current?.focus();
    fieldRef.current?.select();
  }, []);

  return (
    <div className="grid gap-6" data-testid="invite-link">
      <DialogHeader>
        <TitleWithUid uid={user.uid}>
          <DialogTitle className="text-lg font-bold">{DIALOG_TITLE["invite-link"](user.name)}</DialogTitle>
        </TitleWithUid>
        <DialogDescription>{message}</DialogDescription>
      </DialogHeader>

      <Field>
        <FieldLabel htmlFor={`${id}-link`}>Invite Link</FieldLabel>
        <Input
          ref={fieldRef}
          id={`${id}-link`}
          readOnly
          value={link}
          spellCheck={false}
          // Whatever was tapped in it, all of it, to copy by hand.
          onFocus={(event) => event.currentTarget.select()}
          aria-describedby={`${id}-link-status`}
          className="font-mono"
        />
        {/* Said again as it changes: copied straight away, or after Copy Link. */}
        <FieldDescription id={`${id}-link-status`} role="status">
          {copied
            ? "Copied. Paste it into WhatsApp or another chat to send it."
            : "Not copied yet: choose Copy Link, or copy it from the field."}
        </FieldDescription>
      </Field>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onCopy(fieldRef.current)}>
          <CopyIcon aria-hidden />
          Copy Link
        </Button>
        <DialogClose asChild>
          <Button type="button">Done</Button>
        </DialogClose>
      </DialogFooter>
    </div>
  );
}
