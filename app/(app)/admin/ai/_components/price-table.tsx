// The price list as it stands, for the Price List card (price-list.tsx shows
// it until Edit Prices): a table from 1024 px, one block per model with its
// five prices in two columns below (iPad portrait), and when the list was
// checked. USD per million tokens, as Anthropic lists and bills them; while
// the cost view is in ringgit, each price's ringgit beside it, "$4.00
// (RM 16.34)". A server component.
import { Fragment } from "react";
import { formatInspectionDate } from "@/lib/inspections/format";
import type { AiPriceList, TokenRates } from "@/lib/schemas/ai-prices";
import { CLAUDE_MODELS } from "@/lib/schemas/ai-settings";
import { formatCost, formatMyrRate, USD, type Money } from "./money";
import { longPromptLabel, RATE_KEYS, RATE_LABEL } from "./price-form";

/** "Claude Haiku 5.5" for the app's models, else null (the id stands for itself). */
export function modelLabel(model: string): string | null {
  return CLAUDE_MODELS.find((entry) => entry.id === model)?.label ?? null;
}

function ModelName({ model }: { model: string }) {
  const label = modelLabel(model);
  return label ? <>{label}</> : <span className="font-mono break-all">{model}</span>;
}

function inRinggit(money: Money): boolean {
  return money.currency === "myr" && money.myrPerUsd !== null;
}

/** "$4.00", and "(RM 16.34)" beside it while the view is in ringgit. */
function Price({ value, money }: { value: number; money: Money }) {
  const dollars = formatCost(value, USD, "unit");
  if (!inRinggit(money)) return <>{dollars}</>;
  return (
    <>
      {`${dollars} `}
      <span className="text-muted-foreground">{`(${formatCost(value, money, "unit")})`}</span>
    </>
  );
}

function RateGrid({ rates, money }: { rates: TokenRates; money: Money }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
      {RATE_KEYS.map((rate) => (
        <div key={rate} className="flex min-w-0 flex-col">
          <dt className="text-sm text-muted-foreground">{RATE_LABEL[rate]}</dt>
          <dd className="tabular-nums">
            <Price value={rates[rate]} money={money} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function RateCells({ rates, money }: { rates: TokenRates; money: Money }) {
  return RATE_KEYS.map((rate) => (
    <td key={rate} className="border-b border-border px-3 py-2 text-right tabular-nums whitespace-nowrap last:pr-0">
      <Price value={rates[rate]} money={money} />
    </td>
  ));
}

/** `money`: the cost view's currency and rate; USD shows the dollars alone. */
export function PriceTable({ prices, money = USD }: { prices: AiPriceList; money?: Money }) {
  return (
    <>
      <table className="hidden w-full text-sm lg:table" data-testid="price-table">
        <caption className="sr-only">
          {inRinggit(money) ? "Prices in USD per million tokens, ringgit in brackets" : "Prices in USD per million tokens"}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="border-b border-border py-2 pr-3 text-left font-medium text-muted-foreground">
              Model
            </th>
            {RATE_KEYS.map((rate) => (
              <th
                key={rate}
                scope="col"
                className="border-b border-border px-3 py-2 text-right font-medium whitespace-nowrap text-muted-foreground last:pr-0"
              >
                {RATE_LABEL[rate]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {prices.models.map((entry) => (
            <Fragment key={entry.model}>
              <tr>
                <th scope="row" className="border-b border-border py-2 pr-3 text-left font-medium">
                  <ModelName model={entry.model} />
                </th>
                <RateCells rates={entry} money={money} />
              </tr>
              {entry.longPrompt && (
                <tr>
                  <th scope="row" className="border-b border-border py-2 pr-3 pl-4 text-left font-normal text-muted-foreground">
                    <span className="sr-only">
                      <ModelName model={entry.model} />,{" "}
                    </span>
                    {longPromptLabel(entry.longPrompt.aboveTokens)}
                  </th>
                  <RateCells rates={entry.longPrompt} money={money} />
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>

      <ul className="flex flex-col gap-3 lg:hidden" data-testid="price-blocks">
        {prices.models.map((entry) => (
          <li key={entry.model} className="flex flex-col gap-2 rounded-lg border border-border p-3 touch:p-4">
            <p className="font-medium">
              <ModelName model={entry.model} />
            </p>
            <RateGrid rates={entry} money={money} />
            {entry.longPrompt && (
              <div className="mt-1 flex flex-col gap-2 border-t border-border pt-3">
                <p className="text-sm font-medium text-muted-foreground">{longPromptLabel(entry.longPrompt.aboveTokens)}</p>
                <RateGrid rates={entry.longPrompt} money={money} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/** "Checked 12 Oct 2026.", and the admin's own rate when set: "Own rate: RM 4.15 per US$1 (1 Oct 2026)." */
export function PriceNotes({ prices }: { prices: AiPriceList }) {
  const own =
    prices.myrPerUsd === null
      ? ""
      : ` Own rate: ${formatMyrRate(prices.myrPerUsd)} per US$1${prices.myrRateOn ? ` (${formatInspectionDate(prices.myrRateOn)})` : ""}.`;
  return <p className="text-sm text-muted-foreground">{`Checked ${formatInspectionDate(prices.checkedOn)}.${own}`}</p>;
}
