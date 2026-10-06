import "server-only";
import { getAiStatus } from "@/lib/ai";
import type { SessionUser } from "@/lib/auth/session";
import {
  canExportInspection,
  evaluateRecord,
  loadInspectionRecord,
  parseInspectionId,
  signObjects,
  type ExportClient,
} from "@/lib/export";
import { personLabel } from "@/lib/inspections/format";
import { PHOTO_BUCKET } from "@/lib/photos/paths";
import { AiReviewActionKindSchema } from "@/lib/schemas/ai-review";
import { createClient } from "@/lib/supabase/server";
import { buildAiPanelModel, type StoredDecision } from "./panel-model";
import { AI_REVIEW_COLUMNS, parseStoredReview, type AiReviewRow, type StoredAiReview } from "./stored";
import type { AiPanelModel } from "./types";

/* ------------------------------------------------------------------ *
 * Everything the AI review panel shows for one inspection, read as the
 * signed-in user: the inspection run through the module framework (the
 * system and inspector columns), its stored reviews (the AI column and
 * the history) and, for admins, the decisions recorded on findings. The
 * inspection and the reviews load side by side; decisions come embedded
 * in the reviews.
 * ------------------------------------------------------------------ */

/** Photo links in the panel outlive a long review session but not the day. */
export const PANEL_LINK_TTL_SECONDS = 60 * 60;

/** The newest reviews are enough history for one inspection. */
const REVIEW_LIMIT = 50;

/** Reviews with the decisions on their findings and who made them. Only admins read decisions (RLS). */
const REVIEWS_WITH_DECISIONS = `${AI_REVIEW_COLUMNS}, decisions:ai_review_actions(finding_id, action, note, at, actor:profiles!ai_review_actions_actor_id_fkey(full_name, email))`;

type Person = { full_name: string | null; email: string | null };

type DecisionRow = {
  finding_id: string;
  action: string;
  note: string | null;
  at: string;
  actor: Person | Person[] | null;
};

export type AiPanelLoad =
  | { ok: true; model: AiPanelModel }
  | { ok: false; reason: "not_found" | "unavailable"; message: string };

export async function loadAiPanel(
  user: Pick<SessionUser, "id" | "role">,
  inspectionId: string,
  options: { client?: ExportClient; now?: number } = {},
): Promise<AiPanelLoad> {
  const id = parseInspectionId(inspectionId);
  if (!id) return { ok: false, reason: "not_found", message: "Inspection not found." };
  const client = options.client ?? (await createClient());
  const isAdmin = user.role === "admin";

  const [loaded, reviewRows] = await Promise.all([
    loadInspectionRecord(client, id),
    client
      .from("ai_reviews")
      .select(isAdmin ? REVIEWS_WITH_DECISIONS : AI_REVIEW_COLUMNS)
      .eq("inspection_id", id)
      .order("created_at", { ascending: false })
      .limit(REVIEW_LIMIT),
  ]);
  if (!loaded.ok) {
    return loaded.reason === "not_found"
      ? { ok: false, reason: "not_found", message: loaded.message }
      : { ok: false, reason: "unavailable", message: loaded.message };
  }
  const { record } = loaded;
  if (!canExportInspection(user, record)) return { ok: false, reason: "not_found", message: "Inspection not found." };
  if (reviewRows.error) return unavailable("the AI reviews", reviewRows.error);

  const evaluation = evaluateRecord(record);
  if (!evaluation.ok) return { ok: false, reason: "unavailable", message: evaluation.message };

  const rows = reviewRows.data as unknown as (AiReviewRow & { decisions?: DecisionRow[] })[];
  const reviews = rows.map(parseStoredReview);
  const decisions = isAdmin ? rows.flatMap((row) => decisionsOf(row.id, row.decisions ?? [])) : [];

  return {
    ok: true,
    model: buildAiPanelModel({
      record,
      evaluated: evaluation.evaluated,
      reviews,
      decisions,
      photoLinks: await citedPhotoLinks(client, record.photos, reviews),
      aiStatus: getAiStatus(),
      isAdmin,
      now: options.now ?? Date.now(),
    }),
  };
}

function decisionsOf(reviewId: string, rows: readonly DecisionRow[]): StoredDecision[] {
  return rows.flatMap((row): StoredDecision[] => {
    const action = AiReviewActionKindSchema.safeParse(row.action);
    if (!action.success) return [];
    const actor = Array.isArray(row.actor) ? row.actor[0] : row.actor;
    return [
      {
        reviewId,
        findingId: row.finding_id,
        action: action.data,
        note: row.note,
        at: row.at,
        actor: (actor && personLabel(actor)) ?? "An admin",
      },
    ];
  });
}

/**
 * Signed links (an hour) for the photos the reviews cite: the thumbnail to
 * show, the full photo to open. A failure only costs the pictures; the
 * evidence still lists each photo by caption and tags.
 */
async function citedPhotoLinks(
  client: ExportClient,
  photos: readonly { id: string; storagePath: string; thumbPath: string | null; flagged: boolean }[],
  reviews: readonly StoredAiReview[],
): Promise<{ thumbs: Map<string, string>; full: Map<string, string> }> {
  const cited = new Set(reviews.flatMap((review) => review.findings.flatMap((finding) => finding.evidence.photos)));
  const wanted = photos.filter((photo) => cited.has(photo.id));
  const thumbs = new Map<string, string>();
  const full = new Map<string, string>();
  if (wanted.length === 0) return { thumbs, full };

  const paths = wanted.flatMap((photo) => [photo.storagePath, ...(photo.thumbPath ? [photo.thumbPath] : [])]);
  const signed = await signObjects(client, PHOTO_BUCKET, paths, PANEL_LINK_TTL_SECONDS);
  if (!signed.ok) return { thumbs, full };
  for (const photo of wanted) {
    const original = signed.urls.get(photo.storagePath);
    const thumb = photo.thumbPath ? signed.urls.get(photo.thumbPath) : undefined;
    if (original) full.set(photo.id, original);
    // A photo without a thumbnail shows itself; a flagged original (HEIC) shows no picture.
    const preview = thumb ?? original;
    if (!photo.flagged && preview) thumbs.set(photo.id, preview);
  }
  return { thumbs, full };
}

function unavailable(what: string, error: { code?: string; message: string }): AiPanelLoad {
  console.error(`[ai panel] reading ${what} failed`, { code: error.code, message: error.message });
  return { ok: false, reason: "unavailable", message: `Could not read ${what}. Try again.` };
}
