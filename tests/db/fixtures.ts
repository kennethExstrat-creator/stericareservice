import { randomUUID } from "node:crypto";
import type { Database, Tables, TablesInsert } from "@/lib/supabase/database.types";
import { asOwner, asService, asUser, createAuthUser, type Db, type Tx } from "./harness";

export type TableName = keyof Database["public"]["Tables"];

// A Record, so the compiler flags a table added to the schema but not here.
const tableSet: Record<TableName, true> = {
  ai_review_actions: true,
  ai_reviews: true,
  audit_log: true,
  clients: true,
  defect_codes: true,
  inspection_files: true,
  inspection_photos: true,
  inspections: true,
  manufacturers: true,
  profiles: true,
  templates: true,
};

/** Every public table, from the generated types. */
export const TABLES = Object.keys(tableSet) as TableName[];

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

/** Ids of the people most suites need. Every one starts as an inspector. */
export interface People {
  admin: string;
  inspector: string;
  otherInspector: string;
}

/** Kenneth's first-admin step: one UPDATE in the SQL editor. */
export async function promoteToAdmin(db: Db, userId: string): Promise<void> {
  await asOwner(db, (tx) =>
    tx.query("update public.profiles set role = 'admin' where id = $1", [userId]),
  );
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

/** Inserts an inspection as the given user, the way the app does. */
export async function createInspection(
  db: Db,
  userId: string,
  templateId: string,
  values: { po_no?: string; lot_numbers?: string[]; inspector_id?: string } = {},
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

/** Moves an inspection through the status flow as the given user. */
export async function setStatus(
  db: Db,
  userId: string,
  inspectionId: string,
  status: InspectionRow["status"],
): Promise<InspectionRow> {
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
