import { randomUUID } from "node:crypto";
import type { Database, Tables, TablesInsert } from "@/lib/supabase/database.types";
import { asOwner, asService, asUser, column, createAuthUser, type Db, type Tx } from "./harness";

export type TableName = keyof Database["public"]["Tables"];

// A Record, so the compiler flags a table added to the schema but not here.
// false: no signed-in user may read the table at all (ai_settings: the service
// role only), so the per-role read checks leave it out; rls-admin.test.ts
// checks that even an admin is refused. ai_usage is readable by admins only:
// everyone else reads no rows. roles: every active user reads them.
const tableSet: Record<TableName, boolean> = {
  ai_review_actions: true,
  ai_reviews: true,
  ai_settings: false,
  ai_usage: true,
  audit_log: true,
  clients: true,
  defect_codes: true,
  inspection_files: true,
  inspection_photos: true,
  inspections: true,
  manufacturer_brands: true,
  manufacturer_companies: true,
  manufacturers: true,
  profiles: true,
  roles: true,
  templates: true,
};

/** Every public table, from the generated types. */
export const TABLES = (Object.keys(tableSet) as TableName[]).filter((table) => tableSet[table]);

/** Rows of a table the current session can see. */
export async function visibleRows(tx: Tx, table: TableName): Promise<number> {
  const result = await tx.query<{ n: number }>(`select count(*)::int as n from public.${table}`);
  return result.rows[0].n;
}

/**
 * Object names that start in `folder` but are not in canonical form, most of
 * them because a URL parser would resolve them into `other` (supabase-js puts
 * stored names into request URLs unencoded). Every pointer column and every
 * folder policy must refuse them.
 */
export const UNSAFE_NAMES: [label: string, name: (folder: string, other: string) => string][] = [
  ["a '..' segment", (folder, other) => `${folder}/../${other}/${randomUUID()}.jpg`],
  ["a '..' segment after a subfolder", (folder, other) => `${folder}/thumbs/../../${other}/${randomUUID()}.jpg`],
  ["a '.' segment", (folder) => `${folder}/./${randomUUID()}.jpg`],
  ["an empty segment", (folder) => `${folder}//${randomUUID()}.jpg`],
  ["backslashes", (folder, other) => `${folder}/..\\${other}\\${randomUUID()}.jpg`],
  ["percent-encoded dots", (folder, other) => `${folder}/%2e%2e/${other}/${randomUUID()}.jpg`],
  ["dots split by a tab", (folder, other) => `${folder}/.\t./${other}/${randomUUID()}.jpg`],
  ["an uppercase folder id", (folder) => `${folder.toUpperCase()}/${randomUUID()}.jpg`],
];

/** Ids of the people most suites need, all active. */
export interface People {
  admin: string;
  inspector: string;
  otherInspector: string;
}

/** Kenneth's first-admin step: one UPDATE in the SQL editor (docs/DATABASE.md). */
export async function promoteToAdmin(db: Db, userId: string): Promise<void> {
  await asOwner(db, (tx) =>
    tx.query("update public.profiles set role = 'admin', active = true where id = $1", [userId]),
  );
}

/** What the invite action does with the secret key once Auth has created the user. */
export async function activate(db: Db, userId: string): Promise<void> {
  await asService(db, (tx) => tx.query("update public.profiles set active = true where id = $1", [userId]));
}

/**
 * A lead inspector (migration 20261007170000), active and set up by the
 * owner, as Kenneth would in the SQL editor. Their team starts empty.
 */
export async function createLead(db: Db, email: string, fullName: string): Promise<string> {
  const id = await createAuthUser(db, { email, fullName });
  await asOwner(db, (tx) => tx.query("update public.profiles set is_lead = true where id = $1", [id]));
  return id;
}

/** Puts an inspector in a lead inspector's team (or takes them out with null), as the owner. */
export async function assignLead(db: Db, inspectorId: string, leadId: string | null): Promise<void> {
  await asOwner(db, (tx) => tx.query("update public.profiles set lead_id = $2 where id = $1", [inspectorId, leadId]));
}

export async function createPeople(db: Db): Promise<People> {
  const admin = await createAuthUser(db, { email: "admin@test.local", fullName: "Ada Admin" });
  await promoteToAdmin(db, admin);
  const inspector = await createAuthUser(db, {
    email: "inspector@test.local",
    fullName: "Ivan Inspector",
  });
  const otherInspector = await createAuthUser(db, {
    email: "other@test.local",
    fullName: "Olga Other",
  });
  return { admin, inspector, otherInspector };
}

