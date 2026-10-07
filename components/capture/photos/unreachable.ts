import { isNoConnection, type PhotoActionState } from "@/lib/inspections/photos/messages";

/**
 * A Server Action call that never got an answer: the factory Wi-Fi dropped,
 * or a new deployment replaced the action. Shown where the change was
 * asked for, instead of the whole page turning into an error screen. A
 * dropped connection is logged as a warning; anything else as an error.
 */
export function unreachable(error: unknown): PhotoActionState {
  if (isNoConnection(error)) console.warn(error);
  else console.error(error);
  return {
    status: "error",
    message: "Could not reach the server. Check the connection and try again.",
  };
}
