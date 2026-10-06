// Who did something to an inspection, as the viewer may know it. Row level
// security lets an inspector read their own profile only, so an admin who
// acted on their inspection reaches them without a name: "an admin". Only
// admins and the owner can act on an inspection, so that is what any other
// actor is. Rows written by the service role or the database owner have no
// actor at all: "the system".
import { personLabel } from "@/lib/inspections/format";

export type Actor = { kind: "person"; name: string } | { kind: "admin" } | { kind: "system" };

/** Names the viewer already knows, for people whose profile row level security hides. */
export type KnownPeople = {
  viewerId: string;
  viewerName: string;
  inspectorId: string;
  inspectorName: string;
};

export const SYSTEM: Actor = { kind: "system" };
export const UNNAMED_ADMIN: Actor = { kind: "admin" };

/**
 * The actor of a row: the profile when the viewer can read it, else a name
 * the viewer already knows, else an unnamed admin. No id at all is the system.
 */
export function actorOf(
  id: string | null,
  profile: { full_name: string | null; email: string | null } | null,
  known: Partial<KnownPeople>,
): Actor {
  if (id === null) return SYSTEM;
  const name =
    personLabel(profile) ??
    (id === known.viewerId ? known.viewerName : undefined) ??
    (id === known.inspectorId ? known.inspectorName : undefined);
  return name ? { kind: "person", name } : UNNAMED_ADMIN;
}

/** "Test Admin", "an admin", "the system"; capitalised to open a sentence. */
export function actorText(actor: Actor, { start = false }: { start?: boolean } = {}): string {
  switch (actor.kind) {
    case "person":
      return actor.name;
    case "admin":
      return start ? "An admin" : "an admin";
    case "system":
      return start ? "The system" : "the system";
  }
}
