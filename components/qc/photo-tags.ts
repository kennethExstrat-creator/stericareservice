// Auto tags on a photo (BUILD_SPEC 8.1): the module it was taken in and the
// size, hand, defect, box or item in focus at the time.

export type PhotoTags = {
  module: string;
  size?: string;
  /** "R" or "L" for surgical templates with a hand split. */
  hand?: string;
  defect?: string;
  box?: string;
  /** An entry of the module's own list, e.g. a document or a loading stage, as it should read. */
  item?: string;
};

const HAND: Readonly<Record<string, string>> = { R: "Right hand", L: "Left hand" };

/** "Dimensions · Size M · Box 253", "Loading · Doors closed", for tiles and captions. */
export function tagLine({ module, size, hand, defect, box, item }: PhotoTags): string {
  return [module, size && `Size ${size}`, hand && (HAND[hand] ?? hand), defect, box && `Box ${box}`, item]
    .filter(Boolean)
    .join(" · ");
}
