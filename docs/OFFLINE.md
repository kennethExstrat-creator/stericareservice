# Offline and photos

Client-side persistence for capture on the iPad (BUILD_SPEC 8, "Speed", and 8.1): autosave with a local IndexedDB copy, photo processing in the browser, and the background upload queue. All of it is framework-agnostic TypeScript; the capture screen wires it to React.

| Path | What |
|---|---|
| `lib/offline/autosave.ts` | The autosave controller: debounce, local copy, compare-and-set save, retries, status, conflicts, flush |
| `lib/offline/drafts.ts` | The local copy record and the reload rule (`reconcile`) |
| `lib/offline/protocol.ts` | The transport interface and its zod wire schemas |
| `lib/offline/supabase-transport.ts` | The compare-and-set save on `inspections`, for a Server Action or the browser client |
| `lib/offline/kv.ts`, `idb.ts`, `db.ts` | A typed key-value wrapper over raw IndexedDB, its in-memory twin, and the app's database (`stericare-offline`) |
| `lib/offline/connectivity.ts` | Online/offline and page-hidden signals |
| `lib/photos/process.ts`, `browser-codec.ts` | Photo processing; the DOM part is `browser-codec.ts` only |
| `lib/photos/exif.ts`, `jpeg.ts`, `sniff.ts`, `sizing.ts` | Pure parts: Exif capture time, JPEG metadata strip, type sniffing, size maths |
| `lib/photos/target.ts` | Photo tags and the `inspection_photos.target` format |
| `lib/photos/paths.ts` | Storage object names (docs/DATABASE.md, "Storage") |
| `lib/photos/files.ts` | Lab reports and certificates |
| `lib/photos/upload-queue.ts` | The background upload queue |
| `lib/photos/supabase-adapters.ts` | Supabase Storage (with upload progress) and the photo and file tables behind the queue |

Import from `@/lib/offline` and `@/lib/photos`.

## The local database

`getOfflineDatabase()` opens IndexedDB `stericare-offline` once per page, with three stores:

| Store | Holds |
|---|---|
| `drafts` | One local copy of inspection data per user and inspection (`draft:<user_id>:<inspection_id>`) |
| `uploads` | Upload queue items: metadata only, small enough to load at start |
| `upload-blobs` | The bytes of queued photos, thumbnails and files (`<id>/object`, `<id>/thumb`), stored as ArrayBuffer and read one item at a time |

Writes resolve when their transaction commits, with strict durability. A connection iPadOS dropped while the page sat in the background is reopened once and the call retried. Records carry a format version (`v: 1`) and are checked with zod when read; a local copy that no longer validates is moved aside (`unreadable:...`), never deleted or applied.

Where IndexedDB is missing or refused (some private windows), the same interface runs in memory and `db.persistent` is false: show "This browser cannot keep unsaved work; keep the page open until it is saved."

Call `requestPersistentStorage()` once after sign-in. Safari may otherwise evict site data after weeks without a visit; a home screen web app is exempt.

## Autosave

```ts
const autosave = createAutosave<InspectionData>({
  inspectionId, userId,
  transport,                       // see "The transport"
  store: db.store("drafts"),
  dataSchema: InspectionDataSchema, // optional: checks a restored local copy
});
const start = await autosave.start({ data: row.data, updatedAt: row.updated_at });
// then, on every edit:
autosave.change(nextData);
```

How it behaves:

1. Every `change()` bumps a local revision and writes the whole data to the local copy at once (one write in flight, the newest state queued behind it). The network comes later: a dropped signal, a crash or a reload loses nothing that was changed.
2. The save waits for 800 ms without changes, and runs at least every 5 s while changes keep coming.
3. One request at a time. Changes made during a request are sent right after it. Before a request leaves, the local copy records the payload's hash, so a save whose answer is lost is recognised later.
4. The save is a compare-and-set on `updated_at` (next section).
5. Failures:

