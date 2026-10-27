import { describe, expect, it } from "vitest";
import type { ValidationIssue } from "@/lib/validation";
import { attentionItems, firstSentence, shortIssue } from "./attention";

const ringMark = (size: string, count: number, hand = ""): ValidationIssue => ({
  level: "warning",
  moduleKey: "visual",
  code: "defect_unmapped",
  message: `Size ${size}${hand}, Major Defects: "Ring mark" (${count}) is not in the template's defect list. It counts towards the total; an admin maps it to a defect code.`,
  size,
  path: ["sizes", size, "major", "unmapped", 0],
});

describe("Needs Your Attention", () => {
  it("keeps a sentence up to its first full stop, not a decimal point", () => {
    expect(firstSentence("Average weight 2.9 g is 17.1% below the indicative 3.5 g (threshold 10%). Check the scale.")).toBe(
      "Average weight 2.9 g is 17.1% below the indicative 3.5 g (threshold 10%)",
    );
    expect(firstSentence("Spec. ≥ 6 N.")).toBe("Spec. ≥ 6 N");
  });

  it("drops the size a sentence starts with and moves its count out", () => {
    expect(shortIssue(ringMark("M", 2))).toEqual({
      text: `Major Defects: "Ring mark" is not in the template's defect list`,
      count: 2,
    });
    expect(shortIssue(ringMark("XL", 1, ", right hand")).text).toBe(`Major Defects: "Ring mark" is not in the template's defect list`);
  });

  it("lists one line per problem with its sizes in the template's order", () => {
    const items = attentionItems([ringMark("XL", 1), ringMark("M", 2), ringMark("L", 2)], ["S", "M", "L", "XL"]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      level: "warning",
      moduleKey: "visual",
      code: "defect_unmapped",
      text: `Major Defects: "Ring mark" is not in the template's defect list`,
      sizes: [
        { size: "M", count: 2 },
        { size: "L", count: 2 },
        { size: "XL", count: 1 },
      ],
    });
  });

  it("adds a size's counts from both hands, puts errors first and leaves out not-done warnings", () => {
    const duplicate: ValidationIssue = {
      level: "error",
      moduleKey: "carton_sampling",
      code: "carton_duplicate",
      message: "Size M: Box/Carton #525 is entered twice (No. 20, No. 21).",
      size: "M",
      path: ["sizes", "M", 20],
    };
    const notDone: ValidationIssue = {
      level: "warning",
      moduleKey: "weight",
      code: "module_not_done",
      message: "Weight is not done.",
      path: [],
    };
    const items = attentionItems(
      [ringMark("M", 2, ", right hand"), notDone, ringMark("M", 1, ", left hand"), duplicate],
      ["S", "M", "L", "XL"],
    );
    expect(items.map((item) => item.code)).toEqual(["carton_duplicate", "defect_unmapped"]);
    expect(items[0].text).toBe("Box/Carton #525 is entered twice (No. 20, No. 21)");
    expect(items[1].sizes).toEqual([{ size: "M", count: 3 }]);
  });
});
