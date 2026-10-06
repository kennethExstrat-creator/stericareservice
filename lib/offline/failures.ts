// Why a save or an upload did not go through, in one vocabulary for the
// autosave transport, the storage client and the photo repository.

export const FAILURE_REASONS = [
  "network",
  "server",
  "unauthorized",
  "forbidden",
  "invalid",
  "too_large",
  "not_found",
] as const;

export type FailureReason = (typeof FAILURE_REASONS)[number];

export interface Failure {
  reason: FailureReason;
  message: string;
}

/**
 * Failures that fix themselves: the connection comes back, the server
 * recovers, Supabase refreshes the session. The rest need a person.
 */
const RETRYABLE: ReadonlySet<FailureReason> = new Set(["network", "server", "unauthorized"]);

export function isRetryable(reason: FailureReason): boolean {
  return RETRYABLE.has(reason);
}

/** An HTTP status as a failure reason. 0 is what a request that never got an answer reports. */
export function reasonForStatus(status: number): FailureReason {
  if (status === 0) return "network";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 413) return "too_large";
  if (status === 408 || status === 429 || status >= 500) return "server";
  return "invalid";
}

export const FAILURE_MESSAGES: Readonly<Record<FailureReason, string>> = {
  network: "No connection. Changes are kept on this device and sync when the connection is back.",
  server: "The server did not answer. Retrying.",
  unauthorized: "Your session has ended. Sign in again to sync.",
  forbidden: "This inspection can no longer be changed from this account.",
  invalid: "The server refused the data.",
  too_large: "The file is too large to upload.",
  not_found: "The inspection no longer exists.",
};

/** Postgres and PostgREST error codes (docs/DATABASE.md, "Notes for app code"). */
const POSTGRES_REASONS: Readonly<Record<string, FailureReason>> = {
  "42501": "forbidden",
  "23503": "not_found",
  "23514": "invalid",
  "23502": "invalid",
  "22P02": "invalid",
  "22023": "invalid",
  PGRST301: "unauthorized",
  PGRST302: "unauthorized",
  PGRST303: "unauthorized",
};

/**
 * A supabase-js (PostgREST) error as a failure. Status 0 is a request that
 * never got an answer. 401 comes first: without a session supabase-js sends
 * the publishable key instead, PostgREST runs the request as anon, and
 * anon's 42501 must read as "sign in again", not "not allowed".
 */
export function postgrestFailure(error: { code?: string; message: string }, status: number): Failure {
  if (status === 401) return { reason: "unauthorized", message: FAILURE_MESSAGES.unauthorized };
  const reason = (error.code && POSTGRES_REASONS[error.code]) || reasonForStatus(status);
  return { reason, message: error.message || FAILURE_MESSAGES[reason] };
}

/** A thrown error as a network failure: a transport that throws instead of answering never reached the server. */
export function thrownFailure(error: unknown): Failure {
  const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
  return { reason: "network", message: `${FAILURE_MESSAGES.network}${detail}` };
}
