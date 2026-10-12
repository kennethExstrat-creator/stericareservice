// The step names the capture screen's menus show (Kenneth, 12 October 2026:
// "this menu is crowded, simplify the section name"; docs/DESIGN.md, Step
// Names): one sidebar line each, in Title Case.
import { describe, expect, it } from "vitest";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import { MODULE_KEYS } from "@/lib/schemas/module-result";
import {
  CUSTOM_SHORT_TITLES,
  customShortTitle,
  MODULE_SHORT_TITLES,
  SHORT_TITLE_MAX,
  shortTitleFor,
  withoutNote,
  WORDING_SHORT_TITLES,
} from "./short-titles";

const words = (name: string) => name.split(/\s+/).filter(Boolean);

describe("the short names", () => {
  const names = [
    ...MODULE_KEYS.map((key) => MODULE_SHORT_TITLES[key]),
    ...Object.values(WORDING_SHORT_TITLES).flatMap((byWording) => Object.values(byWording ?? {})),
    ...Object.values(CUSTOM_SHORT_TITLES),
  ];

  it("gives every module one", () => {
    for (const key of MODULE_KEYS) expect(MODULE_SHORT_TITLES[key], key).toBeTruthy();
  });

  it.each(names)("keeps %s to one to three words in Title Case, on one sidebar line", (name) => {
    expect(words(name).length).toBeGreaterThanOrEqual(1);
    expect(words(name).length).toBeLessThanOrEqual(3);
    expect(name.length).toBeLessThanOrEqual(SHORT_TITLE_MAX);
    expect(name).toBe(name.trim());
    expect(lowerCaseWords(name)).toEqual([]);
  });
});

describe("shortTitleFor", () => {
  it("names weight Weight whatever its title, the count filled in or not", () => {
    for (const title of [
      "Weight (g) - Average of 13 Gloves per Size",
      "Weight (g) - Average of 12 Gloves per Size",
      "Weight (g) - Average of 8 or 13 Gloves per Size",
      "Weight (g)",
    ]) {
      expect(shortTitleFor("weight", title), title).toBe("Weight");
    }
  });

  it("keeps a template's own words, case and spacing aside (STD_SG)", () => {
    expect(shortTitleFor("header", "Purchase Order / Shipment Information")).toBe("Shipment");
    expect(shortTitleFor("header", "PURCHASE ORDER /  SHIPMENT INFORMATION")).toBe("Shipment");
    expect(shortTitleFor("order_lots", "PO Info")).toBe("PO Info");
    expect(shortTitleFor("packing_config", "Packing Mode")).toBe("Packing Mode");
  });

  it("gives a module its own short name whatever heading an admin types", () => {
    expect(shortTitleFor("header", "Manufacturer Information")).toBe("Manufacturer");
    expect(shortTitleFor("header", "Factory Details")).toBe("Manufacturer");
    expect(shortTitleFor("carton_sampling", "Finished Goods Sampling Information (Carton Number)")).toBe("Carton Numbers");
    expect(shortTitleFor("force_at_break", "Force at Break in Newton (Refer to Attached Where Applicable)")).toBe(
      "Force at Break",
    );
    expect(shortTitleFor("tensile", "Physical Properties Average (Refer to Attached Lab. Reports)")).toBe("Physical Properties");
    expect(shortTitleFor("watertight", "Freedom From Holes by Watertight Test")).toBe("Watertight Test");
    expect(shortTitleFor("watertight", "Watertight Inspection")).toBe("Watertight Test");
    expect(shortTitleFor("dispensing_packing", "Glove Packing Check")).toBe("Packing Check");
    expect(shortTitleFor("labeling", "Packaging Labeling Inspection")).toBe("Labeling");
  });
});

describe("customShortTitle", () => {
  it("takes the name listed for a seed custom module", () => {
    expect(customShortTitle({ key: "safedon_dispensing_notes", title: "Glove Dispensing Inspection: Onsite Notes" })).toBe(
      "Dispensing Notes",
    );
  });

  it("else its own title, without a trailing note in brackets", () => {
    expect(customShortTitle({ key: "site_notes", title: "Site Notes (Optional)" })).toBe("Site Notes");
    expect(customShortTitle({ key: "glove_type", title: "Glove Type" })).toBe("Glove Type");
  });

  it("never takes a name from the object's prototype", () => {
    expect(customShortTitle({ key: "constructor", title: "Container Seal" })).toBe("Container Seal");
    expect(customShortTitle({ key: "toString", title: "Pallet Notes" })).toBe("Pallet Notes");
  });
});

describe("withoutNote", () => {
  it("drops a trailing note in brackets, and keeps a unit, a short title and a title that is only brackets", () => {
    expect(withoutNote("Physical Properties average (Refer to attached lab. reports)")).toBe("Physical Properties average");
    expect(withoutNote("Finished Goods Sampling Information (carton number)")).toBe("Finished Goods Sampling Information");
    expect(withoutNote("Weight (g) - average of 13 gloves per size")).toBe("Weight (g) - average of 13 gloves per size");
    expect(withoutNote("Weight (g)")).toBe("Weight (g)");
    expect(withoutNote("(Optional)")).toBe("(Optional)");
    expect(withoutNote("  Site Notes  ")).toBe("Site Notes");
  });
});
