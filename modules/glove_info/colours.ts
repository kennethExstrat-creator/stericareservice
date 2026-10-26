// Glove Colour's choices (Kenneth, 26 October 2026: a dropdown, each colour
// "with word and a round dot of that colour"). The colour is still kept as
// its name, so the report prints it as before. A name saved earlier that is
// not on the list (typed, or read by Steri-AI) is kept and offered as it is.

export type GloveColour = { name: string; swatch: string };

export const GLOVE_COLOURS: readonly GloveColour[] = [
  { name: "Blue", swatch: "#2563eb" },
  { name: "Light Blue", swatch: "#7dd3fc" },
  { name: "Dark Blue", swatch: "#1e3a8a" },
  { name: "Violet Blue", swatch: "#4f46e5" },
  { name: "Purple", swatch: "#7e22ce" },
  { name: "Pink", swatch: "#ec4899" },
  { name: "Red", swatch: "#dc2626" },
  { name: "Orange", swatch: "#f97316" },
  { name: "Yellow", swatch: "#facc15" },
  { name: "Green", swatch: "#16a34a" },
  { name: "Black", swatch: "#111827" },
  { name: "Grey", swatch: "#9ca3af" },
  { name: "White", swatch: "#ffffff" },
  // Latex's own off-white.
  { name: "Natural", swatch: "#f1e4c3" },
];

/** The listed colour a saved name is, whatever its case or spaces; null for one not on the list. */
export function listedColour(name: string | null): GloveColour | null {
  if (name === null) return null;
  const wanted = name.trim().toLowerCase();
  return GLOVE_COLOURS.find((colour) => colour.name.toLowerCase() === wanted) ?? null;
}
