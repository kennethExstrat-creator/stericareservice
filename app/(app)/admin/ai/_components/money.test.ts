// Steri-AI Cost's amounts: ringgit or dollars, totals to the sen or cent,
// per-unit averages and prices to the figures that matter.
import { describe, expect, it } from "vitest";
import { countOf, formatAxisValue, formatCost, formatMyrRate, inCurrency, USD, type Money } from "./money";

/** Bank Negara Malaysia's noon rate on 13 October 2026. */
const MYR: Money = { currency: "myr", myrPerUsd: 4.086 };

describe("totals", () => {
  it("are dollars to the cent, grouped as en-US", () => {
    expect(formatCost(1234.56, USD)).toBe("$1,234.56");
    expect(formatCost(12.3, USD)).toBe("$12.30");
    expect(formatCost(0.84, USD)).toBe("$0.84");
    expect(formatCost(0, USD)).toBe("$0.00");
  });

  it("show an amount under a cent as under a cent, never as nothing", () => {
    expect(formatCost(0.0042, USD)).toBe("< $0.01");
    expect(formatCost(0.01, USD)).toBe("$0.01");
  });

  it("are ringgit at the rate in use: RM, a space, the amount", () => {
    expect(inCurrency(10, MYR)).toBeCloseTo(40.86);
    expect(formatCost(1234.56, MYR)).toBe("RM 5,044.41");
    expect(formatCost(0.022, MYR)).toBe("RM 0.09");
    expect(formatCost(0.001, MYR)).toBe("< RM 0.01");
    expect(formatCost(0, MYR)).toBe("RM 0.00");
  });

  it("are dollars when dollars are chosen, and without a rate", () => {
    expect(formatCost(1, { currency: "usd", myrPerUsd: 4.086 })).toBe("$1.00");
    expect(formatCost(1, { currency: "myr", myrPerUsd: null })).toBe("$1.00");
  });
});

describe("units", () => {
  it("have 2 decimals from 1, up to 3 from 0.01 and up to 4 from 0.0001", () => {
    expect(formatCost(4, USD, "unit")).toBe("$4.00");
    expect(formatCost(1.234, USD, "unit")).toBe("$1.23");
    expect(formatCost(0.2, USD, "unit")).toBe("$0.20");
    expect(formatCost(0.125, USD, "unit")).toBe("$0.125");
    expect(formatCost(0.1274, USD, "unit")).toBe("$0.127");
    expect(formatCost(0.01, USD, "unit")).toBe("$0.01");
    expect(formatCost(0.0048, USD, "unit")).toBe("$0.0048");
    expect(formatCost(0.00004, USD, "unit")).toBe("< $0.0001");
  });

  it("convert first, then choose the decimals", () => {
    // 0.003 USD is 0.012258 MYR: up to 3 decimals, as from 0.01.
    expect(formatCost(0.003, MYR, "unit")).toBe("RM 0.012");
    expect(formatCost(0.125, MYR, "unit")).toBe("RM 0.511");
    expect(formatCost(0.00002, MYR, "unit")).toBe("< RM 0.0001");
  });
});

describe("the rest", () => {
  it("writes axis labels with the decimals asked for", () => {
    expect(formatAxisValue(0.5, USD, 2)).toBe("$0.50");
    expect(formatAxisValue(0.0125, USD, 4)).toBe("$0.0125");
    expect(formatAxisValue(10, MYR, 0)).toBe("RM 10");
  });

  it("writes the rate and counts", () => {
    expect(formatMyrRate(4.086)).toBe("RM 4.086");
    expect(formatMyrRate(4.0823)).toBe("RM 4.0823");
    expect(formatMyrRate(4.1)).toBe("RM 4.10");
    expect(countOf(1, "call", "calls")).toBe("1 call");
    expect(countOf(1284, "photo or video", "photos and videos")).toBe("1,284 photos and videos");
    expect(countOf(0, "review", "reviews")).toBe("0 reviews");
  });
});
