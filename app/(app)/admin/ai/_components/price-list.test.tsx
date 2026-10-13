// The Price List card: Edit Prices' form as it draws, and the rules behind it
// (price-form.ts): editing a price, adding and removing a model, the default
// prices again, and what a refused list says. e2e opens it in the browser.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_PRICES } from "@/lib/schemas/ai-prices";
import {
  addModel,
  parseDraft,
  removeModel,
  setModelId,
  setRate,
  toDraft,
  withDefaultPrices,
  type PriceDraft,
  type RateKey,
} from "./price-form";

vi.mock("../actions", () => ({ saveAiPricesAction: vi.fn() }));

import { PriceForm, PriceList } from "./price-list";

const DEFAULTS = toDraft(DEFAULT_AI_PRICES);

function priced(draft: PriceDraft, key: string, prices: Partial<Record<RateKey, string>>): PriceDraft {
  return Object.entries(prices).reduce((next, [rate, value]) => setRate(next, key, rate as RateKey, value), draft);
}

const ALL_RATES = { input: "15", output: "75", cacheWrite5m: "18.75", cacheWrite1h: "30", cacheRead: "1.5" };

function draw(draft: PriceDraft, errors: Record<string, string> = {}): string {
  return renderToStaticMarkup(
    <PriceForm draft={draft} errors={errors} saving={false} onChange={() => {}} onCancel={() => {}} onSubmit={() => {}} />,
  );
}

describe("editing", () => {
  it("starts from the list as it stands and gives it back unchanged", () => {
    expect(parseDraft(DEFAULTS)).toEqual({ ok: true, list: DEFAULT_AI_PRICES });
  });

  it("changes a price, a long-prompt price and the admin's own rate", () => {
    let draft = setRate(DEFAULTS, "claude-opus-5-5", "input", "4.5");
    draft = setRate(draft, "claude-haiku-5-5", "output", "3", true);
    draft = { ...draft, myrPerUsd: "4,15", myrRateOn: "2026-10-01", checkedOn: "2026-10-13" };
    const result = parseDraft(draft);
    if (!result.ok) throw new Error(result.message);
    expect(result.list.models[0].input).toBe(4.5);
    expect(result.list.models[2].longPrompt?.output).toBe(3);
    // A decimal comma, as an iPad keyboard may type it.
    expect(result.list.myrPerUsd).toBe(4.15);
    expect(result.list).toMatchObject({ myrRateOn: "2026-10-01", checkedOn: "2026-10-13" });
  });

  it("drops the rate's date with the rate: Bank Negara Malaysia's rate again", () => {
    const result = parseDraft({ ...DEFAULTS, myrPerUsd: " ", myrRateOn: "2026-10-01" });
    expect(result.ok && result.list).toMatchObject({ myrPerUsd: null, myrRateOn: null });
  });
});

