import { z } from "zod";

/**
 * The rules for a person's details, shared by the admin's dialogs
 * (lib/auth/users.ts: invite, Edit Details) and the invitee's Account
 * Creation page (lib/auth/forms.ts), so a name or phone number one accepts
 * the other accepts too. No server-only imports: the browser's forms read the
 * limits.
 */

/** The longest name the app saves for someone. */
export const NAME_MAX_LENGTH = 100;

/** One line: any run of spaces, tabs or pasted line breaks becomes a single space (as lib/admin/reference.ts). */
export function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * The name the app shows for someone everywhere (profiles.full_name), on one
 * line, 1 to 100 characters. Any other control character (a pasted NUL or
 * NEL, which no line break rule catches) is refused rather than saved where
 * nobody can see it.
 */
export function fullNameSchema(missing: string) {
  return z
    .string({ error: missing })
    .overwrite(oneLine)
    .min(1, missing)
    .max(NAME_MAX_LENGTH, `Keep the name to ${NAME_MAX_LENGTH} characters or fewer.`)
    .refine((name) => !/\p{Cc}/u.test(name), "The name holds a hidden control character. Type it again.");
}

/** The longest phone number the database takes (profiles_phone_format, migration 20261027140000). */
export const PHONE_MAX_LENGTH = 32;

/** 7 to 15 digits (E.164 allows 15), an optional leading +, and spaces, brackets or hyphens between them. */
const PHONE_SHAPE = /^\+?[0-9(][0-9 ()-]*[0-9]$/;

export const PHONE_HINT = "With the country code if it is outside Malaysia, e.g. +60 12-345 6789.";

/** True when `phone` (already on one line) is a phone number the database accepts. */
export function isPhoneNumber(phone: string): boolean {
  const digits = phone.replace(/[^0-9]/g, "").length;
  return phone.length <= PHONE_MAX_LENGTH && PHONE_SHAPE.test(phone) && digits >= 7 && digits <= 15;
}

const INVALID_PHONE = "Enter a phone number, like +60 12-345 6789 or 012-345 6789.";

/** A phone number as typed, on one line; the database checks the same rule. */
export function phoneSchema(missing: string) {
  return z
    .string({ error: missing })
    .overwrite(oneLine)
    .min(1, missing)
    .refine(isPhoneNumber, INVALID_PHONE);
}

/** For a form where the phone may stay blank (an account from before phones): "" becomes null. */
export const OptionalPhoneSchema = z
  .string()
  .overwrite(oneLine)
  .refine((phone) => phone === "" || isPhoneNumber(phone), INVALID_PHONE)
  .transform((phone) => (phone === "" ? null : phone));
