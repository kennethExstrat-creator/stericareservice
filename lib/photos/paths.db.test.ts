import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UNSAFE_NAMES } from "@/tests/db/fixtures";
import { asOwner, createTestDb, type Db } from "@/tests/db/harness";
import { filePath, photoPath, storageInspectionId, thumbPath } from "./paths";

// The storage policies and the path checks on inspection_photos and inspection_files read object
// names through public.storage_inspection_id(). The names the upload queue makes must pass the
// function the migrations define, not a copy of its rule.
describe("storage object names against the database", { timeout: 60_000 }, () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb({ seed: false });
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  const folderOf = (name: string) =>
    asOwner(db, async (tx) => {
      const result = await tx.query<{ id: string | null }>("select public.storage_inspection_id($1) as id", [name]);
      return result.rows[0].id;
    });

  it("puts photos, thumbnails and files in their inspection's folder", async () => {
    const inspection = randomUUID();
    const id = randomUUID();
    const names = [photoPath(inspection, id), photoPath(inspection, id, "heic"), thumbPath(inspection, id), filePath(inspection, id, "pdf")];
    for (const name of names) expect(await folderOf(name)).toBe(inspection);
  });

  it("reads any name the way the database does (storageInspectionId)", async () => {
    const folder = randomUUID();
    const other = randomUUID();
    const names = [
      `${folder}/${randomUUID()}.jpg`,
      `${folder}/thumbs/${randomUUID()}.jpg`,
      ...UNSAFE_NAMES.map(([, name]) => name(folder, other)),
      "not-an-inspection/photo.jpg",
      folder,
      `${folder}/photo with space.jpg`,
    ];
    for (const name of names) expect(storageInspectionId(name)).toBe(await folderOf(name));
  });
});