| Failure | Pill | What happens |
|---|---|---|
| network (offline, dropped, timeout), server (5xx) | Offline (will sync) | Retry after 1, 2, 4 ... 30 s (minus up to 20% jitter); at once on the `online` event; every 30 s while the browser says offline |
| unauthorized (session ended) | error: "Sign in again to sync" | Keeps retrying; resumes by itself once the session is back |
| forbidden (submitted, or not this user's), invalid, not_found | error | Waits: the next change or `retryNow()` tries again |
| conflict | error | Waits for the inspector (see below) |
| the local copy cannot be written, and the server is not reachable either | error: storage | Only memory holds the changes: keep the page open |

A request that takes longer than 30 s shows Offline (will sync) and is aborted if the transport accepts the `AbortSignal`. A Server Action cannot be aborted, so the controller waits for it rather than piling up requests.

`getSnapshot()` returns `{ status, pending, lastSavedAt, online, error, conflict, retryAt, localCopy }`, the same object until something changes, for `useSyncExternalStore`. `status` is `saved | saving | offline | error`.

### The transport

```ts
interface AutosaveTransport<T> {
  save(request: { inspectionId; data: T; baseUpdatedAt: string; signal }): Promise<SaveOutcome<T>>;
}
// SaveOutcome: { ok: true, updatedAt } | { ok: false, reason: "conflict", server: { data, updatedAt } }
//            | { ok: false, reason: "network" | "server" | "unauthorized" | "forbidden" | "invalid" | ..., message? }
```

The rule: write `data` only while the row's `updated_at` still equals `baseUpdatedAt`, and answer the new `updated_at`. When nothing was written, answer `conflict` with the row's current `data` and `updated_at` if the inspection is still editable, otherwise `forbidden`. A transport that throws counts as a network failure.

`updated_at` is an opaque version: pass it exactly as Postgres returned it (`2026-10-06T09:14:03.123456+00:00`). Never round-trip it through `Date`, which drops the microseconds and makes every compare-and-set miss.

`saveInspectionData(client, request, { columns })` implements this on `public.inspections`. Two ways to use it:

- **Server Action (recommended)**: validates the data with the module schemas before it reaches the database.

  ```ts
  "use server";
  export async function saveInspection(input: unknown) {
    const auth = await authorizeAction();
    if (!auth.ok) return { ok: false, reason: "unauthorized", message: auth.error } as const;
    const request = saveRequestSchema(InspectionDataSchema).safeParse(input);
    if (!request.success) return { ok: false, reason: "invalid", message: summarizeIssues(request.error) } as const;
    return saveInspectionData(await createClient(), request.data, { columns: mirroredColumns });
  }
  // client: const transport = { save: ({ signal, ...request }) => saveInspection(request) };
  ```

- **Browser client**: `supabaseAutosaveTransport(createClient())`. RLS and the database guards still apply, but the data is not checked against the module schemas on the way in.

`columns` writes columns that mirror the data for lists and search (`po_no`, `product_name`, `lot_numbers`, `inspection_date`, `client_id`, `manufacturer_id`, `remarks`, `result`, `suggested_result`) in the same update. Status changes never go through autosave (AGENTS.md: server actions check the transition).

With `experimental.useOffline` turned on in `next.config.ts`, Next.js holds a Server Action while offline instead of rejecting it. The controller copes: the pill shows Offline (will sync) after 30 s, nothing else is sent meanwhile, and the held request runs when the connection returns.

### Reload and conflicts

`start(server)` settles the local copy against the server's copy (the page's `data` and `updated_at`). The rule (`reconcile` in `drafts.ts`):

| Local copy | Server copy | Result |
|---|---|---|
| none | any | `current`: the server's data |
| everything saved | newer or the same version | `current`: the server's data |
| everything saved | older than the version this device last confirmed (a page from the back/forward cache) | `current`: the local data, which is that newer state |
| unsaved changes | data equal to the local data | `current`: nothing left to save |
| unsaved changes | the version they were made on, or older | `restored`: applied and saved at once |
| unsaved changes | newer, but its data is what this device last confirmed or sent (only other columns moved, or a save landed whose answer was lost) | `restored`, rebased on the new version |
| unsaved changes | newer, with data this device has never seen | `conflict` |

The same rule runs when a save's compare-and-set misses: a server that moved through this device's own lost save, or through other columns (an admin switching a module off), is not a conflict; the controller rebases and sends again (up to 3 times in a row).

**Conflicts** happen only when the same inspection was edited on two devices (or two tabs) and one of them had unsaved changes. Nothing is merged and nothing is lost silently: saving stops, `snapshot.conflict` holds both copies, and the capture screen asks:

- **Keep this iPad's version**: `resolveConflict("local")` saves it over the server's copy.
- **Use the version saved on the other device**: `resolveConflict("server")` drops the local changes and returns the server's data to render.

Edits made while the question is open stay in the local copy and go with "keep this iPad's version".

### Flush before submit

`await autosave.flush()` cancels the debounce and any backoff, saves now and waits for the answer. It returns `{ ok: true }`, or `{ ok: false, reason, message }` on a failure, a conflict or after 20 s: it never waits out an outage. Submit only after `ok`.

## Photos

### Processing

