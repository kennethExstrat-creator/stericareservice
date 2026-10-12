import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addUsage,
  createInspection,
  createPeople,
  createTemplate,
  promoteToAdmin,
  type InspectionRow,
  type People,
} from "./fixtures";
import { asAnon, asOwner, asService, asUser, createAuthUser, createTestDb, pgError, type Db, type Tx } from "./harness";

// Migration 20261013120000 (docs/DATABASE.md; docs/AI.md, "Steri-AI Cost"):
// one ai_usage row per Claude call, written by the app with the secret key,
// read by admins only, never changed or removed; and the three functions
// the Steri-AI Cost view reads. Migration 20261013130000 (12 October 2026):
// the Steri-AI Summary's job, inspection_summary, and its model and house
// style in ai_settings.

const INSERT = "insert into public.ai_usage (feature, model, duration_ms, outcome";

describe("Steri-AI usage: the rules", { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;
  let templateId: string;
  let inspection: InspectionRow;

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
    templateId = await createTemplate(db);
    inspection = await createInspection(db, people.inspector, templateId);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it.each([
    ["a job the app does not have", `${INSERT}) values ('report', 'claude-opus-5-5', 1, 'ok')`],
    ["a model that is not a Claude model id", `${INSERT}) values ('media_sort', 'gpt-5', 1, 'ok')`],
    ["a model id in capitals", `${INSERT}) values ('media_sort', 'Claude-Opus-5-5', 1, 'ok')`],
    ["a model id over 100 characters", `${INSERT}) values ('media_sort', 'claude-${"a".repeat(100)}', 1, 'ok')`],
    ["an outcome the app does not record", `${INSERT}) values ('media_sort', 'claude-opus-5-5', 1, 'partial')`],
    ["negative input tokens", `${INSERT}, input_tokens) values ('media_sort', 'claude-opus-5-5', 1, 'ok', -1)`],
    ["negative output tokens", `${INSERT}, output_tokens) values ('media_sort', 'claude-opus-5-5', 1, 'ok', -1)`],
    ["negative cache writes", `${INSERT}, cache_write_5m_tokens) values ('media_sort', 'claude-opus-5-5', 1, 'ok', -1)`],
    ["negative 1-hour cache writes", `${INSERT}, cache_write_1h_tokens) values ('media_sort', 'claude-opus-5-5', 1, 'ok', -1)`],
    ["negative cache reads", `${INSERT}, cache_read_tokens) values ('media_sort', 'claude-opus-5-5', 1, 'ok', -1)`],
    ["more than 1,000 items", `${INSERT}, item_count) values ('media_sort', 'claude-opus-5-5', 1, 'ok', 1001)`],
    ["a negative duration", `${INSERT}) values ('media_sort', 'claude-opus-5-5', -1, 'ok')`],
    ["a negative cost", `${INSERT}, cost_usd) values ('media_sort', 'claude-opus-5-5', 1, 'ok', -0.01)`],
    ["an error type over 60 characters", `${INSERT}, error_type) values ('media_sort', 'claude-opus-5-5', 1, 'failed', '${"x".repeat(61)}')`],
    ["prices that are not an object", "insert into public.ai_settings (id, prices) values (true, '[]')"],
    ["an effort the settings do not offer", "insert into public.ai_settings (id, review_effort) values (true, 'xhigh')"],
    ["more than 20 photos per review", "insert into public.ai_settings (id, review_max_photos) values (true, 21)"],
    ["a summary style that is not an object", "insert into public.ai_settings (id, summary_style) values (true, '[\"standard\"]')"],
    [
      "a summary style over 16 kB",
      `insert into public.ai_settings (id, summary_style) values (true, '{"customInstruction": "${"x".repeat(16_400)}"}')`,
    ],
    ["a summary model that is not a Claude model id", "insert into public.ai_settings (id, summary_model) values (true, 'gpt-5')"],
    ["a summary model id over 100 characters", `insert into public.ai_settings (id, summary_model) values (true, 'claude-${"a".repeat(100)}')`],
  ])("refuses %s", async (_label, sql) => {
    const error = await pgError(asService(db, (tx) => tx.query(sql)));
    expect(error.code).toBe("23514");
  });

  it("records the Steri-AI Summary's calls as inspection_summary", async () => {
    const added = await asService(db, (tx) =>
      tx.query<{ feature: string; item_count: number }>(
        `insert into public.ai_usage (feature, model, inspection_id, actor_id, item_count, duration_ms, outcome)
         values ('inspection_summary', 'claude-sonnet-5-5', $1, $2, 1, 5600, 'ok'),
                ('inspection_summary', 'claude-sonnet-5-5', $1, $2, 0, 4100, 'ok')
         returning feature, item_count`,
        [inspection.id, people.inspector],
      ),
    );
    expect(added.rows).toEqual([
      { feature: "inspection_summary", item_count: 1 },
      { feature: "inspection_summary", item_count: 0 },
    ]);
  });

  it("keeps the summary model and house style in the settings row, null for the app's defaults", async () => {
    const saved = await asService(db, (tx) =>
      tx.query<{ summary_model: string | null; summary_style: unknown }>(
        `insert into public.ai_settings (id, summary_model, summary_style)
         values (true, 'claude-opus-5-5', '{"length": "brief", "tone": "formal"}')
         on conflict (id) do update set summary_model = excluded.summary_model, summary_style = excluded.summary_style
         returning summary_model, summary_style`,
      ),
    );
    expect(saved.rows).toEqual([{ summary_model: "claude-opus-5-5", summary_style: { length: "brief", tone: "formal" } }]);

    const reset = await asService(db, (tx) =>
      tx.query("update public.ai_settings set summary_model = null, summary_style = null returning summary_model, summary_style"),
    );
    expect(reset.rows).toEqual([{ summary_model: null, summary_style: null }]);
  });

  it("keeps the price list, the effort and the photos in the settings row", async () => {
    const saved = await asService(db, (tx) =>
      tx.query<{ prices: unknown; review_effort: string; review_max_photos: number }>(
        `insert into public.ai_settings (id, prices, review_effort, review_max_photos)
         values (true, '{"checkedOn": "2026-10-12"}', 'medium', 0)
         on conflict (id) do update set prices = excluded.prices, review_effort = excluded.review_effort,
           review_max_photos = excluded.review_max_photos
         returning prices, review_effort, review_max_photos`,
      ),
    );
    expect(saved.rows).toEqual([{ prices: { checkedOn: "2026-10-12" }, review_effort: "medium", review_max_photos: 0 }]);
  });

  it("lets the service role add rows, never date, change or remove them", async () => {
    const added = await asService(db, (tx) =>
      tx.query<{ id: string; created_at: string; item_count: number }>(
        `insert into public.ai_usage
           (feature, model, inspection_id, actor_id, item_count, input_tokens, duration_ms, outcome, cost_usd, created_at)
         values ('media_sort', 'claude-opus-5-5', $1, $2, 12, 15000, 900, 'ok', 0.066, '2020-01-01T00:00:00Z')
         returning id, created_at, item_count`,
        [inspection.id, people.inspector],
      ),
    );
    expect(added.rows[0].item_count).toBe(12);
    // set_updated_at stamps the insert: a caller cannot backdate a cost.
    expect(added.rows[0].created_at.startsWith("2020")).toBe(false);

    for (const sql of ["update public.ai_usage set cost_usd = 0", "delete from public.ai_usage"]) {
      const error = await pgError(asService(db, (tx) => tx.query(sql)));
      expect(error, sql).toMatchObject({ code: "42501", message: "permission denied for table ai_usage" });
    }
  });

  it("keeps the spend of a deleted draft, with the link cleared", async () => {
    const draft = await createInspection(db, people.inspector, templateId);
    const usage = await addUsage(db, { inspection_id: draft.id, actor_id: people.inspector, cost_usd: 0.05 });
    // The list's Delete.
    await asUser(db, people.inspector, (tx) => tx.query("select public.delete_draft_inspection($1)", [draft.id]));

    const left = await asOwner(db, (tx) =>
      tx.query("select inspection_id, actor_id, cost_usd::float8 as cost_usd from public.ai_usage where id = $1", [usage]),
    );
    expect(left.rows).toEqual([{ inspection_id: null, actor_id: people.inspector, cost_usd: 0.05 }]);
  });

  it("never blocks deleting a person, and keeps their spend with the link cleared", async () => {
    const temp = await createAuthUser(db, { email: "temp@test.local", fullName: "Tara Temp" });
    const usage = await addUsage(db, { feature: "new_inspection_read", actor_id: temp, cost_usd: 0.036 });
    await asOwner(db, (tx) => tx.query("delete from auth.users where id = $1", [temp]));

    const left = await asOwner(db, async (tx) => ({
      profiles: (await tx.query("select id from public.profiles where id = $1", [temp])).rows,
      usage: (await tx.query("select actor_id, cost_usd::float8 as cost_usd from public.ai_usage where id = $1", [usage])).rows,
    }));
    expect(left).toEqual({ profiles: [], usage: [{ actor_id: null, cost_usd: 0.036 }] });
  });
});

