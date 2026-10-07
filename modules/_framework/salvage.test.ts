import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CountCellSchema, DecimalCellSchema, TextCellSchema } from "@/lib/validation/cells";
import { perSizeData } from "./data";
import { salvageData } from "./salvage";

// Shaped like order_lots: a line per size with a quantity, lot numbers of at most 200 characters and a site.
const OrderSchema = perSizeData(
  z.strictObject({
    qtyCases: CountCellSchema,
    lotNumbers: z.array(z.string().max(200)).default([]),
    packingSite: TextCellSchema,
  }),
);

const LONG_LOT = "L".repeat(250);

describe("salvageData: reading what can be read of data its schema rejects", () => {
  it("parses data that is valid as it is, dropping nothing", () => {
    const saved = { sizes: { M: { qtyCases: 2900, lotNumbers: ["LOT-M-0001"] } } };
    expect(salvageData(OrderSchema, saved)).toEqual({
      data: { sizes: { M: { qtyCases: 2900, lotNumbers: ["LOT-M-0001"], packingSite: null } } },
      dropped: [],
    });
  });

  it("drops an over-long lot number and keeps the size, its quantity and its other lots", () => {
    const saved = {
      sizes: {
        M: { qtyCases: 2900, lotNumbers: ["LOT-M-0001", LONG_LOT, "LOT-M-0003"] },
        L: { qtyCases: 60, lotNumbers: ["LOT-L-0001"] },
      },
    };
    expect(OrderSchema.safeParse(saved).success).toBe(false);
    expect(salvageData(OrderSchema, saved)).toEqual({
      data: {
        sizes: {
          M: { qtyCases: 2900, lotNumbers: ["LOT-M-0001", "LOT-M-0003"], packingSite: null },
          L: { qtyCases: 60, lotNumbers: ["LOT-L-0001"], packingSite: null },
        },
      },
      dropped: [["sizes", "M", "lotNumbers", 1]],
    });
  });

  it("never changes the saved value it is given", () => {
    const saved = { sizes: { M: { qtyCases: 2900, lotNumbers: [LONG_LOT] } } };
    const copy = structuredClone(saved);
    salvageData(OrderSchema, saved);
    expect(saved).toEqual(copy);
  });

  it("blanks a rejected reading where the list takes blanks, so the others keep their places", () => {
    const Readings = perSizeData(z.strictObject({ values: z.array(DecimalCellSchema).default([]) }));
    expect(salvageData(Readings, { sizes: { M: { values: [243, "2 42", 245] } } })).toEqual({
      data: { sizes: { M: { values: [243, null, 245] } } },
      dropped: [["sizes", "M", "values", 1]],
    });
  });

  it("removes a rejected field, so its default applies, and fields the schema does not have", () => {
    const saved = { sizes: { M: { qtyCases: "2,900", lotNumbers: ["LOT-M-0001"], colour: "blue" } } };
    expect(salvageData(OrderSchema, saved)).toEqual({
      data: { sizes: { M: { qtyCases: null, lotNumbers: ["LOT-M-0001"], packingSite: null } } },
      dropped: expect.arrayContaining([
        ["sizes", "M", "qtyCases"],
        ["sizes", "M", "colour"],
      ]),
    });
  });

  it("takes out the parent of a value the schema cannot do without", () => {
    const Required = z.strictObject({
      sizes: z.record(z.string(), z.strictObject({ code: z.string(), note: TextCellSchema })).default({}),
    });
    expect(salvageData(Required, { sizes: { M: { note: "kept apart" }, L: { code: "A", note: null } } })).toEqual({
      data: { sizes: { L: { code: "A", note: null } } },
      dropped: [["sizes", "M"]],
    });
  });

  it("drops a size saved under a key the schema refuses", () => {
    const saved = { sizes: { M: { qtyCases: 5 }, "": { qtyCases: 7 } } };
    expect(salvageData(OrderSchema, saved)).toEqual({
      data: { sizes: { M: { qtyCases: 5, lotNumbers: [], packingSite: null } } },
      dropped: [["sizes", ""]],
    });
  });

  it("repairs several values in one list without shifting one onto another", () => {
    const saved = { sizes: { M: { qtyCases: 1, lotNumbers: [LONG_LOT, "LOT-1", LONG_LOT, "LOT-2", 7] } } };
    expect(salvageData(OrderSchema, saved)?.data.sizes.M?.lotNumbers).toEqual(["LOT-1", "LOT-2"]);
  });

  it("gives up when the value as a whole is wrong", () => {
    expect(salvageData(OrderSchema, "garbage")).toBeNull();
    expect(salvageData(OrderSchema, [1, 2])).toBeNull();
    expect(salvageData(z.number(), "x")).toBeNull();
  });
});
