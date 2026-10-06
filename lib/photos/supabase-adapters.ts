import { isAuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";
import type { SupabasePublicEnv } from "@/lib/env";
import type { OfflineDatabase } from "@/lib/offline/db";
import {
  FAILURE_MESSAGES,
  postgrestFailure,
  reasonForStatus,
  type Failure,
  type FailureReason,
} from "@/lib/offline/failures";
import type { Database } from "@/lib/supabase/database.types";
import type { MediaBucket } from "./paths";
import {
  createUploadQueue,
  type MediaRepository,
  type TransferOutcome,
  type UploadQueue,
  type UploadRequest,
  type UploadStorage,
} from "./upload-queue";

/* ------------------------------------------------------------------ *
 * Supabase behind the upload queue's interfaces. Uploads use
 * XMLHttpRequest against the Storage API rather than supabase-js:
 * fetch cannot report upload progress, and the badge shows it.
 * ------------------------------------------------------------------ */

export const UPLOAD_STALL_TIMEOUT_MS = 60_000;

export interface SupabaseStorageOptions {
  /** NEXT_PUBLIC_SUPABASE_URL. */
  url: string;
  /** The publishable key. */
  apiKey: string;
  /**
   * The signed-in user's access token, e.g. sessionToken(client). Null when
   * signed out; rejects when it cannot tell (offline with a token due for
   * refresh), which counts as a network failure.
   */
  getAccessToken(): Promise<string | null>;
  /** An upload with no progress for this long is abandoned and retried. */
  stallTimeoutMs?: number;
  createRequest?: () => XMLHttpRequest;
  fetch?: typeof fetch;
}

type Refused = { ok: false } & Failure;

const SIGNED_OUT: Refused = { ok: false, reason: "unauthorized", message: FAILURE_MESSAGES.unauthorized };
const NO_CONNECTION: Refused = { ok: false, reason: "network", message: FAILURE_MESSAGES.network };

/** The access token, or why there is none: signed out, or no connection to refresh it. */
async function readToken(getAccessToken: () => Promise<string | null>): Promise<{ ok: true; token: string } | Refused> {
  try {
    const token = await getAccessToken();
    return token ? { ok: true, token } : SIGNED_OUT;
  } catch {
    return NO_CONNECTION;
  }
}

export function supabaseStorage(options: SupabaseStorageOptions): UploadStorage {
  const base = `${options.url.replace(/\/+$/, "")}/storage/v1/object`;
  const createRequest = options.createRequest ?? (() => new XMLHttpRequest());
  const stallMs = options.stallTimeoutMs ?? UPLOAD_STALL_TIMEOUT_MS;

  return {
    async upload(request) {
      const access = await readToken(options.getAccessToken);
      if (!access.ok) return access;
      const headers = { authorization: `Bearer ${access.token}`, apikey: options.apiKey };
      return send(createRequest(), `${base}/${request.bucket}/${request.path}`, headers, request, stallMs);
    },

    async remove(bucket: MediaBucket, paths: string[]) {
      const access = await readToken(options.getAccessToken);
      if (!access.ok) return access;
      const fetchImpl = options.fetch ?? fetch;
      let response: Response;
      try {
        response = await fetchImpl(`${base}/${bucket}`, {
          method: "DELETE",
          headers: { authorization: `Bearer ${access.token}`, apikey: options.apiKey, "content-type": "application/json" },
          body: JSON.stringify({ prefixes: paths }),
        });
      } catch {
        return { ok: false, reason: "network", message: FAILURE_MESSAGES.network };
      }
      return storageOutcome(response.status, await response.text().catch(() => ""));
    },
  };
}

function send(
  xhr: XMLHttpRequest,
  url: string,
  headers: Record<string, string>,
  request: UploadRequest,
  stallMs: number,
): Promise<TransferOutcome> {
  return new Promise<TransferOutcome>((resolve) => {
    let settled = false;
    let stall: ReturnType<typeof setTimeout> | undefined;
    const finish = (outcome: TransferOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(stall);
      request.signal.removeEventListener("abort", cancel);
      resolve(outcome);
    };
    // Settle before aborting: abort() fires onabort at once, which would settle as "cancelled".
    const cancel = () => {
      finish({ ok: false, reason: "network", message: "The upload was cancelled." });
      xhr.abort();
    };
    const watch = () => {
      clearTimeout(stall);
      stall = setTimeout(() => {
        finish({ ok: false, reason: "network", message: "The upload stalled. It will be retried." });
        xhr.abort();
      }, stallMs);
    };

    xhr.open("POST", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.setRequestHeader("content-type", request.contentType);
    xhr.setRequestHeader("cache-control", "max-age=3600");
    // Never overwrite: an object already at this name is this item's own earlier upload.
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (event) => {
      watch();
      request.onProgress?.(event.loaded, event.lengthComputable ? event.total : request.body.size);
    };
    xhr.onload = () => finish(storageOutcome(xhr.status, xhr.responseText));
    xhr.onerror = () => finish({ ok: false, reason: "network", message: FAILURE_MESSAGES.network });
    xhr.onabort = () => finish({ ok: false, reason: "network", message: "The upload was cancelled." });

    if (request.signal.aborted) {
      cancel();
      return;
    }
    request.signal.addEventListener("abort", cancel);
    watch();
    xhr.send(request.body);
  });
}

/**
 * Reads a Storage API answer. Errors come as JSON { statusCode, error,
 * message }, where older Storage versions send HTTP 400 and put the real
 * code in statusCode. An object that already exists counts as uploaded.
 */
export function storageOutcome(status: number, body: string): TransferOutcome {
  if (status >= 200 && status < 300) return { ok: true };
  let info: { statusCode?: unknown; error?: unknown; message?: unknown } = {};
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object") info = parsed;
  } catch {
    // Not JSON: go by the HTTP status.
  }
  const code = Number(info.statusCode) || status;
  const text = `${String(info.error ?? "")} ${String(info.message ?? "")}`;
  if (code === 409 || /duplicate|already exists/i.test(text)) return { ok: true };
  const reason: FailureReason = /jwt|exp" claim|invalid signature/i.test(text) ? "unauthorized" : reasonForStatus(code);
  const message = typeof info.message === "string" && info.message ? info.message : FAILURE_MESSAGES[reason];
  return { ok: false, reason, message };
}

/* ------------------------------------------------------------------ *
 * Rows
 * ------------------------------------------------------------------ */

type PostgrestAnswer = { error: { code?: string; message: string } | null; status: number };

/** A PostgREST answer as an outcome. A duplicate key means the row is already there: success. */
export function postgrestOutcome({ error, status }: PostgrestAnswer): TransferOutcome {
  if (!error) return { ok: true };
  if (error.code === "23505") return { ok: true };
  return { ok: false, ...postgrestFailure(error, status) };
}

export function supabaseRepository(client: SupabaseClient<Database>): MediaRepository {
  // Without a session supabase-js would send the request as anon, which no table lets in.
  const signedIn = async (): Promise<Refused | null> => {
    const access = await readToken(() => sessionToken(client));
    return access.ok ? null : access;
  };
  return {
    async insertPhoto(row) {
      return (await signedIn()) ?? postgrestOutcome(await client.from("inspection_photos").insert(row));
    },
    async updatePhoto(id, patch) {
      const refused = await signedIn();
      if (refused) return refused;
      const answer = await client.from("inspection_photos").update(patch).eq("id", id).select("id");
      if (answer.error) return postgrestOutcome(answer);
      // Row level security hides rows this user may not change: no row back means not allowed now.
      return answer.data && answer.data.length > 0
        ? { ok: true }
        : { ok: false, reason: "forbidden", message: FAILURE_MESSAGES.forbidden };
    },
    async insertFile(row) {
      return (await signedIn()) ?? postgrestOutcome(await client.from("inspection_files").insert(row));
    },
  };
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

/**
 * The signed-in user's access token, or null when signed out. getSession()
 * refreshes a token that is due; when that refresh cannot reach Supabase
 * (offline), this throws, so callers report no connection rather than an
 * ended session.
 */
export async function sessionToken(client: SupabaseClient<Database>): Promise<string | null> {
  const { data, error } = await client.auth.getSession();
  if (data.session?.access_token) return data.session.access_token;
  if (error && isAuthRetryableFetchError(error)) throw error;
  return null;
}

export interface SupabaseUploadQueueOptions {
  /** The browser client (lib/supabase/client.ts). */
  client: SupabaseClient<Database>;
  /** getSupabasePublicEnv() (lib/env.ts). */
  env: SupabasePublicEnv;
  userId: string;
  /** getOfflineDatabase() (lib/offline/db.ts). */
  db: OfflineDatabase;
}

/** The app's upload queue: IndexedDB for the items, Supabase for the uploads. One per page. */
export function createSupabaseUploadQueue({ client, env, userId, db }: SupabaseUploadQueueOptions): UploadQueue {
  return createUploadQueue({
    userId,
    items: db.store("uploads"),
    blobs: db.store("upload-blobs"),
    persistent: db.persistent,
    storage: supabaseStorage({ url: env.url, apiKey: env.publishableKey, getAccessToken: () => sessionToken(client) }),
    repository: supabaseRepository(client),
  });
}
