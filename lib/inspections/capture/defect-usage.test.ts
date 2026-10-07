import { describe, expect, it, vi } from "vitest";
import { defectUsageFrom, loadDefectUsage, USAGE_SAMPLE } from "./defect-usage";

const INSPECTION = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const CLIENT = "20000000-0000-4000-8000-0000000000c1";
const FACTORY = "10000000-0000-4000-8000-0000000000f1";

describe("defectUsageFrom", () => {
  it("sums holes and defects per code over sizes, hands and classes", () => {
    const usage = defectUsageFrom([
      {
        watertight: { sizes: { M: { tested: 500, holes: { hole_palm: 2, hole_cuff: 0 } }, L: { R: { holes: { hole_palm: 1 } } } } },
        visual: {
          sizes: {
            M: { major: { inspected: 200, counts: { thin_spot: 3 } }, minor: { counts: { stain: 1 } } },
            S: { R: { critical: { counts: { embedded_metal: 1 } } }, L: { major: { counts: { thin_spot: 1 } } } },
          },
        },
      },
      { watertight: null, visual: { sizes: { M: { major: { counts: { thin_spot: 2, stain: 4 } } } } } },
    ]);
    expect(usage).toEqual({ hole_palm: 3, thin_spot: 6, stain: 5, embedded_metal: 1 });
  });

  it("reads whatever is stored without failing: nothing saved, text, negative counts, one-off labels", () => {
    expect(
      defectUsageFrom([
        { watertight: undefined, visual: "x" },
        { watertight: { sizes: [] }, visual: { sizes: { M: { major: { counts: { thin_spot: "2", stain: -1 }, unmapped: [{ label: "Torn", count: 3 }] } } } } },
      ]),
    ).toEqual({});
  });
});

describe("loadDefectUsage", () => {
  /** A client whose inspections query answers `results` in turn, recording each chain. */
  function client(...results: Array<{ data: unknown; error: unknown }>) {
    const chains: Array<Array<[string, unknown[]]>> = [];
    const from = vi.fn(() => {
      const calls: Array<[string, unknown[]]> = [];
      chains.push(calls);
      const answer = results[chains.length - 1] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "neq", "eq", "is", "order", "limit"]) {
        builder[method] = (...args: unknown[]) => {
          calls.push([method, args]);
          return builder;
        };
      }
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(answer).then(resolve);
      return builder;
    });
    return { client: { from } as never, chains };
  }

  const counted = { data: [{ watertight: null, visual: { sizes: { M: { major: { counts: { thin_spot: 2 } } } } } }], error: null };

  it("counts the same client's and manufacturer's earlier inspections, never this one", async () => {
    const { client: fake, chains } = client(counted);
    await expect(loadDefectUsage(fake, { id: INSPECTION, clientId: CLIENT, manufacturerId: FACTORY })).resolves.toEqual({ thin_spot: 2 });
    expect(chains).toHaveLength(1);
    expect(chains[0]).toEqual(
      expect.arrayContaining([
        ["neq", ["id", INSPECTION]],
        ["eq", ["client_id", CLIENT]],
        ["eq", ["manufacturer_id", FACTORY]],
        ["limit", [USAGE_SAMPLE]],
      ]),
    );
  });

  it("falls back to every inspection the user can see when that pair has counted nothing", async () => {
    const { client: fake, chains } = client({ data: [], error: null }, counted);
    await expect(loadDefectUsage(fake, { id: INSPECTION, clientId: null, manufacturerId: FACTORY })).resolves.toEqual({ thin_spot: 2 });
    expect(chains[0]).toContainEqual(["is", ["client_id", null]]);
    expect(chains[1].some(([method]) => method === "eq" || method === "is")).toBe(false);
  });

  it("gives no usage when the inspections cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client: fake } = client({ data: null, error: { message: "timeout" } });
    await expect(loadDefectUsage(fake, { id: INSPECTION, clientId: CLIENT, manufacturerId: FACTORY })).resolves.toEqual({});
  });
});
