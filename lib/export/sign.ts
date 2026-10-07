import "server-only";
import { FILE_BUCKET, PHOTO_BUCKET } from "@/lib/photos/paths";
import type { ExportClient } from "./record";

/* ------------------------------------------------------------------ *
 * Signed URLs for the export (BUILD_SPEC 9.1) and the review panel. All
 * buckets are private; a signed URL lets a report service or a browser
 * fetch one object for a limited time. Signing runs as the caller, so
 * the storage policies decide what can be signed.
 * ------------------------------------------------------------------ */

/** Export links stay valid for 24 hours (BUILD_SPEC 9.1). */
export const EXPORT_URL_TTL_SECONDS = 24 * 60 * 60;

export const CLIENT_LOGO_BUCKET = "client-logos";
export const TEMPLATE_SOURCE_BUCKET = "template-sources";

/** Storage API batches are kept small. */
const SIGN_BATCH_SIZE = 100;

export type SignBucket =
  | typeof PHOTO_BUCKET
  | typeof FILE_BUCKET
  | typeof CLIENT_LOGO_BUCKET
  | typeof TEMPLATE_SOURCE_BUCKET;

/**
 * `missing`: object names refused one by one (the object does not exist, or
 * the caller may not read it). They are left out, never invented.
 */
export type SignResult = { ok: true; urls: Map<string, string>; missing: string[] } | { ok: false; message: string };

/**
 * Signs every object name in `paths` (each once). A refusal of the whole
 * request (network, outage, bad key) fails the lot, so an export never goes
 * out silently without its evidence; a refusal of one object lists it in
 * `missing`.
 */
export async function signObjects(
  client: ExportClient,
  bucket: SignBucket,
  paths: readonly string[],
  expiresIn: number,
): Promise<SignResult> {
  const unique = [...new Set(paths)];
  const urls = new Map<string, string>();
  const missing: string[] = [];
  for (let start = 0; start < unique.length; start += SIGN_BATCH_SIZE) {
    const batch = unique.slice(start, start + SIGN_BATCH_SIZE);
    let answer: Awaited<ReturnType<ReturnType<ExportClient["storage"]["from"]>["createSignedUrls"]>>;
    try {
      answer = await client.storage.from(bucket).createSignedUrls(batch, expiresIn);
    } catch (error) {
      console.error(`[export] signing objects in ${bucket} threw`, error);
      return { ok: false, message: signFailure(bucket) };
    }
    const { data, error } = answer;
    if (error || !data) {
      console.error(`[export] signing ${batch.length} objects in ${bucket} failed`, error?.message);
      return { ok: false, message: signFailure(bucket) };
    }
    batch.forEach((path, index) => {
      // Matched by path; the answer keeps the request order, which covers an entry without one.
      const entry = data.find((candidate) => candidate.path === path) ?? data[index];
      const url = entry && !entry.error ? entry.signedUrl : null;
      if (url) urls.set(path, url);
      else missing.push(path);
    });
  }
  return { ok: true, urls, missing };
}

function signFailure(bucket: SignBucket): string {
  const what: Record<SignBucket, string> = {
    [PHOTO_BUCKET]: "photos",
    [FILE_BUCKET]: "lab reports and certificates",
    [CLIENT_LOGO_BUCKET]: "client logo",
    [TEMPLATE_SOURCE_BUCKET]: "template's source file",
  };
  return `Could not create links to the ${what[bucket]}. Try again.`;
}
