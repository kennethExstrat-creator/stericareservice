// The /design sections, in page order. The index and the page read this list,
// and each section's heading is its label here (design-section.tsx).
export const SECTIONS = [
  { id: "logo", label: "Logo" },
  { id: "colours", label: "Colour Tokens" },
  { id: "status", label: "Status Colours" },
  { id: "type", label: "Type Scale" },
  { id: "buttons", label: "Buttons" },
  { id: "inputs", label: "Inputs" },
  { id: "steppers", label: "Steppers" },
  { id: "defects", label: "Defect Chips" },
  { id: "grid", label: "Sample Grid" },
  { id: "pills", label: "Results and Saving" },
  { id: "module", label: "Module Card" },
  { id: "photos", label: "Photo Tiles" },
  { id: "progress", label: "Progress" },
  { id: "header", label: "Page Header" },
  { id: "layout", label: "Layout Rule" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

/** A section's name: the same in the index and as the section's heading. */
export function sectionLabel(id: SectionId): string {
  return SECTIONS.find((section) => section.id === id)?.label ?? id;
}
