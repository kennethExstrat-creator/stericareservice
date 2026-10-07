// A radio card names its radio by the card's title and describes it by the
// card's description, directly: through the label alone Chrome finds no name
// (the label holds the radio inside Field's role="group"). e2e/users and
// e2e/defects read the names from Chrome's own accessibility tree.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RadioGroup } from "@/components/ui/radio-group";
import { RadioCard } from "./radio-card";
import { radioNames, radiosIn, textOf } from "./radio-card.testing";

function draw(value = "a") {
  return renderToStaticMarkup(
    <RadioGroup value={value}>
      <RadioCard id="c-a" value="a" title="Their Team's Codes" description="One of the active codes." />
      <RadioCard id="c-b" value="b" title="A New Code" description="Add a code for this label first." />
    </RadioGroup>,
  );
}

describe("RadioCard", () => {
  it("names each radio by its title and describes it by its description", () => {
    const html = draw();
    expect(radiosIn(html).map((radio) => radio["aria-labelledby"])).toEqual(["c-a-title", "c-b-title"]);
    expect(radiosIn(html).map((radio) => radio["aria-describedby"])).toEqual(["c-a-description", "c-b-description"]);
    expect(radioNames(html)).toEqual([
      { name: "Their Team's Codes", description: "One of the active codes." },
      { name: "A New Code", description: "Add a code for this label first." },
    ]);
  });

  it("keeps the whole card a label for its radio, so a tap anywhere on it chooses", () => {
    const html = draw("b");
    expect(html).toMatch(/<label[^>]*\sfor="c-a"/);
    expect(html).toMatch(/<label[^>]*\sfor="c-b"/);
    expect(radiosIn(html).map((radio) => [radio.id, radio["aria-checked"]])).toEqual([
      ["c-a", "false"],
      ["c-b", "true"],
    ]);
  });
});

describe("radioNames", () => {
  it("gives null for a radio named only through a label, as Chrome gave nothing there", () => {
    const html =
      '<label for="r"><div role="group"><button type="button" role="radio" id="r"></button>' +
      '<div id="r-title">Inspector</div></div></label>';
    expect(radioNames(html)).toEqual([{ name: null, description: null }]);
    expect(textOf(html, "r-title")).toBe("Inspector");
    expect(textOf(html, "missing")).toBeNull();
  });
});
