import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createInspection,
  createPeople,
  createTemplate,
  setStatus,
  UNSAFE_NAMES,
  type InspectionRow,
  type People,
} from "./fixtures";
import { asOwner, asService, asUser, column, createTestDb, pgError, type Db, type Tx } from "./harness";

/** What the Storage API runs, as the caller, when a file is uploaded. */
function upload(tx: Tx, bucket: string, name: string) {
  return tx.query("insert into storage.objects (bucket_id, name, owner_id) values ($1, $2, auth.uid()::text)", [
    bucket,
    name,
  ]);
}

function names(tx: Tx, bucket: string): Promise<string[]> {
  return column<string>(tx, "select name from storage.objects where bucket_id = $1 order by name", [bucket]);
}

// BUILD_SPEC 5 and 8.1: private buckets whose policies follow the inspection.
describe("storage policies", { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;
  let draft: InspectionRow;
  let submitted: InspectionRow;
  let others: InspectionRow;
  let approved: InspectionRow;
  // Stored by the service role (which bypasses RLS): it starts in the draft's
  // folder but resolves into another inspection's.
  let planted: string;

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
    const templateId = await createTemplate(db);
    draft = await createInspection(db, people.inspector, templateId);
    submitted = await createInspection(db, people.inspector, templateId);
    others = await createInspection(db, people.otherInspector, templateId);
    approved = await createInspection(db, people.otherInspector, templateId);
    planted = `${draft.id}/../${others.id}/planted.jpg`;
    await asService(db, async (tx) => {
      await upload(tx, "inspection-photos", `${submitted.id}/${randomUUID()}.jpg`);
      await upload(tx, "inspection-photos", `${others.id}/${randomUUID()}.jpg`);
      await upload(tx, "inspection-photos", `${approved.id}/${randomUUID()}.jpg`);
      await upload(tx, "inspection-files", `${approved.id}/${randomUUID()}.pdf`);
      // Malformed names that must never break a query or leak.
      await upload(tx, "inspection-photos", "not-an-inspection/photo.jpg");
      await upload(tx, "inspection-photos", "photo-without-folder.jpg");
      await upload(tx, "inspection-photos", planted);
    });
    await setStatus(db, people.inspector, submitted.id, "submitted");
    await setStatus(db, people.otherInspector, approved.id, "submitted");
    await setStatus(db, people.admin, approved.id, "approved");
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  describe("inspection-photos and inspection-files", () => {
    it("lets the inspector upload, read and remove files of their editable draft", async () => {
      const photo = `${draft.id}/${randomUUID()}.jpg`;
      const thumb = `${draft.id}/thumbs/${randomUUID()}.jpg`;
      const report = `${draft.id}/${randomUUID()}.pdf`;
      await asUser(db, people.inspector, async (tx) => {
        await upload(tx, "inspection-photos", photo);
        await upload(tx, "inspection-photos", thumb);
        await upload(tx, "inspection-files", report);
      });
      const seen = await asUser(db, people.inspector, (tx) => names(tx, "inspection-photos"));
      expect(seen).toEqual(expect.arrayContaining([photo, thumb]));

      const removed = await asUser(db, people.inspector, (tx) =>
        tx.query("delete from storage.objects where bucket_id = 'inspection-files' and name = $1", [report]),
      );
      expect(removed.affectedRows).toBe(1);
    });

    it("denies uploads into another inspector's folder", async () => {
      const error = await pgError(
        asUser(db, people.inspector, (tx) => upload(tx, "inspection-photos", `${others.id}/${randomUUID()}.jpg`)),
      );
      expect(error.code).toBe("42501");
    });

    it("denies uploads once the inspection is submitted, but still shows its photos", async () => {
      const error = await pgError(
        asUser(db, people.inspector, (tx) => upload(tx, "inspection-files", `${submitted.id}/${randomUUID()}.pdf`)),
      );
      expect(error.code).toBe("42501");
      const seen = await asUser(db, people.inspector, (tx) => names(tx, "inspection-photos"));
      expect(seen.some((name) => name.startsWith(`${submitted.id}/`))).toBe(true);
    });

    it("denies malformed paths with a policy error, never a cast error", async () => {
      for (const name of ["not-a-uuid/photo.jpg", "photo.jpg", `${draft.id}`, `${draft.id}/`, `x/${draft.id}/p.jpg`]) {
        const error = await pgError(asUser(db, people.inspector, (tx) => upload(tx, "inspection-photos", name)));
        expect(error, name).toMatchObject({ code: "42501" });
      }
    });

    it("hides other inspectors' files and malformed names without raising", async () => {
      const seen = await asUser(db, people.inspector, (tx) => names(tx, "inspection-photos"));
      expect(seen.every((name) => name.startsWith(`${draft.id}/`) || name.startsWith(`${submitted.id}/`))).toBe(true);
    });

    it("lets an admin read everything that belongs to an inspection and write to any of them", async () => {
      const seen = await asUser(db, people.admin, (tx) => names(tx, "inspection-photos"));
      expect(seen.some((name) => name.startsWith(`${others.id}/`))).toBe(true);
      expect(seen).not.toContain("not-an-inspection/photo.jpg");

      const added = await asUser(db, people.admin, (tx) =>
        upload(tx, "inspection-files", `${submitted.id}/${randomUUID()}.pdf`),
      );
      expect(added.affectedRows).toBe(1);
    });

    it("denies paths for inspections that do not exist, even to an admin", async () => {
      const error = await pgError(
        asUser(db, people.admin, (tx) => upload(tx, "inspection-photos", `${randomUUID()}/${randomUUID()}.jpg`)),
      );
      expect(error.code).toBe("42501");
    });
  });

  describe("signatures", () => {
    it("lets a user keep their signature in their own folder", async () => {
      const name = `${people.inspector}/signature.png`;
      await asUser(db, people.inspector, (tx) => upload(tx, "signatures", name));
      expect(await asUser(db, people.inspector, (tx) => names(tx, "signatures"))).toEqual([name]);
    });

    it("keeps it from other inspectors and shows it to admins", async () => {
      expect(await asUser(db, people.otherInspector, (tx) => names(tx, "signatures"))).toEqual([]);
      expect(await asUser(db, people.admin, (tx) => names(tx, "signatures"))).toEqual([
        `${people.inspector}/signature.png`,
      ]);
    });

    it("denies writing into someone else's folder, admins included", async () => {
      for (const userId of [people.otherInspector, people.admin]) {
        const error = await pgError(
          asUser(db, userId, (tx) => upload(tx, "signatures", `${people.inspector}/forged.png`)),
        );
        expect(error.code).toBe("42501");
      }
    });

    it("denies a signature outside any folder", async () => {
      const error = await pgError(asUser(db, people.inspector, (tx) => upload(tx, "signatures", "signature.png")));
      expect(error.code).toBe("42501");
    });
  });

  describe.each(["client-logos", "template-sources"])("%s", (bucket) => {
    it("lets admins upload and active users read", async () => {
      const name = `${randomUUID()}.png`;
      await asUser(db, people.admin, (tx) => upload(tx, bucket, name));
      expect(await asUser(db, people.inspector, (tx) => names(tx, bucket))).toContain(name);
    });

    it("denies uploads by inspectors", async () => {
      const error = await pgError(asUser(db, people.inspector, (tx) => upload(tx, bucket, `${randomUUID()}.png`)));
      expect(error.code).toBe("42501");
    });

    it("denies inspectors removing files", async () => {
      const removed = await asUser(db, people.inspector, (tx) =>
        tx.query("delete from storage.objects where bucket_id = $1", [bucket]),
      );
      expect(removed.affectedRows).toBe(0);
    });
  });
});
