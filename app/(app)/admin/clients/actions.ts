"use server";

import { refresh } from "next/cache";
import {
  CLIENT_FIELDS,
  CLIENT_LOGOS_BUCKET,
  ClientInputSchema,
  EditTargetSchema,
  LogoConfirmSchema,
  LogoUploadRequestSchema,
  MESSAGES,
  RecordTargetSchema,
  deleteBlocker,
  describeDeleteError,
  describeSaveError,
  failed,
  fieldErrors,
  guarded,
  isLogoOf,
  isLogoType,
  logoFileExists,
  logoFileProblem,
  logoObjectName,
  readClient,
  readForm,
  removeLogoFiles,
  removeUnusedLogos,
  succeeded,
  type ActionResult,
  type ClientField,
  type DatabaseClient,
} from "@/lib/admin/reference";
import { authorizeAction } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/*
 * Client actions for /admin/clients (BUILD_SPEC 3 and 10). Server Actions are
 * public HTTP endpoints: each one checks for an active admin, validates its
 * input with zod and re-reads what it needs. Everything runs on the admin's
 * own client, so Row Level Security and the storage policies check it again.
 *
 * A logo goes up in three steps, because a Server Action takes at most 1 MB
 * and logos may be 2 MB: prepareLogoUpload() checks the file and names the
 * object, the browser uploads straight to Storage with the one-time token,
 * and confirmLogoUpload() makes that object the client's logo and removes
 * the one it replaced.
 */

export type SaveClientResult = ActionResult<ClientField>;

/** Adds a client (no id) or saves changes to one (id and the version the form started from). */
export async function saveClient(_previous: SaveClientResult, formData: FormData): Promise<SaveClientResult> {
  return guarded("saveClient", async (): Promise<SaveClientResult> => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return failed(auth.error);

    const target = EditTargetSchema.safeParse(readForm(formData, ["id", "version"]));
    if (!target.success) return failed(MESSAGES.stale);
    const input = ClientInputSchema.safeParse(readForm(formData, CLIENT_FIELDS));
    if (!input.success) return failed(MESSAGES.checkFields, fieldErrors(input.error));

    const supabase = await createClient();
    const { id, version } = target.data;

    if (!id) {
      const { data, error } = await supabase.from("clients").insert(input.data).select("id").single();
      if (error) return saveFailed(error);
      refresh();
      return succeeded(`${input.data.name} added. You can add their logo now.`, data.id);
    }

    // Only the version the form was opened on: a newer save by someone else matches nothing.
    const { data, error } = await supabase
      .from("clients")
      .update(input.data)
      .eq("id", id)
      .eq("updated_at", version)
      .select("id")
      .maybeSingle();
    if (error) return saveFailed(error);
    if (!data) return notSaved(supabase, id);
    refresh();
    return succeeded(`${input.data.name} saved.`, data.id);
  });
}

function saveFailed(error: { code?: string; message?: string }): SaveClientResult {
  const { message, field } = describeSaveError("client", error);
  if (!field) console.error("[admin/clients] save refused", error.code, error.message);
  return field ? failed<ClientField>(message, { [field]: message }) : failed(message);
}

/** The update matched nothing: someone else saved first (a logo change counts), or deleted the client. */
async function notSaved(supabase: DatabaseClient, id: string): Promise<SaveClientResult> {
  const current = await readClient(supabase, id);
  refresh();
  return failed(
    current
      ? "Someone else changed this client while you were editing. Close the panel to see their changes, or save again to replace them with yours."
      : "This client has been deleted, so your changes were not saved.",
  );
}

/** Deletes a client that no template or inspection uses, and then its logo files. */
export async function deleteClient(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("deleteClient", async (): Promise<ActionResult> => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return failed(auth.error);

    const target = RecordTargetSchema.safeParse(readForm(formData, ["id"]));
    if (!target.success) return failed(MESSAGES.stale);

    const supabase = await createClient();
    const current = await readClient(supabase, target.data.id);
    if (!current) {
      refresh();
      return succeeded("This client was already deleted.");
    }
    const blocker = deleteBlocker(current.usage);
    if (blocker) {
      // The page showed it as unused: show the counts as they are now.
      refresh();
      return failed(blocker);
    }

    const { data, error } = await supabase.from("clients").delete().eq("id", current.id).select("id");
    if (error) {
      console.error("[admin/clients] delete refused", error.code, error.message);
      refresh();
      return failed(describeDeleteError("client", error));
    }
    if (data.length === 0) return failed(`${current.name} could not be deleted. Reload the page and try again.`);

    // The row is gone, so nothing can show these files any more.
    await removeLogoFiles(supabase, current.id, current.logoPath);
    refresh();
    return succeeded(`${current.name} deleted.`);
  });
}

