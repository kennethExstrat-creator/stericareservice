// The names the app's screens give a module of their own, over the
// template's wording (docs/DESIGN.md, Step Names). Kenneth (26 October 2026):
// "call this general information": the header module is General Information
// on every screen, its card heading and its short name alike, in every
// template, versions already in use included. The template keeps its
// wording, and so do the export, the Client Report and anything else the
// client reads (BUILD_SPEC 6.2 rule 11).
import type { ModuleKey } from "@/lib/schemas/module-result";
import { shortTitleFor } from "@/lib/templates/short-titles";

/** The header module's name on screen. */
export const GENERAL_INFORMATION = "General Information";

/** Modules the screens name their own way, card heading and short name alike. */
export const SCREEN_NAMES: Readonly<Partial<Record<ModuleKey, string>>> = { header: GENERAL_INFORMATION };

/** A module's card heading on the capture, review and photo screens: the template's title, unless the screens name the module. */
export function screenTitle(key: ModuleKey, title: string): string {
  return SCREEN_NAMES[key] ?? title;
}

/** A module's short name in the menus, Pending and messages (shortTitleFor), unless the screens name the module. */
export function screenShortTitle(key: ModuleKey, title: string): string {
  return SCREEN_NAMES[key] ?? shortTitleFor(key, title);
}
