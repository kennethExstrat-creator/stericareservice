// Auto tags on a photo (BUILD_SPEC 8.1): the module it was taken in and the
// size, hand, defect, box, packaging level or item in focus at the time.

export type PhotoTags = {
  module: string;
  size?: string;
  /** "R" or "L" for surgical templates with a hand split. */
  hand?: string;
  defect?: string;
  box?: string;
  /** The packaging level in labelling, as it should read: the inner unit ("Dispenser Box") or the carton ("Carton Box"). */
  level?: string;
  /** An entry of the module's own list, e.g. a document or a loading stage, as it should read. */
  item?: string;
};

/** A tag is a short name, Title Case as the app's labels are (HandToggle names the hands the same way). */
const HAND: Readonly<Record<string, string>> = { R: "Right Hand", L: "Left Hand" };

/**
 * "Dimensions · Size M · Box 253", "Labelling · Size M · Lot no. · Box 253 ·
 * Carton Box", "Loading · Doors closed", for tiles and captions. The level and
 * the item come last, as the capture screen's tag line has them.
 */
export function tagLine({ module, size, hand, defect, box, level, item }: PhotoTags): string {
  return [module, size && `Size ${size}`, hand && (HAND[hand] ?? hand), defect, box && `Box ${box}`, level, item]
    .filter(Boolean)
    .join(" · ");
}
