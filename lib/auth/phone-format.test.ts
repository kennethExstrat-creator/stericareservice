import { describe, expect, it } from "vitest";
import { isPhoneNumber } from "./fields";
import { caretAfter, formatPhone, phoneEdit, significantBefore } from "./phone-format";

describe("formatPhone", () => {
  it.each([
    // Mobile, with the country code and without.
    ["+60173701066", "+60 17-370 1066"],
    ["0173701066", "017-370 1066"],
    ["+60123456789", "+60 12-345 6789"],
    // 011 and 015 numbers have eight digits after the prefix.
    ["+601112345678", "+60 11-1234 5678"],
    ["01112345678", "011-1234 5678"],
    // The Klang Valley, Sabah and Sarawak, the other states.
    ["0312345678", "03-1234 5678"],
    ["+6082123456", "+60 82-12 3456"],
    ["041234567", "04-123 4567"],
    // A trunk 0 after the country code goes; spaces, brackets and hyphens as typed are redone.
    ["+60 017-370 1066", "+60 17-370 1066"],
    ["+60 (17) 370-1066", "+60 17-370 1066"],
    ["  0 17 370 1066 ", "017-370 1066"],
  ])("writes %j as %j", (typed, shown) => {
    expect(formatPhone(typed)).toBe(shown);
    expect(isPhoneNumber(shown)).toBe(true);
  });

  it("formats as it is typed, digit by digit", () => {
    const steps = [..."+60173701066"].map((_, index, all) => formatPhone(all.slice(0, index + 1).join("")));
    expect(steps).toEqual([
      "+",
      "+6",
      "+60",
      "+60 1",
      "+60 17",
      "+60 17-3",
      "+60 17-37",
      "+60 17-370",
      "+60 17-370 1",
      "+60 17-370 10",
      "+60 17-370 106",
      "+60 17-370 1066",
    ]);
    expect(["0", "01", "017", "0173"].map(formatPhone)).toEqual(["0", "01", "017", "017-3"]);
  });

  it("leaves a formatted number as it is", () => {
    for (const shown of ["+60 17-370 1066", "017-370 1066", "+60 11-1234 5678", "03-1234 5678"]) {
      expect(formatPhone(shown)).toBe(shown);
    }
  });

  it("keeps another country's number, and anything that is not a number, as typed", () => {
    expect(formatPhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(formatPhone("+86 138 0013 8000 ")).toBe("+86 138 0013 8000 ");
    expect(formatPhone("012 345 6789 ext 2")).toBe("012 345 6789 ext 2");
    expect(formatPhone("")).toBe("");
  });

  it("runs extra digits on after the last group, for the check to refuse", () => {
    expect(formatPhone("+601737010669")).toBe("+60 17-370 10669");
  });
});

describe("the caret", () => {
  it("keeps its place by the digits before it", () => {
    expect(significantBefore("+60 17-370 1066", 7)).toBe(5);
    expect(caretAfter("+60 17-370 1066", 5)).toBe(6);
    expect(caretAfter("+60 17-370 1066", 0)).toBe(0);
    expect(caretAfter("017", 9)).toBe(3);
  });
});

describe("phoneEdit", () => {
  it("formats a digit typed at the end, the caret after it", () => {
    expect(phoneEdit({ previous: "+60 17", typed: "+60 173", caret: 7, inputType: "insertText" })).toEqual({
      value: "+60 17-3",
      caret: 8,
    });
  });

  it("formats a pasted number, the caret at its end", () => {
    expect(phoneEdit({ previous: "", typed: "+60173701066", caret: 12, inputType: "insertFromPaste" })).toEqual({
      value: "+60 17-370 1066",
      caret: 15,
    });
  });

  it("keeps the caret by its digit when one is typed in the middle", () => {
    // "+60 17-37|0 1066": a 9 after the 7.
    const edit = phoneEdit({ previous: "+60 17-370 1066", typed: "+60 17-3790 1066", caret: 10, inputType: "insertText" });
    expect(edit.value).toBe("+60 17-379 01066");
    expect(edit.caret).toBe(edit.value.indexOf("9") + 1);
  });

  it("deletes the digit before a separator when Backspace takes only the separator", () => {
    // "+60 17-|370 1066", Backspace: the browser takes the hyphen; the 7 goes instead.
    expect(phoneEdit({ previous: "+60 17-370 1066", typed: "+60 17370 1066", caret: 6, inputType: "deleteContentBackward" })).toEqual({
      value: "+60 13-701 066",
      caret: 5,
    });
  });

  it("deletes the digit after a separator when Delete takes only the separator", () => {
    // "+60 17|-370 1066", Delete: the browser takes the hyphen; the 3 goes instead.
    const edit = phoneEdit({ previous: "+60 17-370 1066", typed: "+60 17370 1066", caret: 6, inputType: "deleteContentForward" });
    expect(edit.value).toBe("+60 17-701 066");
    expect(edit.caret).toBe(6);
  });

  it("leaves the browser's caret alone when nothing is reformatted", () => {
    expect(phoneEdit({ previous: "+44 20", typed: "+44 20 ", caret: 7, inputType: "insertText" })).toEqual({
      value: "+44 20 ",
      caret: null,
    });
  });
});
