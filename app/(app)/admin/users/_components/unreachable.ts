import type { ActionResult } from "../actions";

/**
 * A Server Action call that never got an answer: the connection dropped (an
 * iPad on factory Wi-Fi), or a new deployment replaced the action. The dialog
 * shows this instead of the whole page turning into an error screen.
 */
export function unreachable(error: unknown): ActionResult {
  console.error(error);
  return {
    status: "error",
    message: "Could not reach the server. Check the connection, then reload the page and try again.",
  };
}
