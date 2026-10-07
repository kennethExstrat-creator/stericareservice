"use client";

// One option of a RadioGroup as a card: a title over a one-line description,
// the whole card a label for the radio, so a tap anywhere on it chooses. Used
// by the role pickers on /admin/users and "Map To" on /admin/defects.
//
// The radio is named by its title and described by its description directly.
// Through the label alone Chrome names it "": the label holds the radio and
// its text inside Field's role="group", and Chrome takes no text from a group
// for a name, so a screen reader would hear an unnamed radio button.
// Playwright's getByRole computes names itself and finds one anyway, so the
// e2e specs read Chrome's own tree (chromeNames in e2e/users/support.ts).
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field";
import { RadioGroupItem } from "@/components/ui/radio-group";

export function RadioCard({
  id,
  value,
  title,
  description,
}: {
  /** The radio's id; its title and description take the same id ending in -title and -description. */
  id: string;
  value: string;
  title: string;
  description: string;
}) {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  return (
    <FieldLabel htmlFor={id}>
      <Field orientation="horizontal">
        <RadioGroupItem value={value} id={id} aria-labelledby={titleId} aria-describedby={descriptionId} />
        <FieldContent>
          <FieldTitle id={titleId}>{title}</FieldTitle>
          <FieldDescription id={descriptionId}>{description}</FieldDescription>
        </FieldContent>
      </Field>
    </FieldLabel>
  );
}