export type PrepareLogoResult =
  | { status: "ready"; path: string; token: string }
  | { status: "error"; message: string };

/**
 * Step 1 of a logo upload: checks the file's type and size and that the
 * client exists, then names the object and signs a one-time upload for it.
 */
export async function prepareLogoUpload(request: { clientId: string; type: string; size: number }): Promise<PrepareLogoResult> {
  return guarded("prepareLogoUpload", async (): Promise<PrepareLogoResult> => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return failed(auth.error);

    const parsed = LogoUploadRequestSchema.safeParse(request);
    if (!parsed.success) return failed(MESSAGES.stale);
    const { clientId, type, size } = parsed.data;
    const problem = logoFileProblem({ type, size });
    if (problem || !isLogoType(type)) return failed(problem ?? MESSAGES.stale);

    const supabase = await createClient();
    const client = await readClient(supabase, clientId);
    if (!client) {
      refresh();
      return failed("This client has been deleted. Close the panel to see the current list.");
    }

    const { data, error } = await supabase.storage
      .from(CLIENT_LOGOS_BUCKET)
      .createSignedUploadUrl(logoObjectName(client.id, type));
    if (error) {
      console.error("[admin/clients] could not sign a logo upload", error.message);
      return failed("The upload could not start. Try again.");
    }
    return { status: "ready", path: data.path, token: data.token };
  });
}

/**
 * Step 3 of a logo upload, once the browser has stored the file: makes it the
 * client's logo and removes the logo it replaces.
 */
export async function confirmLogoUpload(request: { clientId: string; path: string }): Promise<ActionResult> {
  return guarded("confirmLogoUpload", async (): Promise<ActionResult> => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return failed(auth.error);

    const parsed = LogoConfirmSchema.safeParse(request);
    // Only an object in this client's own folder, named as prepareLogoUpload() names them.
    if (!parsed.success || !isLogoOf(parsed.data.path, parsed.data.clientId)) return failed(MESSAGES.stale);
    const { path } = parsed.data;

    const supabase = await createClient();
    const client = await readClient(supabase, parsed.data.clientId);
    if (!client) {
      await removeLogoFiles(supabase, parsed.data.clientId, null);
      refresh();
      return failed("This client has been deleted, so the logo was not kept.");
    }
    if (!(await logoFileExists(supabase, path))) return failed("The upload did not finish. Choose the image again.");

    if (client.logoPath !== path) {
      const { data, error } = await supabase
        .from("clients")
        .update({ logo_path: path })
        .eq("id", client.id)
        .select("id")
        .maybeSingle();
      if (error) {
        console.error("[admin/clients] could not set the logo", error.code, error.message);
        return failed("The logo could not be saved. Try again.");
      }
      if (!data) return failed("This client has been deleted, so the logo was not kept.");
      await removeUnusedLogos(supabase, client.id, { keep: path, previous: client.logoPath });
    }

    refresh();
    return succeeded(client.logoPath && client.logoPath !== path ? "Logo replaced." : "Logo added.");
  });
}

/** Takes the logo off a client and deletes its file. */
export async function removeClientLogo(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return guarded("removeClientLogo", async (): Promise<ActionResult> => {
    const auth = await authorizeAction("admin");
    if (!auth.ok) return failed(auth.error);

    const target = RecordTargetSchema.safeParse(readForm(formData, ["id"]));
    if (!target.success) return failed(MESSAGES.stale);

    const supabase = await createClient();
    const client = await readClient(supabase, target.data.id);
    if (!client) {
      refresh();
      return failed("This client has been deleted. Close the panel to see the current list.");
    }
    if (!client.logoPath) {
      refresh();
      return succeeded("The logo was already removed.");
    }

    const { data, error } = await supabase
      .from("clients")
      .update({ logo_path: null })
      .eq("id", client.id)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[admin/clients] could not remove the logo", error.code, error.message);
      return failed("The logo could not be removed. Try again.");
    }
    if (!data) return failed("This client has been deleted. Close the panel to see the current list.");

    await removeUnusedLogos(supabase, client.id, { keep: null, previous: client.logoPath });
    refresh();
    return succeeded("Logo removed.");
  });
}
