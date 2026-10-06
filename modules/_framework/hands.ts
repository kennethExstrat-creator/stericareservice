// Right and left hand split (BUILD_SPEC 6.1 `handSplit`): surgical templates
// record watertight and visual counts per hand. A module that supports it
// declares `handSplit: true` and has a boolean `handSplit` in its config.
import { z } from "zod";

export const HANDS = ["R", "L"] as const;
export const HandSchema = z.enum(HANDS);
export type Hand = z.infer<typeof HandSchema>;

export const HAND_LABEL: Readonly<Record<Hand, string>> = { R: "Right hand", L: "Left hand" };

/** True when the module supports the split and its config switches it on. */
export function isHandSplit(definition: { readonly handSplit: boolean }, config: unknown): boolean {
  return (
    definition.handSplit &&
    typeof config === "object" &&
    config !== null &&
    (config as { handSplit?: unknown }).handSplit === true
  );
}
