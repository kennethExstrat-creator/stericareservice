import { describe, expect, it } from "vitest";
import { SAFEDON_EG_EXAMPLE } from "@/tests/fixtures/examples";
import {
  codeLettersOf,
  fillPlaceholders,
  formatRatePct,
  formatSizeRate,
  joinWithAmpersand,
  plainLabel,
  ratePercent,
} from "./text";

describe("dispensing_safedon wording", () => {
  it("prints the size total line as the report does, with thousands separators", () => {
    expect(formatSizeRate(3, 625)).toBe("3 / 625 (0.48%)");
    expect(formatSizeRate(0, 1000)).toBe("0 / 1,000 (0%)");
    expect(formatSizeRate(11, 1000)).toBe("11 / 1,000 (1.1%)");
    expect(formatSizeRate(7, 625)).toBe("7 / 625 (1.12%)");
    expect(formatSizeRate(0, 0)).toBe("0 / 0");
    // The report's own wording of the XS line, spacing aside.
    expect(formatSizeRate(3, 625).replace("%", " %")).toBe(SAFEDON_EG_EXAMPLE.dispensingSafedon.perSize.XS!.printedSizeTotal);
  });

  it("computes the rate in % without binary noise, and shows at most two decimals", () => {
    expect(ratePercent(1, 125)).toBe(0.8);
    expect(ratePercent(3, 625)).toBe(0.48);
    expect(ratePercent(11, 1000)).toBe(1.1);
    expect(ratePercent(1, 0)).toBeNull();
    expect(formatRatePct(5.00333)).toBe("5");
    expect(formatRatePct(0.4799999)).toBe("0.48");
  });

  it("reads labels and lists code letters as the headings do", () => {
    expect(plainLabel("Box #")).toBe("Box");
    expect(joinWithAmpersand(codeLettersOf(["D", "C", "D", "C"]))).toBe("C & D");
    expect(fillPlaceholders("Glove Dispensing Inspection (Sampling code letter {codeLetters})", { codeLetters: "C & D" })).toBe(
      SAFEDON_EG_EXAMPLE.dispensingSafedon.printedTitle,
    );
  });
});
