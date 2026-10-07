# Offline and photos

Client-side persistence for capture on the iPad (BUILD_SPEC 8, "Speed", and 8.1): autosave with a local IndexedDB copy, photo processing in the browser, and the background upload queue. All of it is framework-agnostic TypeScript; the capture screen wires it to React.

| Path | What |
|---|---|
| `lib/offline/autosave.ts` | The autosave controller: debounce, local copy, compare-and-set save, retries, status, conflicts, flush |
| `lib/offline/drafts.ts` | The local copy record, the reload rule (`reconcile`) and the set-aside copies |
| `lib/offline/refused.ts` | The entries number fields refused, kept beside the local copy |
| `lib/offline/lock.ts` | The lock that makes one tab at a time the writer of an inspection's local copy |
| `lib/offline/protocol.ts` | The transport interface and its zod wire schemas |
| `lib/offline/supabase-transport.ts` | The compare-and-set save on `inspections`, for a Server Action (with the secret key, through `save_inspection()`) or an admin's browser client |
| `lib/offline/kv.ts`, `idb.ts`, `db.ts` | A typed key-value wrapper over raw IndexedDB, its in-memory twin, and the app's database (`stericare-offline`) |
| `lib/offline/connectivity.ts` | Online/offline and page-hidden signals |
| `lib/photos/process.ts`, `browser-codec.ts` | Photo processing; the DOM part is `browser-codec.ts` only |
| `lib/photos/exif.ts`, `jpeg.ts`, `originals.ts`, `sniff.ts`, `sizing.ts` | Pure parts: Exif capture time, JPEG structure, metadata removal from JPEG, PNG and WebP, type sniffing, size maths |
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
| `drafts` | One local copy of inspection data per user and inspection (`draft:<user_id>:<inspection_id>`), set-aside copies (`unreadable:<user_id>:<inspection_id>:<ms>`), and the entries number fields refused (`refused:<user_id>:<inspection_id>`, "Refused entries" below) |
| `uploads` | Upload queue items: metadata only, small enough to load at start |
| `upload-blobs` | The bytes of queued photos, thumbnails and files (`<id>/object`, `<id>/thumb`), stored as ArrayBuffer and read one item at a time |

Writes resolve when their transaction commits, with strict durability, and ask for the commit as soon as the write is issued (`IDBTransaction.commit()`), so a write made as a tab closes reaches the database. A connection iPadOS dropped while the page sat in the background is reopened once and the call retried. Records carry a format version (`v: 1`) and are checked with zod when read; a local copy that no longer validates is set aside (`unreadable:...`), never deleted or applied.

Where IndexedDB is missing or refused (some private windows), the same interface runs in memory and `db.persistent` is false. Pass `persistent: db.persistent` to `createAutosave` (the Supabase upload queue reads it itself): `snapshot.localCopy` is then false in both, and the pill shows the storage error instead of "Offline (will sync)" while changes are not on the server, since a reload would lose them.

Call `requestPersistentStorage()` once after sign-in. Safari may otherwise evict site data after weeks without a visit; a home screen web app is exempt.

### Refused entries

What a number field refuses ("2 42": BUILD_SPEC 6.2 rule 1) is never data: the stored value stays `null`. The capture screen still keeps the refused text and its reason, so the red field and its message come back after a size switch, a section switch and a reload (docs/CAPTURE_KIT.md, `RefusedEntryStore`). On the device they sit beside the local copy, never in it: one record per user and inspection in the `drafts` store, `refused:<user_id>:<inspection_id>` (`lib/offline/refused.ts`), with each entry's section, the field's issue path, the text as typed, the reason and the field's name.

- **Written** only by the screen that saves the inspection (editable, autosave running; a read-only screen or a second tab keeps none), one write at a time and in order, so the device ends up with the newest entries. The newest 500 are kept (`MAX_REFUSED_ENTRIES`; more is a paste gone wrong); a record left with none is deleted.
- **Read back** when the screen opens and checked with zod: a record this version cannot read, or one for another user or inspection, reads as none. The entries are a convenience on top of the data, which the local copy and the server hold. Entries refused since the screen opened win over those read back at the same path.
- **Let go** when a number lands at the entry's path, however it got there (typed, pasted, another device's, the version kept after a conflict), and all at once when the inspection is submitted.
- **Housekeeping**: `pruneSyncedDrafts` deletes the records last changed before its cut-off, and any it cannot read, with the synced local copies.

