import type { ExportClient } from "../record";

/* ------------------------------------------------------------------ *
 * An in-memory stand-in for the parts of supabase-js the export and the
 * AI actions use: from(table) with select / insert / update, eq / in /
 * or (`column.eq.value` conditions, as loadParts asks for an inspection's
 * PO parts) / order (several: the first decides) / limit, maybeSingle /
 * single; rpc(); and storage signed URLs. Rows are plain objects. A
 * select returns the stored rows as they are, so a test stores an
 * inspection row with its embeds already joined, the way PostgREST
 * answers INSPECTION_RECORD_SELECT.
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown>;
type Filter =
  | { column: string; op: "eq" | "in"; value: unknown }
  /** Any of the conditions: PostgREST's or=(a.eq.1,b.eq.2). */
  | { op: "or"; conditions: { column: string; value: string }[] };
type QueryError = { code?: string; message: string };

export type RecordedQuery = {
  table: string;
  operation: "select" | "insert" | "update" | "delete";
  filters: Filter[];
  payload?: unknown;
};

export type FakeSupabaseOptions = {
  tables?: Record<string, Row[]>;
  /** Object names per bucket that exist and can be signed. */
  objects?: Record<string, string[]>;
  /** Fail a query: return an error for it instead of running it. */
  failQuery?: (query: RecordedQuery) => QueryError | null;
  /** Fail every signing request to a bucket (an outage). */
  failSigning?: (bucket: string) => boolean;
  /** Clock for created_at / updated_at. */
  now?: () => string;
};

export type FakeSupabase = {
  client: ExportClient;
  tables: Record<string, Row[]>;
  queries: RecordedQuery[];
  rpcCalls: { name: string; args: unknown }[];
  signed: { bucket: string; paths: string[]; expiresIn: number }[];
};

let counter = 0;

/** A lowercase v4-shaped UUID, unique within the test run. */
export function fakeId(): string {
  counter += 1;
  const tail = counter.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${tail}`;
}

export function createFakeSupabase(options: FakeSupabaseOptions = {}): FakeSupabase {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(options.tables ?? {})) tables[name] = rows.map((row) => ({ ...row }));
  const queries: RecordedQuery[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];
  const signed: FakeSupabase["signed"] = [];
  const now = options.now ?? (() => new Date().toISOString());

  const run = (query: RecordedQuery, modifiers: Modifiers): { data: Row[] | null; error: QueryError | null } => {
    queries.push(query);
    const failure = options.failQuery?.(query) ?? null;
    if (failure) return { data: null, error: failure };
    const table = (tables[query.table] ??= []);
    const matches = (row: Row) =>
      query.filters.every((filter) => {
        switch (filter.op) {
          case "eq":
            return row[filter.column] === filter.value;
          case "in":
            return (filter.value as unknown[]).includes(row[filter.column]);
          case "or":
            return filter.conditions.some((condition) => row[condition.column] === condition.value);
        }
      });

    let rows: Row[];
    switch (query.operation) {
      case "insert": {
        const values = Array.isArray(query.payload) ? query.payload : [query.payload];
        rows = values.map((value) => {
          const stamp = now();
          const row: Row = { id: fakeId(), created_at: stamp, updated_at: stamp, ...(value as Row) };
          if (query.table === "ai_review_actions") row.at ??= stamp;
          table.push(row);
          return row;
        });
        break;
      }
      case "update":
        rows = table.filter(matches);
        for (const row of rows) Object.assign(row, query.payload as Row, { updated_at: now() });
        break;
      case "delete":
        rows = table.filter(matches);
        tables[query.table] = table.filter((row) => !matches(row));
        break;
      default:
        rows = table.filter(matches);
    }
    if (modifiers.order.length > 0) {
      const compare = (a: Row, b: Row, { column, ascending }: Modifiers["order"][number]) => {
        const left = String(a[column] ?? "");
        const right = String(b[column] ?? "");
        return ascending ? left.localeCompare(right) : right.localeCompare(left);
      };
      rows = [...rows].sort((a, b) => {
        for (const order of modifiers.order) {
          const result = compare(a, b, order);
          if (result !== 0) return result;
        }
        return 0;
      });
    }
    if (modifiers.limit !== undefined) rows = rows.slice(0, modifiers.limit);
    return { data: rows.map((row) => ({ ...row })), error: null };
  };

  type Modifiers = { order: { column: string; ascending: boolean }[]; limit?: number };

  const from = (table: string) => {
    const query: RecordedQuery = { table, operation: "select", filters: [] };
    const modifiers: Modifiers = { order: [] };
    const builder = {
      select: () => builder,
      insert: (payload: unknown) => {
        query.operation = "insert";
        query.payload = payload;
        return builder;
      },
      update: (payload: unknown) => {
        query.operation = "update";
        query.payload = payload;
        return builder;
      },
      delete: () => {
        query.operation = "delete";
        return builder;
      },
      eq: (column: string, value: unknown) => {
        query.filters.push({ column, op: "eq", value });
        return builder;
      },
      in: (column: string, value: unknown[]) => {
        query.filters.push({ column, op: "in", value });
        return builder;
      },
      or: (expression: string) => {
        query.filters.push({ op: "or", conditions: expression.split(",").map(orCondition) });
        return builder;
      },
      order: (column: string, { ascending = true }: { ascending?: boolean } = {}) => {
        modifiers.order.push({ column, ascending });
        return builder;
      },
      limit: (count: number) => {
        modifiers.limit = count;
        return builder;
      },
      maybeSingle: async () => {
        const { data, error } = run(query, modifiers);
        return { data: data?.[0] ?? null, error };
      },
      single: async () => {
        const { data, error } = run(query, modifiers);
        if (error) return { data: null, error };
        if (!data || data.length !== 1) return { data: null, error: { code: "PGRST116", message: "not one row" } };
        return { data: data[0], error: null };
      },
      then: <T>(resolve: (value: { data: Row[] | null; error: QueryError | null }) => T, reject?: (reason: unknown) => T) =>
        Promise.resolve(run(query, modifiers)).then(resolve, reject),
    };
    return builder;
  };

  const storage = {
    from: (bucket: string) => ({
      createSignedUrls: async (paths: string[], expiresIn: number) => {
        signed.push({ bucket, paths: [...paths], expiresIn });
        if (options.failSigning?.(bucket)) return { data: null, error: { message: "Storage is down" } };
        const existing = new Set(options.objects?.[bucket] ?? []);
        return {
          data: paths.map((path) =>
            existing.has(path)
              ? {
                  path,
                  error: null,
                  signedURL: `/object/sign/${bucket}/${path}?token=t`,
                  signedUrl: `https://storage.test/object/sign/${bucket}/${path}?token=t&expires=${expiresIn}`,
                }
              : { path, error: "Either the object does not exist or you do not have access to it", signedURL: null, signedUrl: null },
          ),
          error: null,
        };
      },
    }),
  };

  const rpc = async (name: string, args: unknown) => {
    rpcCalls.push({ name, args });
    return { data: rpcCalls.length, error: null };
  };

  return { client: { from, storage, rpc } as unknown as ExportClient, tables, queries, rpcCalls, signed };
}

/** `group_id.eq.<uuid>`; any other operator fails the test loudly instead of matching wrongly. */
function orCondition(text: string): { column: string; value: string } {
  const match = /^([a-z_]+)\.eq\.(.+)$/.exec(text.trim());
  if (!match) throw new Error(`The fake Supabase client only reads or() conditions like column.eq.value, not "${text}".`);
  return { column: match[1], value: match[2] };
}