`processPhoto(file, { codec: browserCodec() })`, one file at a time (memory):

1. Reads the first 256 KB: the type from the bytes (iPadOS sometimes gives HEIC an empty type), and for a JPEG the Exif orientation, capture time and stored size.
2. Decodes with `createImageBitmap(file, { imageOrientation: "from-image" })`, falling back to an `<img>`. If the decoder ignored a quarter-turn orientation (it hands back the stored size), the pixels are turned on the canvas.
3. Resizes to 2048 px on the long edge, never upscaling, halving step by step so fine glove texture does not alias. JPEG at 0.8 on a white background.
4. Makes the 400 px thumbnail from the resized photo.
5. Strips metadata from both: re-encoding through a canvas writes no Exif, and `stripJpegMetadata` then removes any APP1 to APP15 segment (Exif with GPS, XMP, IPTC), comments and data after the image, keeping only JFIF and the colour profile. A check after it proves nothing else is left.
6. `takenAt` is Exif DateTimeOriginal with its sub-seconds and UTC offset (else DateTimeDigitized; without an offset, the device's time zone), else the file's `lastModified`.

Result: `{ blob, thumbBlob, width, height, takenAt, flagged, mimeType }`. When the browser cannot decode or convert the file (some HEIC), the original bytes are kept with `flagged: true`, no thumbnail and no size; the bucket accepts JPEG, PNG, WebP, HEIC and HEIF up to 25 MB, and anything else is refused (`unsupported`, `too_large`, `empty`).

### Tags and the target string

A photo taken in a module is tagged with that module and the focus relevant to it: `autoTag({ moduleKey, size, hand, defect, box })`.

| Module | Recorded focus |
|---|---|
| `watertight`, `visual` | size, hand, defect |
| `dispensing_safedon`, `labeling` | size, box, defect |
| `dispensing_packing`, `carton_sampling` | size, box |
| `order_lots`, `sampling_plan`, `dimensions`, `weight`, `force_at_break`, `tensile`, `dye_leak`, custom modules | size |
| `header`, `glove_info`, `packing_config`, `conclusion`, `documents`, `loading` | none |

`inspection_photos.module_key` holds the module; `inspection_photos.target` holds the rest:

```
size:M/hand:R/defect:thin_spot/box:253
```

Keys always in that order, `key:value` joined by `/`, values percent-encoded (a one-off defect label can hold `/` or `:`). Size is a normalised size, hand `R` or `L`, defect a defect code or an unmapped label, box a positive carton number. An empty target is `null`. `buildTarget` and `parseTarget` round-trip; `parseTarget` reads keys in any order and reports what is wrong.

### Files

`prepareFile(file)` checks a lab report or certificate: PDF, JPEG, PNG, WebP or HEIC, up to 50 MB, a printable name. Files are uploaded as they are: a certificate must stay the document the lab issued.

## The upload queue

One queue per page, app-wide (not per inspection), for the signed-in user:

```ts
const queue = createSupabaseUploadQueue({ client: createClient(), env: getSupabasePublicEnv()!, userId, db });
await queue.start();
const id = await queue.enqueuePhoto({ inspectionId, photo, tag: autoTag(focus) });
```

- **Capture never waits.** `enqueuePhoto` and `enqueueFile` write the bytes and the item to IndexedDB and return the future row id. If they cannot be written, the item uploads from memory and `snapshot.localCopy` turns false.
- **In order, one at a time.** A photo uploads its object to `inspection-photos/<inspection_id>/<id>.jpg` (or the original's extension when flagged), then its thumbnail to `<inspection_id>/thumbs/<id>.jpg`, then inserts the `inspection_photos` row. A file uploads to `inspection-files/<inspection_id>/<id>.<ext>` and inserts its `inspection_files` row. Each finished step is recorded, so a reload resumes where it stopped.
- **Idempotent.** The object names and the row id are the item's id. The storage client must count an object that already exists as uploaded and never overwrite it (Supabase answers 409 Duplicate; the adapter sends `x-upsert: false`). The repository must count a duplicate id as written (Postgres 23505). So a retry after a lost answer never creates a second object or row.
- **Retries.** Network, server and expired-session failures retry the whole queue after 2, 4, 8 ... 60 s, and at once on the `online` event. Other failures (not allowed, refused, too large, the bytes gone from this device) stop that item, mark it `failed` with the reason, and the queue moves on; `retryNow(id)` puts it back.
- **Progress.** Uploads go through XMLHttpRequest, not supabase-js, because fetch cannot report upload progress. An upload with no progress for 60 s is abandoned and retried.
- **Survives reloads.** `start()` loads this user's items (another user's wait for them) and removes leftover bytes of interrupted enqueues once they are an hour old.
- **Retag and remove.** `retag(id, { tag, caption })` changes a queued photo; a retag made while its row is being written is followed by an update. `remove(id)` drops an item and deletes any object already uploaded. Both return false once the row exists: then change or delete the row as for any uploaded photo.
- **Tabs.** Each item is uploaded under a `navigator.locks` lock, so two tabs never upload the same item at once; the idempotent steps cover browsers without locks.

`getSnapshot()` returns `{ items, pending, failed, online, retryAt, error, localCopy }`. Each item has `id`, `kind`, `inspectionId`, `moduleKey`, `target`, `caption`, `name`, `flagged`, `takenAt`, `state` (`waiting | uploading | failed`), `progress` (0 to 1) and `error`.

## What the capture screen wires

1. **One database and one queue per page**, in a client provider: `getOfflineDatabase()`, `requestPersistentStorage()`, `createSupabaseUploadQueue(...)`, `queue.start()`. Stop the queue on sign-out.
2. **Autosave per inspection**: create it when the capture screen mounts, `await start()` with the page's `data` and `updated_at`, render the data it returns, call `change()` on every edit with the new data object, `stop()` on unmount.
   - `restored`: a short notice, "Unsaved changes from this iPad were restored."
   - `conflict`: a dialog with the two choices above. `setAside`: "An older unsaved copy could not be read and was kept aside."
3. **Status pill**: `SaveStatus` (`components/qc/save-status.tsx`) from `useSyncExternalStore(autosave.subscribe, autosave.getSnapshot)`: `saved` Saved (with `lastSavedAt`), `saving` Saving, `offline` Offline (will sync), `error` with `error.message` and an action (Try again: `retryNow()`; Sign in; Resolve). See follow-ups: the component has no error state yet.
4. **Queue badge**: `pendingUploads={queue.pendingCount(inspectionId)}` on the pill, from `useSyncExternalStore(queue.subscribe, queue.getSnapshot)`.
5. **Photo buttons**: `ModuleCard`'s `onFiles(files)`: for each file, `processPhoto` then `queue.enqueuePhoto({ inspectionId, photo, tag: autoTag(focus) })`, where `focus` is the module, size tab, hand and the defect or box selected. Lab report inputs (`force_at_break`, `tensile`, `documents`): `prepareFile` then `queue.enqueueFile`.
6. **Photo tiles** for queued items: `PhotoTile` with `state` `pending` (or `flagged`), `progress * 100`, and `src` from `URL.createObjectURL(await queue.preview(id))` (revoke it on unmount). Uploaded photos come from `inspection_photos` with signed URLs.
7. **Submit**: disabled while `!queue.isEmpty(inspectionId)` ("Waiting for 3 photos to upload"), then `await autosave.flush()`; submit only when it returns `ok`.
8. **Sign-out**: warn when `listUnsavedDrafts(db.store("drafts"), userId)` or `queue.pendingCount()` is not empty; that work lives only on this device until it syncs.
9. **Housekeeping**: `pruneSyncedDrafts(db.store("drafts"), Date.now() - 30 days)` now and then (e.g. on the inspections list).

## Known limits

- **Full offline mode is Later** (BUILD_SPEC 12). There is no service worker: a page that is reloaded or opened while offline does not load. Nothing is lost: the local copy and the queue are on the device and sync when the page next loads online. Editing continues offline only on a page that is already open.
- **Capture time of non-JPEG photos.** HEIC, PNG and WebP Exif is not read; their capture time is the file's `lastModified`. iPadOS converts camera photos to JPEG for the web, so this mostly affects files dragged in on a desktop.
- **Flagged originals keep their metadata**, GPS included, until converted: the browser could not decode them, so it could not strip them either. The conversion step (server side, later) must strip it.
- **Files are uploaded as they are**, metadata included. A certificate photographed with the iPad camera is better taken with "Take photo", which processes it.
- **A photo being processed when the page reloads is lost**: it is kept only once enqueued, a fraction of a second later.
- **Processing runs on the main thread** (about 100 to 300 ms a photo on an iPad). It could move to a worker with OffscreenCanvas if bursts of library photos feel slow.
- **Two tabs editing the same inspection** on one device count as two devices: the second to save gets the conflict question.
- **Removing a photo another tab is uploading** may still leave its row; delete it from the gallery.
- `lastSavedAt` and the retry times are device clock times; only `updated_at` comes from the server.