## Autosave

```ts
const autosave = createAutosave<InspectionDraft>({
  inspectionId, userId,
  transport,                         // see "The transport"
  store: db.store("drafts"),
  persistent: db.persistent,
  dataSchema: InspectionDraftSchema, // optional: checks a restored local copy; a draft schema (see below)
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
| other_tab | error | Another tab on this device is the writer (see "One writer per inspection") |
| the local copy cannot be kept (a failed write, or the in-memory fallback), and the server does not have the changes yet | error: storage | Only memory holds the changes: keep the page open |

A request that takes longer than 30 s shows Offline (will sync) and is aborted if the transport accepts the `AbortSignal`. A Server Action cannot be aborted, so the controller waits for it rather than piling up requests.

`getSnapshot()` returns `{ status, pending, lastSavedAt, online, error, conflict, retryAt, localCopy }`, the same object until something changes, for `useSyncExternalStore`. `status` is `saved | saving | offline | error`.

### One writer per inspection

Tabs on one device share one local copy per inspection, so only one controller may write it. `start()` takes a lock named after the user and inspection and holds it until `stop()`: Web Locks (`navigator.locks`), which span the tabs and which the browser releases when a tab is closed or discarded.

- **A second tab** waits up to 3 s for the lock, then `start()` returns `{ kind: "busy", data }`: show the data read-only with `BUSY_MESSAGE` ("open in another tab"). Nothing is saved there; `change()` throws and `flush()` answers `other_tab`. Reload once the other tab is closed.
- **The same tab** (a screen replaced by another on the same inspection, or React mounting twice): the old controller's `stop()` writes the local copy a last time and then lets go, and the new one waits for that. Answers that reach a stopped controller change memory only; the next start recognises a save that landed by its hash.
- **Without Web Locks** (an insecure origin, such as the dev server reached over the LAN) the lock covers one page only. Every local copy then records the controller that wrote it, and a controller that finds another one's copy never writes over it: it shows `SUPERSEDED_MESSAGE`, keeps saving to the server (compare-and-set catches any clash there), refuses `flush()`, and the next start asks the conflict question if the two tabs diverged.

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

**Use a draft schema here, never the submit schema.** An inspection in progress is incomplete, and BUILD_SPEC 6.2 errors block submit, not saving. The schema given to `saveRequestSchema` and as `dataSchema` checks shape and types only (a number is a number, a size is a size), with every module and value optional. With the strict submit schema every in-progress save would be refused as `invalid` (which is not retried) and every restored local copy would be set aside.

`saveInspectionData(client, request, { columns, writer })` implements the rule on `public.inspections`. Two ways to use it:

- **Server Action (the app's way)**: validates the data before it reaches the database, then writes with the secret key through `public.save_inspection()` for the signed-in user (`writer`). The database refuses an inspector's own update (migration `20261007190000`, docs/DATABASE.md "Inspectors write through the app"), so this is the only way an inspector's data is saved. `client` is the user's own session: when nothing was written it reads the row with it, so the answer (`conflict`, `forbidden`, `not_found`) tells the user only what they may see.

  ```ts
  "use server";
  export async function saveInspection(input: unknown) {
    const auth = await authorizeAction();
    if (!auth.ok) return { ok: false, reason: "unauthorized", message: auth.error } as const;
    const request = saveRequestSchema(InspectionDraftSchema).safeParse(input);
    if (!request.success) return { ok: false, reason: "invalid", message: summarizeIssues(request.error) } as const;
    return saveInspectionData(await createClient(), request.data, {
      columns: mirroredColumns,
      writer: serverWriter(auth.user.id), // lib/inspections/writes.ts; null without the secret key
    });
  }
  // client: const transport = { save: ({ signal, ...request }) => saveInspection(request) };
  ```

  Without a writer (a server without `SUPABASE_SECRET_KEY`), or on a project that has not run the migration (PostgREST answers `PGRST202`), it updates with `client`: an admin's session may, an inspector's is refused.

- **Browser client**: `supabaseAutosaveTransport(createClient())`, for an admin's session only; the data is not checked on the way in.

`columns` writes columns that mirror the data for lists and search (`po_no`, `product_name`, `lot_numbers`, `inspection_date`, `remarks`, `result`, `suggested_result`) in the same write; `save_inspection()` refuses any other column (`22023`). The client and manufacturer are chosen when the inspection is created and never change. Status changes never go through autosave (AGENTS.md: server actions check the transition).

A lost session reads as `unauthorized` (sign in again), not `forbidden`: without a session supabase-js sends the publishable key, PostgREST runs the request as anon and answers 401.

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

**Conflicts** happen only when the same inspection was edited on two devices (or, without Web Locks, in two tabs) and one of them had unsaved changes. Nothing is merged and nothing is lost silently: saving stops, `snapshot.conflict` holds both copies, and the capture screen asks:

- **Keep this iPad's version**: `resolveConflict("local")` saves it over the server's copy.
- **Use the version saved on the other device**: `resolveConflict("server")` drops the local changes and returns the server's data to render.

Edits made while the question is open stay in the local copy and go with "keep this iPad's version".

**Set-aside copies** are local copies this version could not read (an app update changed their shape). They are never applied or deleted on their own. `listSetAsideDrafts(store, userId)` lists them; `restoreSetAsideDraft(store, key)` puts one back for the next start to read again (it refuses while the inspection is open in a tab or has unsaved changes of its own); `discardSetAsideDraft(store, key)` deletes one once the inspector agrees.

### Flush before submit

`await autosave.flush()` cancels the debounce and any backoff, saves now and waits for the answer. It returns `{ ok: true }`, or `{ ok: false, reason, message }` on a failure, a conflict, another tab being the writer, or after 20 s: it never waits out an outage. Submit only after `ok`.

## Photos

### Processing

`processPhoto(file, { codec: browserCodec() })`, one file at a time (memory):

1. Reads the first 256 KB: the type from the bytes (iPadOS sometimes gives HEIC an empty type), and for a JPEG the Exif orientation, capture time and stored size.
2. Decodes with `createImageBitmap(file, { imageOrientation: "from-image" })`, falling back to an `<img>`. If the decoder ignored a quarter-turn orientation (it hands back the stored size), the pixels are turned on the canvas.
3. Resizes to 2048 px on the long edge, never upscaling, halving step by step so fine glove texture does not alias. JPEG at 0.8 on a white background.
4. Makes the 400 px thumbnail from the resized photo.
5. Strips metadata from both: re-encoding through a canvas writes no Exif, and `stripJpegMetadata` then removes any APP1 to APP15 segment (Exif with GPS, XMP, IPTC), comments and data after the image, keeping only JFIF and the colour profile. A check after it proves nothing else is left.
6. `takenAt` is Exif DateTimeOriginal with its sub-seconds and UTC offset (else DateTimeDigitized; without an offset, the device's time zone), else the file's `lastModified`.

Result: `{ blob, thumbBlob, width, height, takenAt, flagged, mimeType }`.

When the browser cannot convert the file (some HEIC; or a decode or canvas step that fails, e.g. under memory pressure), the original is kept with `flagged: true`, no thumbnail and no size; the bucket accepts JPEG, PNG, WebP, HEIC and HEIF up to 25 MB, and anything else is refused (`unsupported`, `too_large`, `empty`). The original still loses its metadata where its bytes allow (`cleanOriginal`, no decoding, image data byte for byte): a JPEG keeps only its colour profile and a minimal Exif block holding its orientation, so it still shows upright; a PNG keeps only its image chunks (no eXIf, text or time chunks); a WebP loses its EXIF and XMP chunks. An original whose bytes are cut short is refused (`unreadable`). HEIC and HEIF go up as they are (see "Known limits").

### Tags and the target string

A photo taken in a module is tagged with that module and the focus relevant to it: `autoTag({ moduleKey, size, hand, defect, box, level, item })`.

| Module | Recorded focus |
|---|---|
| `watertight`, `visual` | size, hand, defect |
| `labeling` | size, box, defect, level |
| `dispensing_safedon` | size, box, defect |
| `dispensing_packing`, `carton_sampling` | size, box |
| `order_lots`, `sampling_plan`, `dimensions`, `weight`, `force_at_break`, `tensile`, `dye_leak`, custom modules | size |
| `documents`, `loading` | item |
| `header`, `glove_info`, `packing_config`, `conclusion` | none |

`inspection_photos.module_key` holds the module; `inspection_photos.target` holds the rest:

```
size:M/hand:R/defect:thin_spot/box:253
size:M/defect:lot_no/box:253/level:carton
item:doorsClosed
```

Keys always in the order size, hand, defect, box, level, item (level and item came later, so the targets of older photos read the same), `key:value` joined by `/`, values percent-encoded (a one-off defect label can hold `/` or `:`). Size is a normalised size, hand `R` or `L`, defect a defect code or an unmapped label, box a positive carton number, level labelling's `inner` or `carton`, item the key of an entry of the module's own list (a document, a loading stage). An empty target is `null`. `buildTarget` and `parseTarget` round-trip; `parseTarget` reads keys in any order and reports what is wrong. Tiles and the viewer show level and item in the template's words.

### Files

`prepareFile(file)` checks a lab report or certificate: PDF, JPEG, PNG, WebP or HEIC, up to 50 MB, a printable name. Files are uploaded as they are: a certificate must stay the document the lab issued.

## The upload queue

One queue per page, app-wide (not per inspection), for the signed-in user:

```ts
const queue = createSupabaseUploadQueue({ client: createClient(), env: getSupabasePublicEnv()!, userId, db });
await queue.start();
const id = await queue.enqueuePhoto({ inspectionId, photo, tag: autoTag(focus) });
```

- **Capture never waits.** `enqueuePhoto` and `enqueueFile` write the bytes and the item to IndexedDB and return the future row id. An item counts as pending from the moment it is handed over. If it cannot be written, it uploads from memory and `snapshot.localCopy` turns false.
- **In order, one at a time**, oldest first. A photo uploads its object to `inspection-photos/<inspection_id>/<id>.jpg` (or the original's extension when flagged), then its thumbnail to `<inspection_id>/thumbs/<id>.jpg`, then inserts the `inspection_photos` row. A file uploads to `inspection-files/<inspection_id>/<id>.<ext>` and inserts its `inspection_files` row. Each finished step is recorded, so a reload resumes where it stopped.
- **Idempotent.** The object names and the row id are the item's id. The storage client must count an object that already exists as uploaded and never overwrite it (Supabase answers 409 Duplicate; the adapter sends `x-upsert: false`). The repository must count a duplicate id as written (Postgres 23505). So a retry after a lost answer never creates a second object or row.
- **Retries.** Network, server and expired-session failures retry the whole queue after 2, 4, 8 ... 60 s, and at once on the `online` event. An offline device whose session token is due for refresh reads as no connection, not as an ended session. Other failures (not allowed, refused, too large, the bytes gone from this device) stop that item, mark it `failed` with the reason, and the queue moves on; `retryNow(id)` puts it back.
- **Progress.** Uploads go through XMLHttpRequest, not supabase-js, because fetch cannot report upload progress. An upload with no progress for 60 s is abandoned and retried.
- **Survives reloads.** `start()` loads this user's items (another user's wait for them) and removes leftover bytes of interrupted enqueues once they are an hour old. Until that load has worked, `snapshot.load` is `loading` (then `ready`), and `isEmpty()` is false: nobody knows yet whether photos are waiting. A failed load shows `failed` and is retried with backoff, at once when the connection returns, and on `retryNow()`; meanwhile what the page queues itself still goes up.
- **Retag and remove.** `retag(id, { tag, caption })` changes a queued photo; a retag made while its row is being written is followed by an update. If the server refuses that update for good (the row was deleted, the inspection submitted), the photo still counts as uploaded and the retag is reported in `snapshot.retagFailures` (clear one with `dismissRetagFailure(id)`). `remove(id)` returns true when the item is gone together with any object already uploaded; false when it was not queued, or when its row already exists: the item then leaves the queue, and the caller deletes the row and its objects as for any uploaded photo.
- **Tabs.** Each item is uploaded under a `navigator.locks` lock, so two tabs never upload the same item at once; the idempotent steps cover browsers without locks. `isEmptyNow()` reads the store, so items another tab queued count too.

`getSnapshot()` returns `{ load, items, pending, failed, online, retryAt, error, retagFailures, localCopy }`. Each item has `id`, `kind`, `inspectionId`, `moduleKey`, `target`, `caption`, `name`, `fileKind` (a file's `inspection_files.kind`, null for a photo), `flagged`, `takenAt`, `state` (`waiting | uploading | failed`), `progress` (0 to 1) and `error`.

## What the capture screen wires

1. **One database and one queue per page**, in a client provider: `getOfflineDatabase()`, `requestPersistentStorage()`, `createSupabaseUploadQueue(...)`, `queue.start()`. Stop the queue on sign-out.
2. **Autosave per inspection**: create it when the capture screen mounts (with `persistent: db.persistent`), `await start()` with the page's `data` and `updated_at`, render the data it returns, call `change()` on every edit with the new data object, `stop()` on unmount.
   - `restored`: a short notice, "Unsaved changes from this iPad were restored."
   - `conflict`: a dialog with the two choices above. `setAside`: "An older unsaved copy could not be read and was kept aside."
   - `busy`: the data read-only, with `BUSY_MESSAGE` and a Reload button.
3. **Status pill**: `SaveStatus` (`components/qc/save-status.tsx`) from `useSyncExternalStore(autosave.subscribe, autosave.getSnapshot)`: `saved` Saved (with `lastSavedAt`), `saving` Saving, `offline` Offline (will sync), `error` Not saved; the notice under the header carries `error.message` and an action (Try again: `retryNow()`; Sign in; Reload).
4. **Queue badge**: `PhotoUploadBadge` (`components/capture/photos`) beside the pill: the count from the page's queue, red when an upload stopped, and unknown rather than 0 while the queue is still reading this device.
5. **Photo and file slots**: `PhotoSlot` in every section's footer, tagged with `autoTag(focus)` from the module, the size tab, hand and the defect, box, level or item in focus; `FileSlot` for lab reports and certificates through the modules' file slot (docs/MODULES.md 10.1), with `useInspectionFiles(id)` (uploaded and queued files) as the context's `files`. The page wraps the screen in `PhotoQueueProvider` so the queue starts at once, offline too.
6. **Photo tiles** for queued items: `PhotoTile` with `state` `pending` (or `flagged`), `progress * 100`, and `src` from `URL.createObjectURL(await queue.preview(id))` (revoke it on unmount). Uploaded photos come from `inspection_photos` with signed URLs. Show `snapshot.retagFailures` as a notice ("The new tag of a photo could not be saved") and dismiss it once seen.
7. **Submit**: while photos or files are being prepared or wait in the queue (`usePhotoUploadStatus(id).blocking`), the confirmation says why ("Waiting for 3 photos to upload.") and cannot be given. On submit, check `photoUploadsSettled(id)`, which also counts items queued in another tab, then `await autosave.flush()`; submit only when both say yes. After the redirect to the review, `refreshInspectionMedia(id)` reads the inspection's new rights.
8. **Sign-out**: warn when `listUnsavedDrafts(db.store("drafts"), userId)` or `listSetAsideDrafts(db.store("drafts"), userId)` is not empty, or `await queue.isEmptyNow()` is false; that work lives only on this device until it syncs.
9. **Housekeeping**: `pruneSyncedDrafts(db.store("drafts"), Date.now() - 30 days)` now and then (e.g. on the inspections list): it deletes synced local copies last touched before then, and refused-entry records last changed before then or unreadable. The inspections list calls it once per tab, a few seconds after it shows (`PruneLocalCopies` in `app/(app)/inspections/_components/prune-local-copies.tsx`).
10. **Refused entries**: `useRefusedEntries` (the capture screen's) reads the record back when the screen opens, gives each section its `RefusedEntryStore`, lets an entry go when its value lands in the data, writes every change, and clears them all on submit ("Refused entries" above).
11. **Section forms offline**: each module's form is code the page downloads when its section first opens, so soon after the screen opens (when the browser is idle, within 2 s, or after half a second where there is no idle callback) it downloads the form of every section the template includes (`preloadCaptures`), and again on the `online` event for any a dropped connection stopped. A failed download is forgotten, so the next one asks afresh. On a page already open, a section not opened yet therefore still opens offline. One whose form did not arrive says so calmly, never as a crash: "This section opens once the connection is back. Nothing is lost." (online: "The form for … did not load", with Reload). It asks again by itself on the `online` event, and its Try again really tries again: a new download rendered by a new boundary, since a lazy component whose download failed stays failed.
12. **Leaving**: fields keep a half-typed value until they lose focus, and a tap on the iPad does not move it, so the screen leaves the field first on every way out: a click outside the open section (the shell's links too); Back, through the Navigation API's `navigate` event (`navigationType` `traverse`), which comes before `popstate`: Next.js replaces the screen inside its own `popstate` listener, registered first, and React ignores the blur of a field it is removing (`popstate` stays as the fallback without the Navigation API); `pagehide` and `visibilitychange` to hidden (then `flush()` at once); and `beforeunload`, which asks first only while the change is held in memory alone (`snapshot.pending && !snapshot.localCopy`, read from the controller in the same event). Unmounting flushes for up to `LEAVE_FLUSH_MS`, then stops; what is not on the server by then waits in the local copy. A hidden page writes that copy in the same task (no read of who wrote it last, which a closing tab would never get) while its lock spans every tab (`ReleaseLock.exclusive`, Web Locks), and IndexedDB writes ask for their commit at once.

## Known limits

- **Full offline mode is Later** (BUILD_SPEC 12). There is no service worker: a page that is reloaded or opened while offline does not load. Nothing is lost: the local copy and the queue are on the device and sync when the page next loads online. Editing continues offline only on a page that is already open, in every section of it, also one not opened before ("What the capture screen wires", item 11).
- **Capture time of non-JPEG photos.** HEIC, PNG and WebP Exif is not read; their capture time is the file's `lastModified`. iPadOS converts camera photos to JPEG for the web, so this mostly affects files dragged in on a desktop.
- **HEIC and HEIF originals keep their metadata**, GPS included, until converted: the browser could not decode them, and their metadata cannot be removed without decoding. The conversion step (server side, later) must strip it. Flagged JPEG, PNG and WebP originals are cleaned before upload.
- **Files are uploaded as they are**, metadata included. A certificate photographed with the iPad camera is better taken with "Take photo", which processes it.
- **A photo being processed when the page reloads is lost**: it is kept only once enqueued, a fraction of a second later.
- **Processing runs on the main thread** (about 100 to 300 ms a photo on an iPad). It could move to a worker with OffscreenCanvas if bursts of library photos feel slow.
- **A second tab on the same inspection** is read-only where Web Locks exist (every supported browser over HTTPS). Without them (plain http on the LAN in development) a second tab steps back at its first write instead of overwriting the first tab's copy, and two tabs writing within the same few milliseconds can still slip past that check once.
- **A save in flight when the screen closes** lands on the server, but its answer is not recorded: `listUnsavedDrafts` lists that inspection until it is opened again, which settles it.
- **Removing a photo another tab is uploading** may still leave its row; delete it from the gallery.
- `lastSavedAt` and the retry times are device clock times; only `updated_at` comes from the server.
