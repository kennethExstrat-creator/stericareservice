import { describe, expect, it } from "vitest";
import { checkContainerNumber, containerCheckDigit, normaliseContainerNumber } from "./container-number";

describe("ISO 6346 container numbers", () => {
  it("computes the check digit of the standard's example, CSQU 305438 3", () => {
    expect(containerCheckDigit("CSQU305438")).toBe(3);
    expect(checkContainerNumber("CSQU3054383")).toEqual({ ok: true, normalised: "CSQU3054383" });
  });

  it("reads the number as painted or typed: spaces, hyphens, lower case", () => {
    expect(normaliseContainerNumber(" csqu 305438-3 ")).toBe("CSQU3054383");
    expect(checkContainerNumber("CSQU 305438 3").ok).toBe(true);
    expect(checkContainerNumber("csqu-305438/3").ok).toBe(true);
  });

  it("skips multiples of 11 in the letter values (a check digit of 10 counts as 0)", () => {
    // L is 23 and V is 34, not 22 and 33.
    expect(containerCheckDigit("LLLU000000")).toBe((23 + 23 * 2 + 23 * 4 + 32 * 8) % 11 % 10);
    expect(containerCheckDigit("VVVU000000")).toBe((34 + 34 * 2 + 34 * 4 + 32 * 8) % 11 % 10);
    // 10 + 20 + 40 + 256 + 6 x 512 = 3398 leaves 10 after dividing by 11: check digit 0.
    expect(containerCheckDigit("AAAU000006")).toBe(0);
    expect(checkContainerNumber("AAAU0000060").ok).toBe(true);
  });

  it("names the expected check digit when one character is mistyped", () => {
    expect(checkContainerNumber("CSQU3054384")).toEqual({
      ok: false,
      reason: "check_digit",
      normalised: "CSQU3054384",
      expected: 3,
    });
    expect(checkContainerNumber("CSQU3054833")).toMatchObject({ ok: false, reason: "check_digit" });
  });

  it("refuses what is not a container number at all", () => {
    for (const text of ["CSQU305438", "CSQU30543833", "CSQX3054383", "CS1U3054383", "TRUCK 12", ""]) {
      expect(checkContainerNumber(text)).toEqual({ ok: false, reason: "format" });
    }
  });
});