type SummaryRow = {
  feature: string;
  model: string;
  calls: number;
  failed: number;
  unpriced: number;
  units: number;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  unlinked_cost_usd: number;
};

async function summary(tx: Tx, since: string | null): Promise<SummaryRow[]> {
  const result = await tx.query<SummaryRow>(
    `select feature, model, calls::int, failed::int, unpriced::int, units::int, input_tokens::int, output_tokens::int,
            cache_write_tokens::int, cache_read_tokens::int, cost_usd::float8, unlinked_cost_usd::float8
       from public.ai_usage_summary($1) order by feature, model`,
    [since],
  );
  return result.rows;
}

async function trend(tx: Tx, since: string | null, bucket: string) {
  const result = await tx.query<{ bucket_start: string; feature: string; calls: number; cost_usd: number }>(
    "select bucket_start, feature, calls::int, cost_usd::float8 from public.ai_usage_trend($1, $2)",
    [since, bucket],
  );
  return result.rows;
}

async function byInspection(tx: Tx, since: string | null, maxRows: number | null) {
  const result = await tx.query(
    `select inspection_id, ref_no, po_no, inspection_date, status::text, documents::int, media_items::int, reviews::int,
            calls::int, cost_usd::float8, inspection_count::int
       from public.ai_usage_by_inspection($1, $2)`,
    [since, maxRows],
  );
  return result.rows;
}

