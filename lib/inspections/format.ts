import type { InspectionStatus } from "@/lib/schemas/common";

/** Workflow status labels (BUILD_SPEC 5: draft, submitted, approved, reopened). */
export const INSPECTION_STATUS_LABEL: Readonly<Record<InspectionStatus, string>> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  reopened: "Reopened",
};

// British order, short month: 6 Oct 2026. Dates are calendar dates (the
// inspection day in Malaysia), so they are formatted in UTC and never shift.
const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** `2026-10-06` as `6 Oct 2026`. Anything that is not a calendar date is shown as it is. */
export function formatInspectionDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const [, year, month, day] = match;
  return DATE_FORMAT.format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
}

/** A manufacturer by company and, when it has several plants, factory. */
export function manufacturerLabel(manufacturer: { name: string; factory_name: string | null }): string {
  const factory = manufacturer.factory_name?.trim();
  return factory ? `${manufacturer.name} · ${factory}` : manufacturer.name;
}

/** A person by name, falling back to their email address. */
export function personLabel(person: { full_name: string | null; email: string | null } | null): string | null {
  if (!person) return null;
  return person.full_name?.trim() || person.email?.trim() || null;
}
