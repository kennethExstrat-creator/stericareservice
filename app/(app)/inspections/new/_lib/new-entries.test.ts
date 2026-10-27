// New Client and New Manufacturer's rules and words (new-entries.ts): the
// admin screens' field rules, what each says before and after Add, and how an
// added entry joins its picker. Placeholder names.
import { describe, expect, it } from "vitest";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import type { ManufacturerPlan } from "@/lib/inspections/reference-match";
import { NewClientSchema, NewManufacturerSchema, planWords, withOptions } from "./new-entries";

describe("the fields, by the admin screens' rules", () => {
  it("cleans the names to one line, and takes a blank optional field as none", () => {
    expect(NewClientSchema.parse({ name: "  Test   Buyer\nSdn. Bhd. " })).toEqual({ name: "Test Buyer Sdn. Bhd." });
    expect(
      NewManufacturerSchema.parse({ brand: " Brand A ", company: "Company A  Sdn. Bhd.", factory: " ", address: " Lot 1 \r\n Park ", country: "" }),
    ).toEqual({ brand: "Brand A", company: "Company A Sdn. Bhd.", factory: null, address: "Lot 1\n Park", country: null });
  });

  it("refuses what Admin > Clients and Admin > Manufacturers refuse, in their words", () => {
    expect(NewClientSchema.safeParse({ name: "" }).error?.issues[0].message).toBe("Enter the client's name.");
    const issues = NewManufacturerSchema.safeParse({ brand: "", company: "", factory: "x".repeat(121), address: "", country: "" }).error?.issues;
    expect(issues?.map((issue) => [issue.path[0], issue.message])).toEqual([
      ["brand", "Enter the brand's name."],
      ["company", "Enter the company's name."],
      ["factory", "Keep the factory name to 120 characters or fewer."],
    ]);
  });
});

describe("what New Manufacturer says", () => {
  const label = (factoryId: string) => (factoryId === "f1" ? "Brand A · F-1" : "?");
  const company = { id: "c1", name: "Company A Sdn. Bhd." };
  const brand = { id: "b1", name: "Brand A" };
  const words = (plan: ManufacturerPlan, verb?: "Adds" | "Added") => planWords(plan, label, verb);

  it("before Add, says what it adds, and only what the list lacks", () => {
    expect(words({ kind: "add", brand, company, factory: "F-40" }).text).toBe("Adds the factory F-40 to Company A Sdn. Bhd. (Brand A).");
    expect(words({ kind: "add", brand, company, factory: null }).text).toBe("Adds a factory to Company A Sdn. Bhd. (Brand A).");
    expect(words({ kind: "add", brand, company: { id: null, name: "Company Z Sdn. Bhd." }, factory: "F-9" }).text).toBe(
      "Adds the company Company Z Sdn. Bhd. to the brand Brand A, with the factory F-9.",
    );
    expect(words({ kind: "add", brand: { id: null, name: "Brand Z" }, company: { id: null, name: "Company Z Sdn. Bhd." }, factory: null })).toEqual({
      text: "Adds the brand Brand Z, its company Company Z Sdn. Bhd. and its factory.",
      warn: false,
    });
  });

  it("after Add, says what it added", () => {
    expect(words({ kind: "add", brand, company, factory: "F-40" }, "Added").text).toBe("Added the factory F-40 to Company A Sdn. Bhd. (Brand A).");
  });

  it("names a listed factory, and says under which field what stops Add", () => {
    expect(words({ kind: "listed", factoryId: "f1" })).toEqual({ text: "Already in the list as Brand A · F-1: Add Manufacturer chooses it.", warn: false });
    expect(words({ kind: "choose", name: "Company A Sdn. Bhd.", factories: 3 })).toEqual({
      text: "Company A Sdn. Bhd. has 3 factories in the list. Choose one under Manufacturer, or enter the factory to add it.",
      warn: true,
      field: "factory",
    });
    expect(words({ kind: "unclear", field: "company" })).toMatchObject({ warn: true, field: "company" });
    expect(words({ kind: "unclear", field: "brand" })).toMatchObject({ warn: true, field: "brand" });
  });

  it("writes its labels in Title Case (docs/DESIGN.md, Capitalisation)", () => {
    for (const title of ["New Client", "New Manufacturer", "Add Client", "Add Manufacturer", "Factory (Optional)"]) expect(lowerCaseWords(title), title).toEqual([]);
  });
});

describe("an added entry in its picker", () => {
  const options = [
    { id: "a", label: "Alpha" },
    { id: "c", label: "Charlie" },
  ];

  it("goes in its place by label, once", () => {
    expect(withOptions(options, [{ id: "b", label: "bravo" }, { id: "b", label: "bravo" }])).toEqual([
      { id: "a", label: "Alpha" },
      { id: "b", label: "bravo" },
      { id: "c", label: "Charlie" },
    ]);
    expect(withOptions(options, [{ id: "z", label: "Zulu" }]).at(-1)).toEqual({ id: "z", label: "Zulu" });
  });

  it("leaves the options as they were when the picker has it already, so the picker is not mounted again", () => {
    expect(withOptions(options, [{ id: "a", label: "Alpha" }])).toBe(options);
    expect(withOptions(options, [])).toBe(options);
  });
});
