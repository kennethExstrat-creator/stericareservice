import "server-only";
import { z } from "zod";
import { todayInMalaysia } from "@/lib/inspections/create";
import type { AiPriceList } from "@/lib/schemas/ai-prices";
import type { MyrRate } from "@/lib/schemas/ai-usage";
import { IsoDateSchema } from "@/lib/schemas/common";

/*
 * The rate Steri-AI Cost works its ringgit out at (docs/AI.md, "Steri-AI
 * Cost"; Kenneth, 13 October 2026: a currency switch, ringgit first). Costs
 * stay in US dollars, as Anthropic bills; only the screen converts. The
 * admin's own rate when the price list has one ("Use My Own Rate"), else
 * Bank Negara Malaysia's USD middle rate at noon (RM per US$1) for the
 * latest business day it has published, else the last one read since the
 * server started, else FALLBACK_MYR_RATE. Never throws, and never holds the
 * page up for long: BNM gets 2.5 seconds, and is left alone for 15 minutes
 * after a failure.
 *
 * BNM's Open API (https://apikijangportal.bnm.gov.my: free, no key), as
 * tested on 13 October 2026:
 * - the Accept header below is required (without it, a 404 and an HTML page);
 * - the 1200 session is interbank, with a middle rate (the default session,
 *   1130, is the banks' counter rates, whose middle rate is null);
 * - the month route lists the session's business days, today's from the
 *   early afternoon (13 October's noon rate appeared at 13:46), and answers
 *   a month with none yet with HTTP 200 and no rows ({"data":[]}, as it did
 *   for November), so early in a month the previous one is read (a 404 is
 *   read the same way);
 * - no CORS: a browser cannot read it, so the server does.
 * Next keeps each answer for a day (fetch's next.revalidate), then serves the
 * kept one while it asks again in the background. Rates carry binary noise
 * (4.0860000000000003), so they are rounded to 4 decimals, as BNM prints
 * them. Terms (https://www.bnm.gov.my/terms-of-use-bnm-datasets): free to
 * use with "Source: Bank Negara Malaysia" and that link (cost-filters.tsx).
 */

const BNM_USD = "https://api.bnm.gov.my/public/exchange-rate/USD";
const BNM_ACCEPT = "application/vnd.BNM.API.v1+json";
const BNM_SESSION = "1200";
/** Next's data cache keeps an answer this long. */
const KEEP_SECONDS = 24 * 60 * 60;
const TIMEOUT_MS = 2_500;
/** This server looks again after an hour (Next's cache answers, so BNM is asked about once a day). */
const LOOK_AGAIN_MS = 60 * 60 * 1000;
/** After a failure, BNM is left alone this long: the page never waits on it twice in a row. */
const QUIET_MS = 15 * 60 * 1000;

/**
 * Bank Negara Malaysia's USD middle rate at noon on 13 October 2026, RM
 * 4.0860 per US$1 (buying 4.0840, selling 4.0880), read at 12:56 MYT that
 * day from https://api.bnm.gov.my/public/exchange-rate/USD?session=1200. The
 * rate while BNM cannot be reached and none has been read since the server
 * started; its date shows how old it is, and the cost view says BNM could
 * not be reached (cost-filters.tsx).
 */
export const FALLBACK_MYR_RATE: MyrRate = { myrPerUsd: 4.086, on: "2026-10-13", source: "built_in" };

/**
 * RM per US$1 BNM's answer may hold. Outside it is a misread, such as US$ per
 * RM (0.2447), not a rate: the row is skipped rather than shown as costs a
 * sixteenth of their size.
 */
const PLAUSIBLE_MIN = 1;
const PLAUSIBLE_MAX = 20;

const RowSchema = z.object({ date: IsoDateSchema, middle_rate: z.number().nullish() });
const AnswerSchema = z.object({
  // A month with no rates yet answers {"data":[]}.
  data: z.union([z.object({ rate: z.union([z.array(RowSchema), RowSchema]) }), z.tuple([])]),
});
type Row = z.infer<typeof RowSchema>;

type Fetch = typeof fetch;

/** The latest business day with a plausible middle rate, rounded to 4 decimals; null when none has one. */
export function latestMiddleRate(rows: readonly Row[]): MyrRate | null {
  let latest: { date: string; rate: number } | null = null;
  for (const row of rows) {
    const rate = row.middle_rate;
    if (typeof rate !== "number" || !(rate >= PLAUSIBLE_MIN && rate <= PLAUSIBLE_MAX)) continue;
    if (!latest || row.date > latest.date) latest = { date: row.date, rate };
  }
  return latest ? { myrPerUsd: Math.round(latest.rate * 10_000) / 10_000, on: latest.date, source: "bnm" } : null;
}

/** A month's noon rates; none while BNM has none for it ({"data":[]}, or a 404). Throws when BNM fails or answers something else. */
async function monthRows(fetchRate: Fetch, year: number, month: number, signal: AbortSignal): Promise<Row[]> {
  const response = await fetchRate(`${BNM_USD}/year/${year}/month/${month}?session=${BNM_SESSION}`, {
    headers: { Accept: BNM_ACCEPT },
    signal,
    next: { revalidate: KEEP_SECONDS },
  });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`Bank Negara Malaysia answered ${response.status}.`);
  const { data } = AnswerSchema.parse(await response.json());
  if (Array.isArray(data)) return [];
  return Array.isArray(data.rate) ? data.rate : [data.rate];
}

/** This Malaysian month's latest noon rate, else last month's; null when neither has one. */
async function readBnmRate(fetchRate: Fetch, now: Date): Promise<MyrRate | null> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const [year, month] = todayInMalaysia(now).split("-").map(Number);
  const current = latestMiddleRate(await monthRows(fetchRate, year, month, signal));
  if (current) return current;
  return latestMiddleRate(await monthRows(fetchRate, month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1, signal));
}

/**
 * A reader of BNM's rate with its own memory: the last rate read, and when
 * to ask again. `fetchRate` stands in for fetch in tests.
 */
export function bnmRateReader(fetchRate?: Fetch): (now?: Date) => Promise<MyrRate | null> {
  let last: MyrRate | null = null;
  let lookAt = 0;
  return async (now = new Date()) => {
    if (now.getTime() < lookAt) return last;
    try {
      // Next's own fetch, as it is at call time, so its cache applies.
      const rate = await readBnmRate(fetchRate ?? fetch, now);
      lookAt = now.getTime() + (rate ? LOOK_AGAIN_MS : QUIET_MS);
      if (rate) last = rate;
    } catch (error) {
      lookAt = now.getTime() + QUIET_MS;
      console.warn("[ai cost] Bank Negara Malaysia's rate could not be read", error);
    }
    return last;
  };
}

/** BNM's latest noon rate, or the last one read; null before any. Never throws. */
export const latestBnmRate = bnmRateReader();

/** The rate the cost view converts at: the admin's own, else BNM's, else FALLBACK_MYR_RATE ("built_in"). */
export function pickMyrRate(prices: AiPriceList, bnm: MyrRate | null): MyrRate {
  if (prices.myrPerUsd !== null) {
    // The schema asks for the date with the rate; the day the list was checked only satisfies the type.
    return { myrPerUsd: prices.myrPerUsd, on: prices.myrRateOn ?? prices.checkedOn, source: "price_list" };
  }
  return bnm ?? FALLBACK_MYR_RATE;
}
