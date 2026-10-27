"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { tagLine } from "@/components/qc/photo-tags";
import { describePhotoBatch, photoVocabulary, type PhotoToDescribe, type PhotoVocabulary } from "@/lib/ai/photo-describer";
import { imageForClaude, type ClaudeImage } from "@/lib/ai/photo-image";
import { loadAiEnv } from "@/lib/ai/settings";
import { recordAiUsageLater } from "@/lib/ai/usage";
import { authorizeAction } from "@/lib/auth/session";
import {
  DESCRIBE_BATCH,
  DESCRIBE_MESSAGES,
  type DescribedPhoto,
  type DescribePhotosOptions,
  type DescribePhotosResult,
} from "@/lib/inspections/photos/descriptions";
import { displayTags, tagOptionsFromTemplate } from "@/lib/inspections/photos/view";
import { PHOTO_BUCKET } from "@/lib/photos/paths";
import { ResolvedTemplateSchema } from "@/lib/schemas/template";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { applyModuleOverrides, parseModuleOverrides } from "@/lib/templates/overrides";

/*
 * Steri-AI describes the report's photos (docs/AI.md, "Describing photos";
 * Kenneth, 27 October 2026: "Please loop in AI to identify properly rather
 * than squeezing in all photos without analyzing"). The Report page sends
 * the photos it can show that have no description yet, a few at a time,
 * and the photo's dialog one photo again (Describe Again). Captions only:
 * the inspector's caption stays theirs and wins in the report, and no
 * result changes.
 *
 * A Server Action is a public endpoint, so this checks the session and the
 * role's Steri-AI Reading, validates its input with zod, and asks the
 * database whether the caller may still change the inspection's photos
 * (can_edit_inspection: the inspector while it is a draft or reopened,
 * admins until it is approved, the rule Auto-Sort follows), reading through
 * the caller's client so Row Level Security decides which photos they see.
 * The stored photos are read and the descriptions written with the secret
 * key: only the app writes ai_description and ai_described_at
 * (description_guard, migration 20261027200000). The cost goes to Steri-AI
 * Cost as photo_description, and one audit row records each batch.
 */

const InputSchema = z.object({
  inspectionId: z.uuid(),
  photoIds: z
    .array(z.uuid())
    .min(1)
    .max(DESCRIBE_BATCH)
    .refine((ids) => new Set(ids).size === ids.length),
  again: z.boolean(),
});

/** Postgres undefined_column: a project that has not run migration 20261027200000. */
const UNDEFINED_COLUMN = "42703";

type PhotoRow = {
  id: string;
  module_key: string | null;
  target: string | null;
  caption: string | null;
  flagged: boolean;
  storage_path: string;
  ai_described_at: string | null;
};

