// The rings an inspector draws round a defect, moved onto a report tile as
// object-fit: cover crops the image: a photo of the tile's own shape, a wide
// photo in a square tile, a tall one in a 3/2 tile, a ring the crop cuts
// partly or wholly away, and no ring without the image's size.
import { describe, expect, it } from "vitest";
import { coverRings, hasRings, type TileRing } from "./markers";

const LANDSCAPE = { width: 4000, height: 3000 };
const PORTRAIT = { width: 3000, height: 4000 };

/** Rounded, to compare without floating-point noise. */
const rounded = (rings: readonly TileRing[]) => rings.map(({ cx, cy, r }) => ({ cx: Number(cx.toFixed(4)), cy: Number(cy.toFixed(4)), r: Number(r.toFixed(4)) }));

describe("coverRings: a ring on a tile cropped as the image is", () => {
  it("keeps a ring where it is on a photo of the tile's own shape: nothing is cropped", () => {
    // The tile is 4/3 wide and 1 tall; the ring's radius is a share of the shorter side, the height.
    expect(rounded(coverRings([{ x: 0.25, y: 0.5, r: 0.1 }], LANDSCAPE, 4 / 3))).toEqual([{ cx: 0.3333, cy: 0.5, r: 0.1 }]);
  });

  it("moves a wide photo's ring towards the middle in a square tile: a sixth of the photo is cut from each side", () => {
    // Scaled to the tile's height, the photo is 4/3 wide: 1/6 hangs past each side.
    expect(rounded(coverRings([{ x: 0.5, y: 0.5, r: 0.1 }], LANDSCAPE, 1))).toEqual([{ cx: 0.5, cy: 0.5, r: 0.1 }]);
    expect(rounded(coverRings([{ x: 0.25, y: 0.4, r: 0.05 }], LANDSCAPE, 1))).toEqual([{ cx: 0.1667, cy: 0.4, r: 0.05 }]);
    expect(rounded(coverRings([{ x: 0.875, y: 0.9, r: 0.05 }], LANDSCAPE, 1))).toEqual([{ cx: 1, cy: 0.9, r: 0.05 }]);
  });

  it("moves a tall photo's ring towards the middle in a 3/2 tile: a quarter of the photo is cut from top and bottom", () => {
    // Scaled to the tile's width (3/2), the photo is 2 tall: half a tile hangs above and below; its shorter side, 3/2, sizes the ring.
    expect(rounded(coverRings([{ x: 0.5, y: 0.5, r: 0.1 }], PORTRAIT, 3 / 2))).toEqual([{ cx: 0.75, cy: 0.5, r: 0.15 }]);
    expect(rounded(coverRings([{ x: 0.2, y: 0.375, r: 0.1 }], PORTRAIT, 3 / 2))).toEqual([{ cx: 0.3, cy: 0.25, r: 0.15 }]);
  });

  it("keeps a ring the crop cuts partly away, the tile clipping it, and leaves out one it cuts away whole", () => {
    const [partly, ...rest] = coverRings(
      [
        { x: 0.08, y: 0.5, r: 0.1 },
        { x: 0.02, y: 0.5, r: 0.05 },
        { x: 0.98, y: 0.5, r: 0.05 },
      ],
      LANDSCAPE,
      1,
    );
    // Its centre is past the tile's left edge (-0.06), its circle reaching back in to 0.04.
    expect(rounded([partly])).toEqual([{ cx: -0.06, cy: 0.5, r: 0.1 }]);
    expect(rest).toEqual([]);
    // Above and below a tall photo's crop alike.
    expect(coverRings([{ x: 0.5, y: 0.1, r: 0.05 }], PORTRAIT, 3 / 2)).toEqual([]);
  });

  it("places none without the image's size, nor any without rings", () => {
    expect(coverRings([{ x: 0.5, y: 0.5, r: 0.1 }], null, 1)).toEqual([]);
    expect(coverRings([{ x: 0.5, y: 0.5, r: 0.1 }], undefined, 1)).toEqual([]);
    expect(coverRings([], LANDSCAPE, 1)).toEqual([]);
    expect(hasRings({ markers: [{ x: 0.5, y: 0.5, r: 0.1 }], size: null })).toBe(false);
    expect(hasRings({ markers: [{ x: 0.5, y: 0.5, r: 0.1 }], size: LANDSCAPE })).toBe(true);
    expect(hasRings({ markers: [], size: LANDSCAPE })).toBe(false);
  });
});
