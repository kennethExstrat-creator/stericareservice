import type { AiActionState } from "@/lib/inspections/ai/types";

export const UNREACHABLE_MESSAGE = "Could not reach the server. Check the connection, then try again.";

/**
 * A Server Action call that never got an answer: the connection dropped (an
 * iPad on factory Wi-Fi) or a new deployment replaced the action. The form
 * shows this and keeps what was typed, instead of the page turning into the
 * error screen. Use it as `await action(previous, formData).catch(unreachable)`.
 */
export function unreachable(error: unknown): AiActionState {
  console.error("[ai panel] the server could not be reached", error);
  return { status: "error", message: UNREACHABLE_MESSAGE };
}
