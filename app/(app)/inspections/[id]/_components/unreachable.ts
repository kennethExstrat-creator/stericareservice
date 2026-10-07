import { unstable_rethrow } from "next/navigation";

export const UNREACHABLE_MESSAGE = "Could not reach the server. Check the connection, then try again.";

/**
 * A Server Action call that never got an answer: the connection dropped (an
 * iPad on factory Wi-Fi), or a new deployment replaced the action. The form
 * shows this instead of the page turning into an error screen. Next.js's own
 * signals (a redirect to the review, a 404) pass through untouched.
 */
export function unreachable(error: unknown): { status: "error"; message: string } {
  unstable_rethrow(error);
  console.error(error);
  return { status: "error", message: UNREACHABLE_MESSAGE };
}
