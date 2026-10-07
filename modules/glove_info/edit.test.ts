// The glove information's edits, applied as Capture applies them: through
// the kit's data updater (useDataUpdater), each built from the latest data.
import { describe, expect, it } from "vitest";
import { createDataUpdater } from "@/components/qc";
import { setIndicativeWeight, setText, tidyText } from "./edit";
import { emptyGloveInfo, GLOVE_INFO_TEXT_FIELDS, GloveInfoDataSchema, TEXT_MAX_LENGTH, type GloveInfoData } from "./schema";

const FILLED: GloveInfoData = {
  surfaceTexture: "Finger-textured",
  indicativeWeight: 3.5,
  colour: "Blue",
  length: "240 mm minimum",
};

describe("glove_info edits", () => {
  it("keeps text as typed, spaces between words included, and blank as null", () => {
    expect(setText(emptyGloveInfo(), "colour", "Purple blue ")).toEqual({ ...emptyGloveInfo(), colour: "Purple blue " });
    expect(setText(FILLED, "length", "").length).toBeNull();
    expect(setText(FILLED, "colour", "Blue")).toBe(FILLED);
  });

  it("trims a field once it is left, and leaves a tidy one as it was", () => {
    expect(tidyText({ ...FILLED, surfaceTexture: "  Finger-textured " }, "surfaceTexture").surfaceTexture).toBe("Finger-textured");
    expect(tidyText({ ...FILLED, colour: "   " }, "colour").colour).toBeNull();
    expect(tidyText(FILLED, "length")).toBe(FILLED);
  });

  it("stores the indicative weight as a number, and nothing when it does not change", () => {
    expect(setIndicativeWeight(emptyGloveInfo(), 3.2).indicativeWeight).toBe(3.2);
    expect(setIndicativeWeight(FILLED, null).indicativeWeight).toBeNull();
    expect(setIndicativeWeight(FILLED, 3.5)).toBe(FILLED);
  });

  it("cuts text to the schema's limit, never through a character, so the module always loads", () => {
    for (const field of GLOVE_INFO_TEXT_FIELDS) {
      const next = setText(FILLED, field, "x".repeat(TEXT_MAX_LENGTH + 120));
      expect(next[field]).toBe("x".repeat(TEXT_MAX_LENGTH));
      expect(GloveInfoDataSchema.safeParse(next).success).toBe(true);
      // An emoji across the limit is dropped whole.
      const emoji = setText(FILLED, field, `${"x".repeat(TEXT_MAX_LENGTH - 1)}🧤`);
      expect(emoji[field]).toBe("x".repeat(TEXT_MAX_LENGTH - 1));
    }
  });

  it("keeps a value committed on leaving one field and one typed in the next, in one event", () => {
    const changes: GloveInfoData[] = [];
    const saved: GloveInfoData = { ...FILLED, colour: " Blue " };
    const updater = createDataUpdater(saved, (next) => changes.push(next));
    updater.update((current) => tidyText(current, "colour"));
    updater.update((current) => setText(current, "length", "245 mm minimum"));
    expect(changes.at(-1)).toEqual({ ...FILLED, colour: "Blue", length: "245 mm minimum" });
  });
});
