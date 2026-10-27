import type { ExportClient } from "../record";

/* ------------------------------------------------------------------ *
 * An in-memory stand-in for the parts of supabase-js the export and the
 * AI actions use: from(table) with select / insert / update, eq / in /
 * order / limit, maybeSingle / single; rpc(); and storage signed URLs.
 * Rows are plain objects. A select returns the stored rows as they are,
 * so a test stores an inspection row with its embeds already joined, the
 * way PostgREST answers INSPECTION_RECORD_SELECT.
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown>;
type Filter = { column: string; op: "eq" | "in"; value: unknown };
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
  /** Fail a query: return an error for it instead of running it. `columns`: what select() named. */
  failQuery?: (query: RecordedQuery, columns?: string) => QueryError | null;
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
    const failure = options.failQuery?.(query, modifiers.columns) ?? null;
    if (failure) return { data: null, error: failure };
    const table = (tables[query.table] ??= []);
    const matches = (row: Row) =>
      query.filters.every((filter) =>
        filter.op === "eq"
          ? row[filter.column] === filter.value
          : (filter.value as unknown[]).includes(row[filter.column]),
      );

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
    if (modifiers.order) {
      const { column, ascending } = modifiers.order;
      rows = [...rows].sort((a, b) => {
        const left = String(a[column] ?? "");
        const right = String(b[column] ?? "");
        return ascending ? left.localeCompare(right) : right.localeCompare(left);
      });
    }
    if (modifiers.limit !== undefined) rows = rows.slice(0, modifiers.limit);
    return { data: rows.map((row) => ({ ...row })), error: null };
  };

  type Modifiers = { order?: { column: string; ascending: boolean }; limit?: number; columns?: string };

  const from = (table: string) => {
    const query: RecordedQuery = { table, operation: "select", filters: [] };
    const modifiers: Modifiers = {};
    const builder = {
      select: (columns?: string) => {
        modifiers.columns = columns;
        return builder;
      },
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
      order: (column: string, { ascending = true }: { ascending?: boolean } = {}) => {
        modifiers.order = { column, ascending };
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
