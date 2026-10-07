// Where keyboard focus goes when a Delete's dialog closes (delete-inspection.tsx),
// decided from the ids of the rows on screen, in order. The row's
// neighbours are remembered when its Delete is pressed: `nextId` is the row
// after it, `index` its place in the list.

export type DeletedRow = { id: string; nextId: string | null; index: number };

/**
 * - "wait": the row is still listed; the list without it is on its way.
 * - { row }: that row's main action.
 * - "results": the start of the results (the count above the table, or the
 *   heading of the state shown instead of rows).
 */
export type FocusLanding = "wait" | { row: string } | "results";

/**
 * After a deletion: the row that took the deleted one's place (the one after
 * it, or whichever row is now at its place, such as one from the next page),
 * else the start of the results, which also reads out what is left.
 */
export function landingAfterDelete(rowIds: readonly string[], deleted: DeletedRow): FocusLanding {
  if (rowIds.includes(deleted.id)) return "wait";
  if (deleted.nextId && rowIds.includes(deleted.nextId)) return { row: deleted.nextId };
  const now = rowIds[deleted.index];
  return now ? { row: now } : "results";
}

/**
 * After a cancel whose Delete button went away meanwhile (the list was
 * refreshed: the inspection was submitted or deleted elsewhere): the row's
 * main action if it is still listed, else where it was.
 */
export function landingAfterCancel(rowIds: readonly string[], row: DeletedRow): Exclude<FocusLanding, "wait"> {
  if (rowIds.includes(row.id)) return { row: row.id };
  const now = rowIds[row.index];
  return now ? { row: now } : "results";
}
