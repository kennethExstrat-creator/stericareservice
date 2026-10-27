// Delete Permanently's typed confirmation (Kenneth, 27 October 2026: "admin
// should be able to permanently delete deactivated users"): an account goes
// for good, so before Delete Permanently works the admin types the person's
// UID, or their email on a project without UIDs (migration 20261008140000),
// as for any destructive step that cannot be undone. The dialog enables the
// button with it, and the action checks it again against the profile it
// reads. Client-safe: both use these.

/** What the admin types to delete someone for good: their UID, else their email, else (neither known) their id. */
export function deletionWord(person: { id: string; uid: string | null | undefined; email: string | null | undefined }): string {
  return person.uid?.trim() || person.email?.trim() || person.id;
}

/**
 * True when what was typed is that word, spaces around it and letter case
 * aside: the iPad starts a field with a capital, and an address is the same
 * in any case.
 */
export function confirmsDeletion(typed: string, word: string): boolean {
  const expected = word.trim().toLowerCase();
  return expected !== "" && typed.trim().toLowerCase() === expected;
}