/** Steri-AI describes up to DESCRIBE_BATCH of the inspection's photos, in one request, for a role with Steri-AI Reading. */
export async function describePhotos(
  inspectionId: string,
  photoIds: string[],
  options: DescribePhotosOptions = {},
): Promise<DescribePhotosResult> {
  try {
    const auth = await authorizeAction({ permission: "ai_reading" });
    if (!auth.ok) return { ok: false, error: auth.error };
    const input = InputSchema.safeParse({ inspectionId, photoIds, again: options?.again === true });
    if (!input.success) return { ok: false, error: DESCRIBE_MESSAGES.invalid };
    const { inspectionId: id, photoIds: ids, again } = input.data;

    const supabase = await createClient();
    const [allowed, inspection, photos] = await Promise.all([
      supabase.rpc("can_edit_inspection", { inspection_id: id }),
      supabase.from("inspections").select("id, module_overrides, template:templates(resolved)").eq("id", id).maybeSingle(),
      supabase
        .from("inspection_photos")
        .select("id, module_key, target, caption, flagged, storage_path, ai_described_at")
        .eq("inspection_id", id)
        .in("id", ids),
    ]);
    if (photos.error?.code === UNDEFINED_COLUMN) return { ok: false, error: DESCRIBE_MESSAGES.notReady, quiet: true };
    const failed = allowed.error ?? inspection.error ?? photos.error;
    if (failed) {
      console.error("[photo descriptions] reading the inspection's photos failed", failed.code, failed.message);
      return { ok: false, error: DESCRIBE_MESSAGES.noAnswer };
    }
    if (allowed.data !== true || !inspection.data) return { ok: false, error: DESCRIBE_MESSAGES.forbidden };

    // Asked for, in the order asked: the inspection's own, never a flagged original, described once unless asked again.
    const rows = new Map<string, PhotoRow>((photos.data ?? []).map((row) => [row.id, row]));
    const wanted = ids.flatMap((photoId) => {
      const row = rows.get(photoId);
      return row && !row.flagged && (again || row.ai_described_at === null) ? [row] : [];
    });
    if (wanted.length === 0) return wantedNone(ids, rows);

    const resolved = inspection.data.template?.resolved ?? null;
    const template = ResolvedTemplateSchema.safeParse(resolved);
    const overrides = parseModuleOverrides(inspection.data.module_overrides);
    const vocabulary: PhotoVocabulary = template.success
      ? photoVocabulary(applyModuleOverrides(template.data, overrides))
      : { holes: [], visual: [] };
    // What the inspector filed each photo as, in the screens' words: "Watertight · Size M · Palm", "Product Defects".
    const tagOptions = tagOptionsFromTemplate(resolved, inspection.data.module_overrides, []);
    const tagsOf = (row: PhotoRow) => (row.module_key === null ? null : tagLine(displayTags(row.module_key, row.target, tagOptions)));

    const admin = createAdminClient();
    const prepared = await Promise.all(wanted.map(async (row) => ({ row, image: await storedImage(admin, row.storage_path) })));
    const unreadable = prepared.filter((entry) => entry.image === "unreadable").map((entry) => entry.row);
    const sendable = prepared.flatMap((entry) =>
      entry.image && entry.image !== "unreadable" ? [{ row: entry.row, photo: { image: entry.image, tags: tagsOf(entry.row), caption: entry.row.caption } }] : [],
    );
    if (sendable.length === 0 && unreadable.length === 0) return { ok: false, error: DESCRIBE_MESSAGES.unreadable };

    let model: string | null = null;
    const answers: { row: PhotoRow; description: DescribedPhoto["description"] }[] = unreadable.map((row) => ({ row, description: null }));
    if (sendable.length > 0) {
      const outcome = await describePhotoBatch(
        sendable.map((entry): PhotoToDescribe => entry.photo),
        vocabulary,
        await loadAiEnv(),
        // Its cost (Steri-AI Cost), recorded after the response: one batch, the photos sent.
        recordAiUsageLater({ feature: "photo_description", inspectionId: id, actorId: auth.user.id, itemCount: sendable.length }),
      );
      if (!outcome.ok) return { ok: false, error: outcome.message };
      model = outcome.model;
      sendable.forEach((entry, index) => {
        const answer = outcome.answers[index];
        if (answer) answers.push({ row: entry.row, description: answer.description });
      });
    }

    const describedAt = new Date().toISOString();
    const written = await Promise.all(answers.map(({ row, description }) => recordDescription(admin, id, row.id, description, describedAt)));
    const saved: DescribedPhoto[] = answers.flatMap(({ row, description }, index) => (written[index] ? [{ id: row.id, description, describedAt }] : []));
    if (answers.length > 0 && saved.length === 0) return { ok: false, error: DESCRIBE_MESSAGES.gone };

    if (saved.length > 0) {
      const unclear = saved.filter((photo) => photo.description === null).length;
      await logDescribed(id, {
        by: auth.user.id,
        ...(model ? { model } : {}),
        photos: saved.length,
        ...(unclear > 0 ? { unclear } : {}),
        ...(again ? { again: true } : {}),
      });
    }
    return { ok: true, photos: saved };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[photo descriptions] describePhotos failed", error);
    return { ok: false, error: DESCRIBE_MESSAGES.unexpected };
  }
}

/** Nothing to describe: every photo asked for is described already (an answer with nothing new), or none is this inspection's. */
function wantedNone(ids: readonly string[], rows: ReadonlyMap<string, PhotoRow>): DescribePhotosResult {
  const found = ids.filter((photoId) => rows.has(photoId));
  if (found.length === 0) return { ok: false, error: DESCRIBE_MESSAGES.gone };
  return { ok: true, photos: [] };
}

/**
 * The stored photo as Claude takes it, read with the secret key: null when it
 * could not be downloaded (tried again later), "unreadable" when it is no
 * image Claude can read (recorded as looked at, so it is not sent again).
 */
async function storedImage(admin: ReturnType<typeof createAdminClient>, path: string): Promise<ClaudeImage | null | "unreadable"> {
  const { data, error } = await admin.storage.from(PHOTO_BUCKET).download(path);
  if (error || !data) {
    console.error("[photo descriptions] downloading a photo failed", error?.message);
    return null;
  }
  return (await imageForClaude(new Uint8Array(await data.arrayBuffer()))) ?? "unreadable";
}

/**
 * Stores Steri-AI's description of one photo with the secret key, only on
 * this inspection: true once it is written. A photo deleted meanwhile, or
 * whose inspection was approved since (its photos are read-only then, for
 * every role), is not.
 */
async function recordDescription(
  admin: ReturnType<typeof createAdminClient>,
  inspectionId: string,
  photoId: string,
  description: DescribedPhoto["description"],
  describedAt: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("inspection_photos")
    .update({ ai_description: description as Json | null, ai_described_at: describedAt })
    .eq("id", photoId)
    .eq("inspection_id", inspectionId)
    .select("id")
    .maybeSingle();
  if (error) console.error("[photo descriptions] recording a description failed", error.code, error.message);
  return !error && data !== null;
}

/**
 * The inspection's audit log, written with the secret key (an inspector may
 * record only a few events themselves): `photos_described`, `by` naming who.
 * The descriptions are stored either way, so a failed record is only logged.
 */
async function logDescribed(inspectionId: string, changes: Json): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc("log_inspection_event", {
      inspection_id: inspectionId,
      action: "photos_described",
      changes,
    });
    if (error) console.error("[photo descriptions] could not record photos_described", error.code, error.message);
  } catch (error) {
    console.error("[photo descriptions] could not record photos_described", error);
  }
}
