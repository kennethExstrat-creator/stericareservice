// The /design sections, in page order. The index and the page read this list.
export const SECTIONS = [
  { id: "logo", label: "Logo" },
  { id: "colours", label: "Colour tokens" },
  { id: "status", label: "Status colours" },
  { id: "type", label: "Type scale" },
  { id: "buttons", label: "Buttons" },
  { id: "inputs", label: "Inputs" },
  { id: "steppers", label: "Steppers" },
  { id: "defects", label: "Defect chips" },
  { id: "grid", label: "Sample grid" },
  { id: "pills", label: "Results and saving" },
  { id: "module", label: "Module card" },
  { id: "photos", label: "Photo tiles" },
  { id: "progress", label: "Progress" },
  { id: "header", label: "Page header" },
  { id: "layout", label: "Layout rule" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];
