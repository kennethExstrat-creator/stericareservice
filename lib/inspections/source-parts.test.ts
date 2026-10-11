import { describe, expect, it } from "vitest";
import {
  describeOutcomes,
  mergeProposals,
  partFacts,
  poKey,
  readingHeadline,
  readingSummary,
  routeReading,
  splitReading,
  SUMMARY_MAX,
  type RoutingPart,
} from "./source-parts";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";

describe("partFacts", () => {
  it("reads the PO, the lots once each and the sizes ordered or given a lot", () => {
    const data = {
      modules: {
        header: { poNo: " PO-0001 (SO-0001) ", productName: null },
        order_lots: {
          sizes: {
            S: { qtyCases: 120, lotNumbers: ["LOT-A01", " "], packingSite: null },
            M: { qtyCases: null, lotNumbers: ["LOT-A02", "LOT-A01"], packingSite: null },
            L: { qtyCases: 0, lotNumbers: [], packingSite: null },
          },
        },
      },
      custom: {},
    };
    expect(partFacts(data)).toEqual({ poNo: "PO-0001 (SO-0001)", lots: ["LOT-A01", "LOT-A02"], sizes: ["S", "M"] });
    expect(partFacts({ modules: {}, custom: {} })).toEqual({ poNo: null, lots: [], sizes: [] });
  });
});

describe("poKey", () => {
  it("compares POs by the number before the SO, without a leading PO", () => {
    expect(poKey("PO-0001 (SO-0001)")).toBe("0001");
    expect(poKey("po 0001")).toBe("0001");
    expect(poKey("0001")).toBe("0001");
    expect(poKey("POL-7")).toBe("POL7");
    expect(poKey("(SO-0001)")).toBeNull();
    expect(poKey("  ")).toBeNull();
    expect(poKey(null)).toBeNull();
  });
});

describe("mergeProposals", () => {
  it("adds what the second form holds where the first holds nothing", () => {
    expect(
      mergeProposals(
        { header: { poNo: "PO-0001", productName: null }, order_lots: { sizes: { S: { qtyCases: 10 } } } },
        { header: { poNo: "PO-0009", productName: "Gloves" }, order_lots: { sizes: { M: { qtyCases: 20 } } }, weight: { unit: "g" } },
      ),
    ).toEqual({
      header: { poNo: "PO-0001", productName: "Gloves" },
      order_lots: { sizes: { S: { qtyCases: 10 }, M: { qtyCases: 20 } } },
      weight: { unit: "g" },
    });
  });
});

describe("routeReading", () => {
  const parts: RoutingPart[] = [
    { id: A, poNo: "PO-0001", editable: true },
    { id: B, poNo: "PO-0002 (SO-0002)", editable: true },
  ];

  it("keeps the parts that exist and leaves out empty answers", () => {
    const route = routeReading(
      { parts: { [A]: { header: { productName: "Gloves" } }, [B]: { header: {} }, [C]: { header: { productName: "X" } } }, newParts: [] },
      parts,
      A,
    );
    expect(route.byPart).toEqual({ [A]: { header: { productName: "Gloves" } } });
    expect(route.create).toEqual([]);
  });

  it("takes a part named by its label or PO for that part", () => {
    const route = routeReading({ parts: { "PO 0002": { header: { productName: "Gloves" } }, "PO 7": { header: {} } }, newParts: [] }, parts, A);
    expect(route.byPart).toEqual({ [B]: { header: { productName: "Gloves" } } });
  });

  it("gives a new PO a part already has to that part, and adds each other PO once", () => {
    const route = routeReading(
      {
        parts: { [B]: { order_lots: { sizes: { S: { qtyCases: 5 } } } } },
        newParts: [
          { poNo: "PO 0002", proposals: { order_lots: { sizes: { M: { qtyCases: 7 } } } } },
          { poNo: "PO-0003 (SO-0003)", proposals: { order_lots: { sizes: { S: { qtyCases: 1 } } } } },
          { poNo: "0003", proposals: { order_lots: { sizes: { M: { qtyCases: 2 } } } } },
        ],
      },
      parts,
      A,
    );
    expect(route.byPart[B]).toEqual({ order_lots: { sizes: { S: { qtyCases: 5 }, M: { qtyCases: 7 } } } });
    expect(route.create).toEqual([
      { poNo: "PO-0003 (SO-0003)", proposals: { order_lots: { sizes: { S: { qtyCases: 1 }, M: { qtyCases: 2 } } } } },
    ]);
    expect(route.dropped).toBe(0);
  });

  it("lets a part without a PO take the first PO no part has, with that PO in its header", () => {
    const open: RoutingPart[] = [
      { id: A, poNo: null, editable: true },
      { id: B, poNo: "PO-0002", editable: true },
    ];
    const route = routeReading(
      {
        parts: {},
        newParts: [
          { poNo: "PO-0005", proposals: { header: { productName: "Gloves" } } },
          { poNo: "PO-0006", proposals: { header: { productName: "Gloves" } } },
        ],
      },
      open,
      B,
    );
    expect(route.byPart[A]).toEqual({ header: { productName: "Gloves", poNo: "PO-0005" } });
    expect(route.create.map((entry) => entry.poNo)).toEqual(["PO-0006"]);
  });

  it("never adds the PO a part without one was just given", () => {
    const route = routeReading(
      {
        parts: { [A]: { header: { poNo: "PO-0005" } } },
        newParts: [{ poNo: "PO 0005", proposals: { header: { productName: "Gloves" } } }],
      },
      [{ id: A, poNo: null, editable: true }],
      A,
    );
    expect(route.byPart[A]).toEqual({ header: { poNo: "PO-0005", productName: "Gloves" } });
    expect(route.create).toEqual([]);
  });

  it("never gives a new PO to a part that can no longer change, or to one the AI filled already", () => {
    const locked: RoutingPart[] = [
      { id: A, poNo: null, editable: false },
      { id: B, poNo: null, editable: true },
    ];
    const route = routeReading(
      { parts: { [B]: { header: { productName: "Gloves" } } }, newParts: [{ poNo: "PO-0005", proposals: { header: { productName: "Other" } } }] },
      locked,
      B,
    );
    expect(route.byPart[A]).toBeUndefined();
    expect(route.byPart[B]).toEqual({ header: { productName: "Gloves" } });
    expect(route.create.map((entry) => entry.poNo)).toEqual(["PO-0005"]);
  });

  it("gives the one-inspection answer to the reading part, and adds no more than the limit", () => {
    const route = routeReading(
      {
        parts: {},
        modules: { header: { productName: "Gloves" } },
        newParts: ["PO-0007", "PO-0008", "PO-0009"].map((poNo) => ({ poNo, proposals: { header: { productName: poNo } } })),
      },
      parts,
      B,
      2,
    );
    expect(route.byPart).toEqual({ [B]: { header: { productName: "Gloves" } } });
    expect(route.create.map((entry) => entry.poNo)).toEqual(["PO-0007", "PO-0008"]);
    expect(route.dropped).toBe(1);
  });
});

