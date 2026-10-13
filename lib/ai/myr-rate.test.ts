// The rate Steri-AI Cost converts at: Bank Negara Malaysia's latest noon
// middle rate (read with a stand-in fetch, answers shaped as BNM's month
// route gave them on 13 October 2026, a month with no rates yet as
// {"data":[]}), the last one read when BNM fails, and the admin's own rate
// first.
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_PRICES } from "@/lib/schemas/ai-prices";
import { bnmRateReader, FALLBACK_MYR_RATE, latestMiddleRate, pickMyrRate } from "./myr-rate";

/** 13:00 on 13 October 2026 in Malaysia. */
const NOW = new Date("2026-10-13T05:00:00Z");
const MINUTE = 60_000;

const OCTOBER = {
  data: {
    currency_code: "USD",
    unit: 1,
    rate: [
      { date: "2026-10-09", buying_rate: 4.0860000000000003, selling_rate: 4.0910000000000002, middle_rate: 4.0884999999999998 },
      { date: "2026-10-12", buying_rate: 4.0795000000000003, selling_rate: 4.085, middle_rate: 4.0823 },
      { date: "2026-10-01", buying_rate: 4.0839999999999996, selling_rate: 4.0869999999999997, middle_rate: 4.0854999999999997 },
    ],
  },
  meta: { quote: "rm", session: "1200", last_updated: "2026-10-12 23:01:24", total_result: 3 },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** BNM's answer for a month with no noon rate yet: HTTP 200, no rows (November, asked on 13 October 2026). */
const NO_RATES_YET = { data: [], meta: { quote: "rm", session: "1200", last_updated: "2026-10-13 14:01:25", total_result: 0 } };

/** A fetch that answers each month route from `months` ("2026/10"), else with no rows, as BNM does. */
function bnm(months: Record<string, unknown>) {
  return vi.fn(async (input: string | URL | Request) => {
    const month = /\/year\/(\d{4})\/month\/(\d{1,2})\?session=1200$/.exec(String(input));
    const body = month ? months[`${month[1]}/${month[2]}`] : undefined;
    return json(body ?? NO_RATES_YET);
  });
}

describe("the noon rate", () => {
  it("is the latest business day's middle rate, to 4 decimals", () => {
    expect(latestMiddleRate(OCTOBER.data.rate)).toEqual({ myrPerUsd: 4.0823, on: "2026-10-12", source: "bnm" });
    expect(latestMiddleRate([{ date: "2026-10-13", middle_rate: null }, ...OCTOBER.data.rate])?.on).toBe("2026-10-12");
    expect(latestMiddleRate([])).toBeNull();
  });

  it("skips a rate no RM per US$1 could be: none, nothing, or US$ per RM", () => {
    for (const middle_rate of [0, 0.2447, 100]) {
      expect(latestMiddleRate([...OCTOBER.data.rate, { date: "2026-10-13", middle_rate }])?.on).toBe("2026-10-12");
    }
  });

  it("is read from this Malaysian month's route, with the Accept header BNM requires", async () => {
    const fetchRate = bnm({ "2026/10": OCTOBER });
    expect(await bnmRateReader(fetchRate)(NOW)).toEqual({ myrPerUsd: 4.0823, on: "2026-10-12", source: "bnm" });
    const [url, init] = fetchRate.mock.calls[0] as unknown as [string, RequestInit & { next?: { revalidate?: number } }];
    expect(url).toBe("https://api.bnm.gov.my/public/exchange-rate/USD/year/2026/month/10?session=1200");
    expect(init.headers).toEqual({ Accept: "application/vnd.BNM.API.v1+json" });
    // Next keeps the answer a day; the signal gives up on BNM after 2.5 seconds.
    expect(init.next?.revalidate).toBe(86_400);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("comes from last month while this one has none, December's in January", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fetchRate = bnm({ "2026/12": { data: { rate: [{ date: "2026-12-31", middle_rate: 4.1 }] } } });
      // 1 January 2027, 09:00 in Malaysia: January's route answers {"data":[]}.
      expect(await bnmRateReader(fetchRate)(new Date("2027-01-01T01:00:00Z"))).toEqual({ myrPerUsd: 4.1, on: "2026-12-31", source: "bnm" });
      expect(fetchRate.mock.calls.map(([url]) => String(url).split("/USD/")[1])).toEqual([
        "year/2027/month/1?session=1200",
        "year/2026/month/12?session=1200",
      ]);
      // A 404 for this month is read the same way.
      const notFound = vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/month/1?") ? json({ status: false, message: "No records found." }, 404) : json({ data: { rate: { date: "2026-12-31", middle_rate: 4.1 } } }),
      );
      expect((await bnmRateReader(notFound)(new Date("2027-01-01T01:00:00Z")))?.on).toBe("2026-12-31");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("asks again only after an hour, and after a failure keeps the last rate and leaves BNM alone for 15 minutes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fetchRate = bnm({ "2026/10": OCTOBER });
      const read = bnmRateReader(fetchRate);
      expect((await read(NOW))?.myrPerUsd).toBe(4.0823);
      expect((await read(new Date(NOW.getTime() + 30 * MINUTE)))?.myrPerUsd).toBe(4.0823);
      expect(fetchRate).toHaveBeenCalledTimes(1);

      fetchRate.mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
      const later = NOW.getTime() + 61 * MINUTE;
      expect(await read(new Date(later))).toEqual({ myrPerUsd: 4.0823, on: "2026-10-12", source: "bnm" });
      expect(fetchRate).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledOnce();
      await read(new Date(later + 10 * MINUTE));
      expect(fetchRate).toHaveBeenCalledTimes(2);
      await read(new Date(later + 16 * MINUTE));
      expect(fetchRate).toHaveBeenCalledTimes(3);
    } finally {
      warn.mockRestore();
    }
  });

  it("is none before any was read when BNM fails or answers something else", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await bnmRateReader(vi.fn(async () => json({}, 500)))(NOW)).toBeNull();
      expect(await bnmRateReader(vi.fn(async () => json({ data: { rate: "soon" } })))(NOW)).toBeNull();
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("the rate in use", () => {
  it("is the admin's own when the price list has one, else BNM's, else the built-in one", () => {
    const own = { ...DEFAULT_AI_PRICES, myrPerUsd: 4.15, myrRateOn: "2026-10-01" };
    const read = { myrPerUsd: 4.0823, on: "2026-10-12", source: "bnm" as const };
    expect(pickMyrRate(own, read)).toEqual({ myrPerUsd: 4.15, on: "2026-10-01", source: "price_list" });
    expect(pickMyrRate(DEFAULT_AI_PRICES, read)).toBe(read);
    expect(pickMyrRate(DEFAULT_AI_PRICES, null)).toBe(FALLBACK_MYR_RATE);
    // BNM's rate, marked built in, so the view says BNM was not reached.
    expect(FALLBACK_MYR_RATE).toEqual({ myrPerUsd: 4.086, on: "2026-10-13", source: "built_in" });
  });
});