/** The first day of the Last 30 Days ending 13 October 2026 would start here; any Malaysia midnight will do. */
const SINCE_12_OCT = "2026-10-12T00:00:00+08:00";

describe("Steri-AI usage: the cost view's functions", { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;
  let first: InspectionRow;
  let second: InspectionRow;

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
    const templateId = await createTemplate(db);
    first = await createInspection(db, people.inspector, templateId, { po_no: "PO-1" });
    second = await createInspection(db, people.otherInspector, templateId, { po_no: "PO-2" });

    // 23:30 on 12 October in Malaysia (UTC+8), and 00:30 on 13 October.
    await addUsage(db, {
      inspection_id: first.id,
      actor_id: people.inspector,
      input_tokens: 20_000,
      cache_read_tokens: 3_000,
      output_tokens: 4_000,
      cost_usd: 0.1606,
      createdAt: "2026-10-12T15:30:00Z",
    });
    await addUsage(db, {
      inspection_id: first.id,
      actor_id: people.inspector,
      input_tokens: 1_000,
      cache_write_5m_tokens: 1_500,
      cache_write_1h_tokens: 500,
      output_tokens: 500,
      cost_usd: 0.025,
      createdAt: "2026-10-12T16:30:00Z",
    });
    await addUsage(db, {
      feature: "media_sort",
      inspection_id: second.id,
      actor_id: people.otherInspector,
      item_count: 12,
      input_tokens: 15_000,
      output_tokens: 300,
      cost_usd: 0.066,
      createdAt: "2026-10-13T02:00:00Z",
    });
    // Before the inspection exists: no link.
    await addUsage(db, {
      feature: "new_inspection_read",
      actor_id: people.inspector,
      input_tokens: 5_000,
      output_tokens: 800,
      cost_usd: 0.036,
      createdAt: "2026-10-13T03:00:00Z",
    });
    // A fallback model with no price.
    await addUsage(db, {
      feature: "second_opinion",
      model: "claude-opus-4-8",
      inspection_id: first.id,
      actor_id: people.admin,
      input_tokens: 9_000,
      output_tokens: 2_000,
      cost_usd: null,
      createdAt: "2026-10-13T04:00:00Z",
    });
    // A review that failed six weeks earlier: no tokens, no cost.
    await addUsage(db, {
      feature: "second_opinion",
      inspection_id: second.id,
      actor_id: people.admin,
      outcome: "failed",
      error_type: "overloaded_error",
      cost_usd: 0,
      createdAt: "2026-09-01T00:00:00Z",
    });
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("sums each job and model, failed, unpriced and unlinked calls apart", async () => {
    const allTime = await asUser(db, people.admin, (tx) => summary(tx, null));
    const zero = { failed: 0, unpriced: 0, cache_write_tokens: 0, cache_read_tokens: 0, unlinked_cost_usd: 0 };
    expect(allTime).toEqual([
      { ...zero, feature: "media_sort", model: "claude-opus-5-5", calls: 1, units: 12, input_tokens: 15_000, output_tokens: 300, cost_usd: 0.066 },
      {
        ...zero,
        feature: "new_inspection_read",
        model: "claude-opus-5-5",
        calls: 1,
        units: 1,
        input_tokens: 5_000,
        output_tokens: 800,
        cost_usd: 0.036,
        unlinked_cost_usd: 0.036,
      },
      {
        ...zero,
        feature: "second_opinion",
        model: "claude-opus-4-8",
        calls: 1,
        unpriced: 1,
        units: 1,
        input_tokens: 9_000,
        output_tokens: 2_000,
        cost_usd: 0,
      },
      { ...zero, feature: "second_opinion", model: "claude-opus-5-5", calls: 1, failed: 1, units: 1, input_tokens: 0, output_tokens: 0, cost_usd: 0 },
      {
        ...zero,
        feature: "source_document_read",
        model: "claude-opus-5-5",
        calls: 2,
        units: 2,
        input_tokens: 21_000,
        output_tokens: 4_500,
        cache_write_tokens: 2_000,
        cache_read_tokens: 3_000,
        cost_usd: 0.1856,
      },
    ]);

    const fromTwelfth = await asUser(db, people.admin, (tx) => summary(tx, SINCE_12_OCT));
    expect(fromTwelfth.map((row) => `${row.feature} ${row.model}`)).toEqual([
      "media_sort claude-opus-5-5",
      "new_inspection_read claude-opus-5-5",
      "second_opinion claude-opus-4-8",
      "source_document_read claude-opus-5-5",
    ]);
  });

  it("counts Malaysia days: 15:30 and 16:30 UTC on 12 October fall on the 12th and the 13th", async () => {
    const days = await asUser(db, people.admin, (tx) => trend(tx, null, "day"));
    expect(days).toEqual([
      { bucket_start: "2026-09-01", feature: "second_opinion", calls: 1, cost_usd: 0 },
      { bucket_start: "2026-10-12", feature: "source_document_read", calls: 1, cost_usd: 0.1606 },
      { bucket_start: "2026-10-13", feature: "media_sort", calls: 1, cost_usd: 0.066 },
      { bucket_start: "2026-10-13", feature: "new_inspection_read", calls: 1, cost_usd: 0.036 },
      { bucket_start: "2026-10-13", feature: "second_opinion", calls: 1, cost_usd: 0 },
      { bucket_start: "2026-10-13", feature: "source_document_read", calls: 1, cost_usd: 0.025 },
    ]);
    const fromThirteenth = await asUser(db, people.admin, (tx) => trend(tx, "2026-10-13T00:00:00+08:00", "day"));
    expect(fromThirteenth.map((row) => row.bucket_start)).toEqual(["2026-10-13", "2026-10-13", "2026-10-13", "2026-10-13"]);
  });

  it("groups by Malaysia month, and answers nothing for another bucket", async () => {
    const months = await asUser(db, people.admin, (tx) => trend(tx, null, "month"));
    expect(months).toEqual([
      { bucket_start: "2026-09-01", feature: "second_opinion", calls: 1, cost_usd: 0 },
      { bucket_start: "2026-10-01", feature: "media_sort", calls: 1, cost_usd: 0.066 },
      { bucket_start: "2026-10-01", feature: "new_inspection_read", calls: 1, cost_usd: 0.036 },
      { bucket_start: "2026-10-01", feature: "second_opinion", calls: 1, cost_usd: 0 },
      { bucket_start: "2026-10-01", feature: "source_document_read", calls: 2, cost_usd: 0.1856 },
    ]);
    expect(await asUser(db, people.admin, (tx) => trend(tx, null, "week"))).toEqual([]);
  });

  it("lists the costliest inspections first, with how many spent anything", async () => {
    const firstRow = {
      inspection_id: first.id,
      ref_no: first.ref_no,
      po_no: "PO-1",
      inspection_date: first.inspection_date,
      status: "draft",
      documents: 2,
      media_items: 0,
      reviews: 1,
      calls: 3,
      cost_usd: 0.1856,
      inspection_count: 2,
    };
    const secondRow = {
      inspection_id: second.id,
      ref_no: second.ref_no,
      po_no: "PO-2",
      inspection_date: second.inspection_date,
      status: "draft",
      documents: 0,
      media_items: 12,
      reviews: 1,
      calls: 2,
      cost_usd: 0.066,
      inspection_count: 2,
    };
    expect(await asUser(db, people.admin, (tx) => byInspection(tx, null, 50))).toEqual([firstRow, secondRow]);
    // Top N, with the count of all of them; at least one row, at most 200.
    expect(await asUser(db, people.admin, (tx) => byInspection(tx, null, 1))).toEqual([firstRow]);
    expect(await asUser(db, people.admin, (tx) => byInspection(tx, null, 0))).toEqual([firstRow]);
    expect(await asUser(db, people.admin, (tx) => byInspection(tx, null, null))).toEqual([firstRow, secondRow]);
    // The failed review of 1 September falls outside the period.
    expect(await asUser(db, people.admin, (tx) => byInspection(tx, SINCE_12_OCT, 50))).toEqual([
      firstRow,
      { ...secondRow, reviews: 0, calls: 1 },
    ]);
  });

  it("answers nobody but an active admin: the inspector, also about their own inspection, and a deactivated admin get nothing", async () => {
    const formerAdmin = await createAuthUser(db, { email: "former-admin@test.local", fullName: "Fay Former" });
    await promoteToAdmin(db, formerAdmin);
    await asOwner(db, (tx) => tx.query("update public.profiles set active = false where id = $1", [formerAdmin]));

    for (const userId of [people.inspector, formerAdmin]) {
      const seen = await asUser(db, userId, async (tx) => ({
        summary: await summary(tx, null),
        trend: await trend(tx, null, "day"),
        inspections: await byInspection(tx, null, 50),
      }));
      expect(seen, userId).toEqual({ summary: [], trend: [], inspections: [] });
    }
  });

  it("is not for anon", async () => {
    for (const [fn, sql] of [
      ["ai_usage_summary", "select * from public.ai_usage_summary()"],
      ["ai_usage_trend", "select * from public.ai_usage_trend()"],
      ["ai_usage_by_inspection", "select * from public.ai_usage_by_inspection()"],
    ]) {
      const error = await pgError(asAnon(db, (tx) => tx.query(sql)));
      expect(error, fn).toMatchObject({ code: "42501", message: `permission denied for function ${fn}` });
    }
  });
});