/** Templates are seeded in Phase 2; tests make their own as the owner. */
export async function createTemplate(
  db: Db,
  values: Partial<TablesInsert<"templates">> = {},
): Promise<string> {
  const row: TablesInsert<"templates"> = {
    code: "STD_EG",
    version: 1,
    product_type: "examination",
    standard: "EN455",
    status: "active",
    definition: { code: values.code ?? "STD_EG", modules: [] },
    resolved: { code: values.code ?? "STD_EG", modules: [] },
    ...values,
  };
  const result = await asOwner(db, (tx) =>
    tx.query<{ id: string }>(
      `insert into public.templates (code, version, product_type, standard, status, definition, resolved)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [
        row.code,
        row.version,
        row.product_type,
        row.standard,
        row.status,
        JSON.stringify(row.definition),
        JSON.stringify(row.resolved),
      ],
    ),
  );
  return result.rows[0].id;
}

export type InspectionRow = Tables<"inspections">;

/**
 * The columns that repeat the data for lists and search, as the app computes
 * them (lib/inspections/capture/mirror.ts) and hands them to
 * create_inspection(), save_inspection() and submit_inspection().
 */
export type MirroredColumns = Partial<
  Pick<
    InspectionRow,
    "po_no" | "product_name" | "lot_numbers" | "inspection_date" | "remarks" | "result" | "suggested_result"
  >
>;

export const EMPTY_DATA = { modules: {}, custom: {} };

/** One inspection as the database owner reads it, or undefined. */
export async function readInspection(db: Db, inspectionId: string): Promise<InspectionRow | undefined> {
  const result = await asOwner(db, (tx) =>
    tx.query<InspectionRow>("select * from public.inspections where id = $1", [inspectionId]),
  );
  return result.rows[0];
}

async function currentVersion(db: Db, inspectionId: string): Promise<string | null> {
  return (await readInspection(db, inspectionId))?.updated_at ?? null;
}

/**
 * Starts an inspection the way the app does (migration 20261007190000): the
 * createInspection Server Action calls public.create_inspection() with the
 * secret key, for the signed-in user, who becomes its inspector.
 */
export async function createInspection(
  db: Db,
  actorId: string,
  templateId: string,
  values: MirroredColumns & { client_id?: string | null; manufacturer_id?: string | null; data?: unknown } = {},
): Promise<InspectionRow> {
  const { client_id = null, manufacturer_id = null, data = EMPTY_DATA, ...columns } = values;
  const created = await asService(db, (tx) =>
    column<string>(
      tx,
      `select public.create_inspection(
         actor_id => $1, template_id => $2, manufacturer_id => $3, client_id => $4,
         data => $5, mirrored_columns => $6)`,
      [actorId, templateId, manufacturer_id, client_id, JSON.stringify(data), JSON.stringify(columns)],
    ),
  );
  const row = await readInspection(db, created[0]);
  if (!row) throw new Error("create_inspection() answered an id that does not exist");
  return row;
}

/**
 * Inserts an inspection directly with the user's own session: what an admin
 * may do through the Data API, and what an inspector no longer may.
 */
export async function insertInspection(
  db: Db,
  userId: string,
  templateId: string,
  values: { inspector_id?: string; po_no?: string; lot_numbers?: string[] } = {},
): Promise<InspectionRow> {
  const result = await asUser(db, userId, (tx) =>
    tx.query<InspectionRow>(
      `insert into public.inspections (template_id, inspector_id, po_no, lot_numbers)
       values ($1, coalesce($2::uuid, auth.uid()), $3, coalesce($4::text[], '{}'))
       returning *`,
      [templateId, values.inspector_id ?? null, values.po_no ?? null, values.lot_numbers ?? null],
    ),
  );
  return result.rows[0];
}

/**
 * The capture screen's autosave (saveCaptureData): public.save_inspection()
 * with the secret key, for `actorId`. Saves at the inspection's current
 * version unless given another; keeps its data unless given new data.
 * Answers the new updated_at, or null when nothing was written.
 */
export async function saveInspection(
  db: Db,
  actorId: string,
  inspectionId: string,
  values: { data?: unknown; columns?: MirroredColumns; baseUpdatedAt?: string | null } = {},
): Promise<string | null> {
  const stored = await readInspection(db, inspectionId);
  const base = values.baseUpdatedAt === undefined ? (stored?.updated_at ?? null) : values.baseUpdatedAt;
  const data = values.data ?? stored?.data ?? EMPTY_DATA;
  const saved = await asService(db, (tx) =>
    column<string | null>(
      tx,
      `select public.save_inspection(
         inspection_id => $1, actor_id => $2, base_updated_at => $3, data => $4, mirrored_columns => $5)`,
      [inspectionId, actorId, base, JSON.stringify(data), JSON.stringify(values.columns ?? {})],
    ),
  );
  return saved[0];
}

/**
 * Submits the way the app does (submitInspection): public.submit_inspection()
 * with the secret key, for `actorId`, at the inspection's current version
 * unless given another. Answers the new updated_at, or null when nothing was
 * written.
 */
export async function submitInspection(
  db: Db,
  actorId: string,
  inspectionId: string,
  values: { columns?: MirroredColumns; baseUpdatedAt?: string | null } = {},
): Promise<string | null> {
  const base = values.baseUpdatedAt === undefined ? await currentVersion(db, inspectionId) : values.baseUpdatedAt;
  const submitted = await asService(db, (tx) =>
    column<string | null>(
      tx,
      `select public.submit_inspection(
         inspection_id => $1, actor_id => $2, base_updated_at => $3, mirrored_columns => $4)`,
      [inspectionId, actorId, base, JSON.stringify(values.columns ?? {})],
    ),
  );
  return submitted[0];
}

/**
 * Moves an inspection through the status flow the way the app does: a
 * submit through submit_inspection() for the user, an approval or a reopen
 * with the user's own session (admins). Fails when nothing changed.
 */
export async function setStatus(
  db: Db,
  userId: string,
  inspectionId: string,
  status: InspectionRow["status"],
): Promise<InspectionRow> {
  if (status === "submitted") {
    if ((await submitInspection(db, userId, inspectionId)) === null) {
      throw new Error("submit_inspection() wrote nothing");
    }
    return (await readInspection(db, inspectionId))!;
  }
  const result = await asUser(db, userId, (tx) =>
    tx.query<InspectionRow>(
      "update public.inspections set status = $2 where id = $1 returning *",
      [inspectionId, status],
    ),
  );
  if (result.rows.length !== 1) {
    throw new Error(`status change to ${status} matched ${result.rows.length} rows`);
  }
  return result.rows[0];
}

/** A lab report row, written as the service role. */
export async function addFile(db: Db, inspectionId: string, createdBy: string): Promise<string> {
  const path = `${inspectionId}/${randomUUID()}.pdf`;
  await asService(db, (tx) =>
    tx.query(
      `insert into public.inspection_files (inspection_id, kind, storage_path, name, created_by)
       values ($1, 'lab_report', $2, 'lab-report.pdf', $3)`,
      [inspectionId, path, createdBy],
    ),
  );
  return path;
}

/** A finished AI review with one finding an admin agreed with. */
export async function addReview(db: Db, inspectionId: string, adminId: string): Promise<string> {
  return asService(db, async (tx) => {
    const review = await tx.query<{ id: string }>(
      `insert into public.ai_reviews (inspection_id, inspection_updated_at, status, findings)
       values ($1, now(), 'done', '[{"id": "f1"}]') returning id`,
      [inspectionId],
    );
    await tx.query(
      "insert into public.ai_review_actions (ai_review_id, finding_id, actor_id, action) values ($1, 'f1', $2, 'agree')",
      [review.rows[0].id, adminId],
    );
    return review.rows[0].id;
  });
}

/** A photo row plus its storage object, written as the service role. */
export async function addPhoto(db: Db, inspectionId: string, createdBy: string): Promise<string> {
  const path = `${inspectionId}/${randomUUID()}.jpg`;
  await asService(db, async (tx) => {
    await tx.query(
      "insert into storage.objects (bucket_id, name, owner_id) values ('inspection-photos', $1, $2)",
      [path, createdBy],
    );
    await tx.query(
      "insert into public.inspection_photos (inspection_id, storage_path, created_by) values ($1, $2, $3)",
      [inspectionId, path, createdBy],
    );
  });
  return path;
}

/** An ai_usage row's columns, and when the call was made. */
export type UsageValues = Partial<Omit<TablesInsert<"ai_usage">, "created_at" | "updated_at">> & { createdAt?: string };

/**
 * One Claude call's cost record (migration 20261013120000; the app writes it
 * with the secret key, lib/ai/usage.ts), inserted as the owner: a document
 * read on Claude Opus 5.5 unless told otherwise. With `createdAt` the call is
 * dated then, with set_updated_at switched off for the insert (it stamps now()
 * otherwise, whoever inserts).
 */
export async function addUsage(db: Db, values: UsageValues = {}): Promise<string> {
  const { createdAt, ...columns } = values;
  const row: TablesInsert<"ai_usage"> = {
    feature: "source_document_read",
    model: "claude-opus-5-5",
    duration_ms: 1_000,
    outcome: "ok",
    ...columns,
    ...(createdAt ? { created_at: createdAt, updated_at: createdAt } : {}),
  };
  const names = Object.keys(row);
  const placeholders = names.map((_, index) => `$${index + 1}`).join(", ");
  return asOwner(db, async (tx) => {
    if (createdAt) await tx.exec("alter table public.ai_usage disable trigger set_updated_at");
    const result = await tx.query<{ id: string }>(
      `insert into public.ai_usage (${names.join(", ")}) values (${placeholders}) returning id`,
      Object.values(row),
    );
    if (createdAt) await tx.exec("alter table public.ai_usage enable trigger set_updated_at");
    return result.rows[0].id;
  });
}