describe("describeOutcomes", () => {
  it("says what happened to each part, in order", () => {
    expect(
      describeOutcomes(
        [
          { kind: "filled", label: "PO 0001", filled: 12 },
          { kind: "filled", label: "PO 0002", filled: 0 },
          { kind: "skipped", label: "PO 0003", reason: "it is submitted" },
          { kind: "added", label: "PO 0004", filled: 1 },
          { kind: "added", label: "PO 0005", filled: 0, problem: "it could not be saved" },
          { kind: "not_added", label: "PO 0006", message: "The PO could not be added. Try again." },
        ],
        2,
      ),
    ).toBe(
      "Filled 12 fields in PO 0001. Nothing new for PO 0002. Skipped PO 0003: it is submitted. Added PO 0004 with 1 field. " +
        "Added PO 0005, but nothing was filled in: it could not be saved. PO 0006 was not added: The PO could not be added. Try again. " +
        "2 more POs were left out: add them by hand.",
    );
    expect(describeOutcomes([])).toBe("");
  });
});

describe("readingSummary", () => {
  it("keeps four lines: the headline, what the file is, the parts, then the shortforms", () => {
    const kept = readingSummary("Two inspection forms.", "Filled 3 fields in PO 0001.", ["SKV → Skin Void", "BF → Between Fingers"], "2 POs · 3 fields filled");
    expect(kept).toBe("2 POs · 3 fields filled\nTwo inspection forms.\nFilled 3 fields in PO 0001.\nRead as: SKV → Skin Void; BF → Between Fingers.");
    expect(splitReading(kept)).toEqual({
      headline: "2 POs · 3 fields filled",
      note: "Two inspection forms.",
      report: "Filled 3 fields in PO 0001.",
      readAs: ["SKV → Skin Void", "BF → Between Fingers"],
    });
    expect(readingSummary("", "", [])).toBe("\nRead.\n\n");
    // An older one-line reading: all of it is the note.
    expect(splitReading("A PO. Read as: SKV → Skin Void.")).toEqual({ headline: "", note: "A PO. Read as: SKV → Skin Void.", report: "", readAs: [] });
  });

  it("heads the reading with the POs and fields it filled", () => {
    expect(
      readingHeadline([
        { kind: "filled", label: "PO 1", filled: 70 },
        { kind: "added", label: "PO 2", filled: 79 },
        { kind: "skipped", label: "PO 3", reason: "it is submitted" },
      ]),
    ).toBe("2 POs · 149 fields filled");
    expect(readingHeadline([{ kind: "filled", label: "PO 1", filled: 0 }])).toBe("Nothing new to fill");
  });

  it("stays within the column, cutting the end, never half a character", () => {
    const long = readingSummary("A".repeat(600), "B".repeat(600), []);
    expect(long).toHaveLength(SUMMARY_MAX);
    expect(long.endsWith("…")).toBe(true);
    const emoji = readingSummary(`${"A".repeat(SUMMARY_MAX - 2)}😀😀`, "", []);
    expect(emoji.length).toBeLessThanOrEqual(SUMMARY_MAX);
    expect(/[\uD800-\uDBFF]…$/.test(emoji)).toBe(false);
  });
});