describe("models", () => {
  it("adds a model the app does not offer, with its own Remove", () => {
    let draft = addModel(DEFAULTS, "added-1");
    draft = setModelId(draft, "added-1", " claude-opus-4-8 ");
    draft = priced(draft, "added-1", ALL_RATES);
    const result = parseDraft(draft);
    if (!result.ok) throw new Error(result.message);
    expect(result.list.models.map((entry) => entry.model)).toEqual([
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
      "claude-opus-4-8",
    ]);
    expect(result.list.models[3]).toMatchObject({ input: 15, output: 75, cacheRead: 1.5, longPrompt: null });

    const html = draw(draft);
    expect(html.match(/>Remove<\/button>/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Remove claude-opus-4-8"');
    expect(removeModel(draft, "added-1").models).toHaveLength(3);
  });

  it("never removes or renames the app's own models", () => {
    expect(removeModel(DEFAULTS, "claude-opus-5-5").models).toHaveLength(3);
    expect(setModelId(DEFAULTS, "claude-opus-5-5", "claude-x").models[0].model).toBe("claude-opus-5-5");
    expect(draw(DEFAULTS)).not.toContain(">Remove</button>");
  });

  it("refills the 12 October prices, keeping the admin's own rate", () => {
    let draft = addModel(setRate(DEFAULTS, "claude-opus-5-5", "input", "9"), "added-1");
    draft = { ...draft, checkedOn: "2026-11-02", myrPerUsd: "4.7", myrRateOn: "2026-11-01" };
    const again = withDefaultPrices(draft);
    expect(again.models).toEqual(DEFAULTS.models);
    expect(again).toMatchObject({ checkedOn: "2026-10-12", myrPerUsd: "4.7", myrRateOn: "2026-11-01" });
  });
});

describe("a refused list", () => {
  it("highlights a missing or impossible price in its own words", () => {
    const result = parseDraft(priced(DEFAULTS, "claude-opus-5-5", { input: "", output: "-1", cacheRead: "2000" }));
    expect(result).toEqual({
      ok: false,
      message: "Check the highlighted prices.",
      errors: {
        "models.0.input": "Enter a price in USD.",
        "models.0.output": "A price cannot be below 0.",
        "models.0.cacheRead": "Check this price: over 1,000 USD per million tokens.",
      },
    });
  });

  it("names a model listed twice", () => {
    let draft = setModelId(addModel(DEFAULTS, "added-1"), "added-1", "claude-opus-5-5");
    draft = priced(draft, "added-1", ALL_RATES);
    const result = parseDraft(draft);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe('"claude-opus-5-5" is in the list twice.');
    expect(result.errors["models.3.model"]).toBe('"claude-opus-5-5" is in the list twice.');
  });

  it("asks for a model id, the rate's date, and a rate it can read", () => {
    const result = parseDraft({ ...priced(addModel(DEFAULTS, "added-1"), "added-1", ALL_RATES), myrPerUsd: "4.15", myrRateOn: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors["models.3.model"]).toBe("Enter a Claude model id, for example claude-opus-5-5.");
    const rate = parseDraft({ ...DEFAULTS, myrPerUsd: "4.15", myrRateOn: "" });
    expect(!rate.ok && rate.errors).toEqual({ myrRateOn: "Enter the date of your rate." });
    const unreadable = parseDraft({ ...DEFAULTS, myrPerUsd: "abc", myrRateOn: "2026-10-01", checkedOn: "" });
    expect(!unreadable.ok && unreadable.errors).toEqual({
      checkedOn: "Enter a date.",
      myrPerUsd: "Enter a rate from 1 to 20, such as 4.09, or leave it blank.",
    });
  });

  it("refuses a rate no real rate is, a typo the schema would keep", () => {
    for (const typed of ["40.86", "0.2447", "100"]) {
      const result = parseDraft({ ...DEFAULTS, myrPerUsd: typed, myrRateOn: "2026-10-13" });
      expect(result).toEqual({
        ok: false,
        message: "Check the highlighted prices.",
        errors: { myrPerUsd: "Enter a rate from 1 to 20, such as 4.09, or leave it blank." },
      });
    }
    expect(parseDraft({ ...DEFAULTS, myrPerUsd: "20", myrRateOn: "2026-10-13" }).ok).toBe(true);
  });
});

describe("the card", () => {
  it("draws a decimal field for every price, the long prompts' included, the admin's own rate and the list's dates", () => {
    const html = draw(DEFAULTS);
    // 3 models x 5 prices, Claude Haiku 5.5's long prompts x 5, and the admin's own rate.
    expect(html.match(/inputMode="decimal"/gi)).toHaveLength(21);
    expect(html).toContain("Prompts Over 100K Tokens");
    for (const label of ["Checked On", "Use My Own Rate (RM per US$1)", "Rate Date", "Add Model", "Use Default Prices", "Cancel", "Save Prices"]) {
      expect(html).toContain(label);
    }
    expect(html).toMatch(/aria-describedby="([^"]+-myr-hint)"[^>]*>(?:(?!<\/div>).)*<p id="\1"[^>]*>Leave blank to use Bank Negara Malaysia&#x27;s daily rate\.<\/p>/);
    expect(html.match(/type="date"/g)).toHaveLength(2);
    expect(html).toContain('value="2026-10-12"');
  });

  it("marks a refused price and says why under it", () => {
    const html = draw(DEFAULTS, { "models.0.input": "Enter a price in USD." });
    expect(html).toMatch(/aria-invalid="true" aria-describedby="[^"]+-claude-opus-5-5-input-error"/);
    expect(html).toContain("Enter a price in USD.");
  });

  it("shows the list with Edit Prices, off while the server cannot save", () => {
    const html = renderToStaticMarkup(
      <PriceList prices={DEFAULT_AI_PRICES} canEdit={false} table={<p>The table</p>} notes={<p>Checked 12 Oct 2026.</p>} />,
    );
    expect(html).toContain('id="price-list"');
    expect(html).toContain("USD per million tokens, as Anthropic lists them. Changes apply to new calls.");
    expect(html).toContain("<p>The table</p>");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Edit Prices<\/button>/);
  });
});
