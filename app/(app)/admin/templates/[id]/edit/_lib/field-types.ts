import type { FieldType } from "@/lib/schemas/common";

/**
 * A custom field's types, as the editor's Type select offers them
 * (custom-module-form.tsx) and the version page lists a custom module's
 * fields (modules-list.tsx). A plain module, so a server component can read
 * the words too.
 */
export const FIELD_TYPE_LABEL: Readonly<Record<FieldType, string>> = {
  counter: "Count (Tap + and −)",
  number: "Number",
  text: "Text",
  textarea: "Long Text",
  select: "Choice From a List",
  yes_no: "Yes / No",
  date: "Date",
  photo: "Photo",
};
