"use server";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import {
  MESSAGES,
  RecordTargetSchema,
  failed,
  fieldErrors,
  readForm,
  succeeded,
  type DatabaseClient,
} from "@/lib/admin/reference";
import {
  ROLE_MESSAGES,
  RoleInputSchema,
  RoleVersionSchema,
  cleanPermissions,
  deleteBlocker,
  describeRoleDeleteError,
  describeRoleSaveError,
  readRole,
  readRoleForm,
  roleSnapshot,
  type RoleField,
  type RoleInput,
  type RoleResult,
} from "@/lib/admin/roles";
import { createClient } from "@/lib/supabase/server";
import { authorizeFullAdmin } from "./_lib/full-admin";

/*
 * Role actions for /admin/roles (migration 20261027150000). Server Actions
 * are public HTTP endpoints: each one checks for an active person with the
 * built-in Admin role, validates its input with zod and re-reads what it
 * needs. Writes go through the admin's own client, so Row Level Security and
 * the roles guard check them again: the built-in roles keep their name and
 * what they see, the Admin role keeps every permission, and a role people
 * still have keeps what it sees and is not deleted.
 */

/** Adds a custom role. */
export async function createRole(_previous: RoleResult, formData: FormData): Promise<RoleResult> {
  return guarded("createRole", async (): Promise<RoleResult> => {
    const auth = await authorizeFullAdmin();
    if (!auth.ok) return failed(auth.error);

    const input = parseRole(formData);
    if (!input.ok) return input.result;

    const supabase = await createClient();
    const { data, error } = await supabase.from("roles").insert(input.role).select("id").single();
    if (error) return saveFailed(error);
    refresh();
    return succeeded(`${input.role.name} added.`, { id: data.id });
  });
}

/**
 * Saves changes to a role, against the version the panel opened on. A
 * built-in role changes only its description and switches; the Admin role
 * does not change.
 */
export async function updateRole(_previous: RoleResult, formData: FormData): Promise<RoleResult> {
  return guarded("updateRole", async (): Promise<RoleResult> => {
    const auth = await authorizeFullAdmin();
    if (!auth.ok) return failed(auth.error);

    const target = RoleVersionSchema.safeParse(readForm(formData, ["id", "version"]));
    if (!target.success) return failed(MESSAGES.stale);
    const input = parseRole(formData);
    if (!input.ok) return input.result;

    const supabase = await createClient();
    const current = await readRole(supabase, target.data.id);
    if (!current) {
      refresh();
      return failed(ROLE_MESSAGES.deleted);
    }
    if (current.builtIn === "admin") return failed(ROLE_MESSAGES.adminRole);

    // What a built-in role sees stays, so its switches are cleaned for that, not for what the form sent.
    const changes: Partial<RoleInput> = current.builtIn
      ? { description: input.role.description, permissions: cleanPermissions(input.role.permissions, current.access) }
      : input.role;

    // Only the version the panel opened on: a newer save by someone else matches nothing.
    const { data, error } = await supabase
      .from("roles")
      .update(changes)
      .eq("id", current.id)
      .eq("updated_at", target.data.version)
      .select("id")
      .maybeSingle();
    if (error) return saveFailed(error);
    if (!data) return notSaved(supabase, current.id, target.data.version);
    refresh();
    return succeeded(`${current.builtIn ? current.name : input.role.name} saved.`, { id: data.id });
  });
}

/** Deletes a custom role that nobody has. */
export async function deleteRole(_previous: RoleResult, formData: FormData): Promise<RoleResult> {
  return guarded("deleteRole", async (): Promise<RoleResult> => {
    const auth = await authorizeFullAdmin();
    if (!auth.ok) return failed(auth.error);

    const target = RecordTargetSchema.safeParse(readForm(formData, ["id"]));
    if (!target.success) return failed(MESSAGES.stale);

    const supabase = await createClient();
    const current = await readRole(supabase, target.data.id);
    if (!current) {
      refresh();
      return succeeded("This role was already deleted.");
    }
    const blocker = deleteBlocker(current);
    if (blocker) {
      // The page showed it as free to delete: show who has it now.
      refresh();
      return failed(blocker);
    }

    const { data, error } = await supabase.from("roles").delete().eq("id", current.id).select("id");
    if (error) {
      console.error("[admin/roles] delete refused", error.code, error.message);
      refresh();
      return failed(describeRoleDeleteError(error));
    }
    if (data.length === 0) return failed(`${current.name} could not be deleted. Reload the page and try again.`);

    refresh();
    return succeeded(`${current.name} deleted.`);
  });
}

/**
 * The role the form sends, cleaned. A permission the list does not know
 * comes only from a page older than the list: reloading it is the answer.
 */
function parseRole(formData: FormData): { ok: true; role: RoleInput } | { ok: false; result: RoleResult } {
  const parsed = RoleInputSchema.safeParse(readRoleForm(formData));
  if (parsed.success) return { ok: true, role: parsed.data };
  const errors = fieldErrors(parsed.error);
  if (errors.permissions) return { ok: false, result: failed(MESSAGES.stale) };
  return { ok: false, result: failed<RoleField>(MESSAGES.checkFields, errors) };
}

function saveFailed(error: { code?: string; message?: string }): RoleResult {
  const { message, field } = describeRoleSaveError(error);
  if (!field) console.error("[admin/roles] save refused", error.code, error.message);
  return field ? failed<RoleField>(message, { [field]: message }) : failed(message);
}

/**
 * The update matched nothing: someone else saved first, or deleted the role,
 * or (the version unchanged) row level security found nothing this admin may
 * change. With someone else's version (`latest`), the panel's next save
 * replaces it, as the message offers.
 */
async function notSaved(supabase: DatabaseClient, id: string, version: string): Promise<RoleResult> {
  const latest = await readRole(supabase, id);
  refresh();
  if (!latest) return failed(ROLE_MESSAGES.deleted);
  if (latest.updatedAt === version) return failed(ROLE_MESSAGES.notFullAdmin);
  return { ...failed(ROLE_MESSAGES.conflict), latest: roleSnapshot(latest) };
}

/**
 * Runs an action body. An unexpected failure becomes a message on the form
 * instead of an error page; Next.js redirects and 404s pass through.
 */
async function guarded(name: string, run: () => Promise<RoleResult>): Promise<RoleResult> {
  try {
    return await run();
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[admin/roles] ${name} failed`, error);
    return failed(MESSAGES.unexpected);
  }
}
