# AI in the SteriCare inspection app

How the app hands inspections to AI models (BUILD_SPEC section 9), how to connect a model, and the contract for anyone building a service on the other end. Code: `lib/ai/` (server only) and `lib/schemas/`.

## What AI does here

| Hand-off | What happens | Output |
|---|---|---|
| **AI report** (9.1) | The admin sends a submitted or approved inspection. The app POSTs the export JSON to a report service. | The URL of the finished client report, stored in `inspections.report_url`. |
| **AI second opinion** (9.2) | An AI reviews the app's computed results, the inspector's data, comments and remark, and some photos. | A review: suggested result, confidence, summary, findings with evidence, questions for the inspector. |

The app does not lay out reports and does not decide results. Both hand-offs start from one document: the inspection export, validated by `ExportSchema` (`lib/schemas/export.ts`).

## Guardrails

- **Never automatic.** The AI never changes an inspection, a module result or the final result. Its review is stored next to the inspection and shown beside it.
- **The admin decides.** For each finding the admin records agree, disagree (a note is required) or fixed (`AiReviewActionSchema`).
- **Evidence or a question.** The reviewer must cite the values, carton or box numbers and photo ids behind every finding, and ask the inspector instead of guessing when evidence is missing. A review that names a module or photo the inspection does not have is rejected, from any provider.
- **Inspection text is data.** Comments, remarks and captions are passed as data; the reviewer is told never to follow instructions found in them.
- **Not connected is a normal state.** With nothing configured the review panel shows "AI Second Opinion Not Connected" and the report button shows "AI Not Connected" with a JSON download.

## Choosing a provider

Set these in `.env.local` (Vercel: Project Settings > Environment Variables). Empty values count as unset. Configuration is read on every request, so a bad value turns that hand-off "misconfigured" instead of crashing the app. The status names the variable to fix and what it accepts, but never repeats the value, so a key or a URL with a token pasted on the wrong line does not reach the screen.

| Variable | Default | Purpose |
|---|---|---|
| `AI_REVIEW_PROVIDER` | `auto` | `auto`, `webhook`, `claude`, `mock` or `off`. |
| `AI_REVIEW_WEBHOOK_URL` | | Second-opinion service. |
| `AI_REPORT_WEBHOOK_URL` | | Report service. |
| `AI_WEBHOOK_SECRET` | | Signs both webhooks. At least 16 characters: `openssl rand -hex 32`. |
| `ANTHROPIC_API_KEY` | | Runs the second opinion directly on Claude. Server only. |
| `AI_REVIEW_MODEL` | `claude-opus-5-5` | Claude model for the second opinion: a Claude API model id, starting with `claude-`. |
| `AI_REVIEW_EFFORT` | `high` | `low`, `medium`, `high`, `xhigh` or `max`. `xhigh` and `max` get 64,000 output tokens and up to 30 minutes per review. |
| `AI_REVIEW_MAX_PHOTOS` | `6` | Photos attached to a Claude review, 0 to 20. |
| `ENABLE_MOCK_AI` | | `true` allows the mock reviewer and mock receivers in a production build (for a preview deployment). |

How the second opinion resolves:

| `AI_REVIEW_PROVIDER` | Result |
|---|---|
| `auto` (or unset) | The webhook if `AI_REVIEW_WEBHOOK_URL` is set, else Claude if `ANTHROPIC_API_KEY` is set, else not connected. |
| `webhook` | The webhook; misconfigured without `AI_REVIEW_WEBHOOK_URL`. |
| `claude` | Claude; misconfigured without `ANTHROPIC_API_KEY`. |
| `mock` | The deterministic mock reviewer (test data). Blocked in production unless `ENABLE_MOCK_AI=true`. |
| `off` | Not connected, whatever else is set. |

The report is a webhook only: connected when `AI_REPORT_WEBHOOK_URL` is set. Webhook URLs must be `https://` in production (`http://localhost` is allowed) and must not contain a user name or password.

Server code calls `requestAiReview(exportDoc)` and `requestAiReport(exportDoc)` from `@/lib/ai`. Neither throws: they return `{ ok: true, ... }` or `{ ok: false, reason, message }`, where the message is safe to show an admin. `getAiStatus()` returns what the UI may show (labels, provider, model) with no URLs, keys or secrets.

| `reason` | Meaning |
|---|---|
| `not_connected` | Nothing configured for this hand-off. |
| `misconfigured` | A variable is invalid, or Claude rejected the API key or model. The message names the variable. |
| `refused` | Claude declined, and no fallback model completed the review. |
| `invalid_response` | The answer was not valid JSON in the expected shape, was cut off or broke off, or named modules or photos that are not in the inspection. |
| `timeout` | No complete answer within the time limit. |
| `error` | HTTP or network error, rate limit, outage, or an export that failed validation. |

## AI Settings

Admin > Steri-AI Settings (`/admin/ai`, `app/(app)/admin/ai/`; Kenneth, 13 October 2026: "separate into general, AI cost and inspection AI setting, switching by toggle") holds the Anthropic API key, the Claude model for each job and the second opinion's effort and photos, so they can be changed without touching the server's variables, and shows what Steri-AI costs. A pill switch under the title picks one of three views, each its own address, so a reload, a bookmark or Back opens the same one (`_components/view-state.ts`): General (`/admin/ai`), Inspection Settings (`?view=inspection`) and Steri-AI Cost (`?view=cost`, with `&period=7|30|90|all` and `&currency=myr`; unknown values fall back to the defaults). Each view loads only its own data and saves only its own settings, through its own Server Action (`actions.ts`: an active admin only, checked with zod):

- **General**: the API key, write-only (`saveApiKeyAction`, `removeAiKeyAction`). It is encrypted before it is stored (`ai_settings`, migration `20261009120000`; AES-256-GCM keyed from `SUPABASE_SECRET_KEY`, `lib/ai/secret-box.ts`), and the screen only ever shows its last four characters. An Admin API key (`sk-ant-admin…`) is refused: it cannot call Claude. Rotating the Supabase secret key makes a saved key unreadable: the screen says so and asks for it again. Remove Saved Key goes back to `ANTHROPIC_API_KEY`, if set. **Test Connection** (`testAiConnectionAction`) asks Anthropic whether the typed key, else the key in use, may use the models in use (`GET /v1/models/{id}`, no tokens billed, nothing recorded).
- **Inspection Settings** (`saveInspectionSettingsAction`): Reading Documents' model (New Inspection, Source Documents and Auto-Sort; default `claude-opus-5-5`) and Second Opinion's model (default `claude-opus-5-5`), from a list of current Claude models or any other Claude model id; the second opinion's **Effort** (Low, Medium, High) and **Photos per Review** (0 to 20), the two settings that most change what a review costs. A model the price list has no price for says so, with a link to Steri-AI Cost. When `AI_REVIEW_PROVIDER` sends reviews to the webhook or the mock reviewer, or switches them off, one line under Second Opinion says these are not used. The shortforms moved to Admin > Defects > Shortforms (below).
- **Steri-AI Cost**: below.

The saved values lie over the variables (`loadAiEnv` in `lib/ai/settings.ts`): a saved key wins over `ANTHROPIC_API_KEY`, the saved models over `AI_REVIEW_MODEL` and `AI_DOCUMENT_MODEL`, and the saved effort and photos (`ai_settings.review_effort` and `review_max_photos`, migration `20261013120000`) over `AI_REVIEW_EFFORT` and `AI_REVIEW_MAX_PHOTOS`. The status cards, the review panel and the second opinion all read through it. `xhigh`, `max` and the provider stay variables: while `AI_REVIEW_EFFORT` is `xhigh` or `max` and no effort is saved, the picker shows it as Extra High (Server Setting) or Max (Server Setting), and saving keeps it.

## Reading order documents

On `/inspections/new` the **Source Documents** card is the capture screen's first step on the form, with its title, Files / Media switch and rows (`source-documents-panel.tsx` and `use-held-sources.ts` in `app/(app)/inspections/new/_components/`, the rules in `_lib/sources.ts`), so every paper and photo can come in while the inspection is created (Kenneth, 12 October 2026). Nothing is stored before Create, since there is no inspection yet: the files stay in the browser, and Cancel or leaving the page drops them.

- **Files**: PDFs and photos of the PO, packing list, inspection request or inspection form, several at once (photos are made 2048 px JPEG in the browser, `lib/photos/readable.ts`, as on the capture screen; up to the file bucket's 50 MB). Each is a row: the name, what Steri-AI did with it beside it (Waiting for Steri-AI, Steri-AI is reading, **Steri-AI Read**, **Not Read** with the reason and Read Again, or Read after Create), then Preview (the file in a dialog on the page) and Remove.
- Steri-AI reads them **one at a time, only while the form still lacks its client, manufacturer, product type or product name** (the product name only where the template's header has one). The Server Action `readDocument` (`app/(app)/inspections/new/actions.ts`) sends the file to Claude (`lib/ai/document-reader.ts`) with the client and manufacturer lists the user can pick from; Claude reads the file itself (no separate OCR) and answers in a JSON schema (`DocumentReadingSchema`, `lib/schemas/document-fill.ts`), at low effort so the inspector waits seconds, not minutes. A file over 4 MB (a request's limit) or of a type the reader does not take is not read here. Files not read here are read after Create, on Source Documents.
- `checkReading` (`lib/inspections/document-fill.ts`) keeps only ids from the lists, real dates and known sizes, and adds up the lines of one size.
- A reading fills the client, manufacturer, product type and product name **only where nothing is chosen or typed yet: the first answer wins** (`formFill`). A company that is not in the lists is named so an admin can add it. Under the files the card lists, short, what it filled and what goes in with Create; Claude's note on anything unclear is the file's badge's tooltip.
- The PO, product code, factory glove code, inspection, manufacturing and expiry dates, and per size the cases and lot numbers, of every file read are merged, the first answer winning field by field and size by size (`mergeFills`), and go in with Create (`documentFill`, `applyDocumentFill`): only fields the template shows, only sizes it offers, never over a value already set (for example by Start From Previous).
- **Media**: the visit's photos and videos (videos up to 50 MB), as rows with a thumbnail, Preview and Remove, under a drop area like Auto-Sort's. Auto-Sort files them once the inspection exists.
- **On Create** `createInspection` answers the new inspection's id instead of redirecting; the form then hands every file over for it, in the background: the documents to the page's upload queue as Source Documents (`module_key` `source_documents`), the photos and videos to an Auto-Sort run (`autoSort`, below). The queue and the run belong to the page, not to the screen, so they carry on while the form opens the inspection on Source Documents: there the uploads show, each document is read in full (one read on the form too, which only took the order details), and Media shows the sort's progress. No file is posted with the form, so a Server Action's 5 MB limit never applies to them. The audit log records `filled_from_document` with the names of the files read, the fields filled and who uploaded them.
- Everything stays editable: the AI suggests, the inspector checks.


## Source Documents

The first step of every inspection, before its modules (`SOURCE_DOCUMENTS_KEY`, `lib/inspections/source-documents.ts`; the capture screen opens on it unless `?module=` names another page). The inspector uploads every file about the inspection: the handwritten inspection form, the PO, packing lists, lab reports, photos of labels and cartons. They are `inspection_files` rows with `module_key` `source_documents`, uploaded through the page's queue like any file; photos are made 2048 px JPEG first. Files added on New Inspection arrive here the same way after Create, and are read in full like any other (New Inspection only took the order details from them).

- Each uploaded file is read once, one at a time (`use-source-documents.ts`, Server Action `readSourceFile` in `app/(app)/inspections/[id]/source-actions.ts`, `lib/ai/source-reader.ts`). Claude gets the file, the inspection's included modules with each module's data JSON Schema, settings and sizes (cached for the next file), and the data entered so far, and answers values for the empty fields it can read, as JSON (no structured output: per-size records do not fit a strict schema).
- The capture screen fills the answer in through its own autosave (`applyProposals`): only modules the inspection includes, never the conclusion (the inspector's result, remark and signature), only fields still empty, only values each module's schema accepts, size by size. Totals and results are still calculated by the app.
- The reading is kept on the file row (`ai_status` `read` or `failed`, `ai_read_at`, `ai_summary`; migration `20261009150000`), so a file is read once whichever device uploaded it. Each file row is one line: the name with a **Steri-AI Verified** badge beside it (its tooltip: what the document is), then Preview (a dialog on the page: PDFs in the browser's viewer, photos as images), Download and Delete as icons; the step's tick turns green once every file is verified. A file the AI could not read shows **Not Read** (the reason as its tooltip) and Read Again. Not connected or a model error leaves the file unread, to be read once the AI works.
- The audit log records `source_document_read` (file, modules proposed, where the file was linked, who, model). Inspection data goes to Anthropic as in "Data handling" below.

**Files / Media** (Kenneth, 11 October 2026): a toggle in the card's header. Files holds the forms and PO papers the AI reads. Media holds the inspection's photos and videos, taken on the inspector's phone during the visit: photos go through the photo queue as before (2048 px JPEG), untagged (`module_key` null; tag them in the gallery when the report needs a photo in a section), and the tab lists every photo of the inspection; videos (MP4, an iPhone's QuickTime movie, WebM, up to the file bucket's 50 MB) are `inspection_files` with `module_key` `source_media` (migration `20261011180000`), previewed in the same dialog. The AI reads Media only to file it (Auto-Sort, below). The steps no longer have a photo box under them; the inspector comment stays.

## Auto-Sort (Media)

Media's photos and videos sit in four categories (`MEDIA_CATEGORIES`, Kenneth, 11 October 2026): Warehouse, Product and Package Samples, Inspection Proof (the inspection under way, as proof it was done) and Product Defects, with Other for the rest. Auto-Sort (Kenneth, 12 October 2026) files them for the inspector: they drop every photo and video from the visit at once (on Media, or on New Inspection's card, whose run starts once the inspection exists), each uploads into Other, the screen makes a small JPEG preview (at most 1024 px on its long edge; a frame for a video) and sends up to 12 at a time to the Server Action `sortMediaWithAi` (`app/(app)/inspections/[id]/media-actions.ts`). Claude (`lib/ai/media-sorter.ts`: the Reading Documents model, low effort, one request per batch) sees each preview after a label ("Item 2 (video frame)") and answers a category for each, or unsure.

- What Claude is sure of is filed at once, with the same write as a move by hand: the photo's or video's `module_key` takes the category's key, and a photo's old target goes (categories record no size, hand or defect, as in the tag picker). **Unsure items stay in Other** for the inspector to file by hand.
- Any item can then be dragged to another category or back to Other (Server Action `moveMedia`; Other is no tag for a photo, `source_media` for a video).
- **Filing only.** Auto-Sort sees the previews and nothing else: it never reads the inspection's data, never fills a field and never changes a result.
- Who may: the rule for retagging a photo, the database's `can_edit_inspection` (the inspector while it is a draft or reopened, admins until it is approved), checked before Claude is asked; each item must be one of the inspection's photos, or a video on its Media (never a Source Document or a step's lab report). The previews are not stored.
- The audit log records `media_moved` for each move by hand (the photo or file id, the `from` and `to` tags, a photo's old target, `by`) and one `media_sorted` per batch (`photos` and `videos` sent, how many went into each category, how many were `unsure`, `not_saved` when a write failed, the `model`, `by`). The service role writes both, as it does `source_document_read`, so the history names the system and `by` the user.
- Not connected, nothing moves and the screen says "Auto-Sort needs Steri-AI, which is not connected yet. Ask an admin to add the Anthropic API key under Admin > Steri-AI Settings." A failed request comes back in words the inspector can act on (busy, too slow, could not reach the AI).
- The previews go to Anthropic as in "Data handling" below.

**Lab reports and certificates** (Kenneth, 12 October 2026: "Lab report should be automatically detected by AI and fill in"): files are uploaded here only, and Steri-AI links them; a step has no picker. Each reading is told where this inspection files a document itself, in the template's words (`attachTargets` in `lib/ai/source-reader.ts`: tensile's and force at break's lab report by the module's title, each row on the documents checklist by its label), and answers `attachTo` when the file itself is a lab report with tensile or force at break results (`tensile`, `force_at_break`) or a documents row's certificate or report (`documents.<item>`). It reads the report's results into those steps too, as any document's values (`LAB_REPORT_GUIDE` in `lib/ai/reading-guide.ts`: tensile's averages per size, before ageing; force at break's reading of each glove, in order). `readSourceFile` then keeps the file's id there (`labReport`, the row's `file`) through the same fill-empty path (`linkSourceFile`: included modules and rows on the checklist, only where nothing is linked yet, never over an earlier link nor an id the AI wrote itself), sets the file's `kind` (`lab_report` or `certificate`) and records `linked` in the audit details; the capture screen fills the link in with the other proposals, so the step shows it without a reload.

- **Tensile and force at break** show the lab report in one line (`source-file-link.tsx` inside the kit's `AttachmentStatus`): the file's name, a sparkle when Steri-AI linked a Source Document, Preview and Unlink (which never deletes the file; Steri-AI can then link the next lab report it reads). Nothing linked: "Steri-AI is reading the Source Documents…" while one of them is unread or being read (`useSourceDocuments` shares its readings with the steps), else "No lab report detected by Steri-AI.". A lab report uploaded on a step before 12 October still counts (calc is unchanged) and shows the same, without Unlink; a kept file that is gone keeps calc's warning, with Unlink.
- **Documents**: a row whose document Steri-AI linked shows the file on its attachment line (name, Preview, Unlink); while no row has one, one line under the list says "No documents detected by Steri-AI." (or that Steri-AI is still reading).
- Read-only, the same without Unlink. If Steri-AI misses a lab report, nothing can be linked by hand: the inspector uploads a clearer copy.

## The paper form and shortforms

**One PO per inspection** (Kenneth, 11 October 2026, after speaking to the inspector): each inspection is one purchase order, and the forms of other POs are uploaded to their own inspections. A stack of several POs' forms uploaded by mistake is read only for this inspection's PO (or the first form while it has none); the others are named and left out.

On the factory floor inspectors write on paper (photos and phones are restricted on some visits), then upload the forms with the manufacturer's PO, product and batch papers to Source Documents. Both readers (Source Documents and New Inspection) get `PAPER_FORM_GUIDE` (`lib/ai/reading-guide.ts`): the form's parts (Purchase Order / Shipment Information, PO Info, Sampling Plan, Watertight Inspection, Visual Inspection, Dispensing Result), tally marks (each stroke is one), "2+1" (add them), "x/500" (defects in 500 gloves; trust the rows over a total that disagrees), "50x10" (50 inner boxes of 10 gloves), dates (inspection date day/month/year, mfg and expiry often year/month/day), and that forms of different POs or lots are never merged.

**Every inspector writes defects their own way.** The AI works out what each entry means from its wording, where it is on the form (watertight: where the hole is; visual: what the defect is; the Major or Minor part: its class) and glove QC knowledge, then records it in the standard list: the template's own defect or hole location code when one means the same thing, otherwise `unmapped` with a short standard English name (the defect library's name when it has one), never the raw shortform, so an admin maps it under Admin > Defects. It also answers `mappings` (written → recorded as), kept with the file ("Read as: SKV → Skin Visual (new label); BF → Between Fingers (Crotch)") so an admin can check the reading.

**Shortforms** (Admin > Defects > Shortforms, `/admin/defects/shortforms`; Kenneth, 13 October 2026: "Both are about defect and why arent they in the same section or module?"): what inspectors write on paper, a reading aid for Steri-AI and not a standard. Admin > Defects is the defect library (the Codes tab) and the Shortforms tab links what is written to it. Each entry is a **defect**, linked to the library codes it counts under (picked from the active codes, never typed: one, or up to three when its meaning names a case each, IB `bead_defective` when major and `bead_poor` when minor; none yet while the library has no such code, shown as No Code Yet), or an **other term** with no code (a test such as WTT or FAB, a product word such as PF or EG, a factory code such as TG32, initials). Each has a meaning and whether an inspector confirmed it; an unconfirmed meaning is given to Steri-AI as a guess. The Codes tab lists each code's shortforms, and a code a shortform links is not deleted. Steri-AI gets the list with every document (`glossaryText` in `lib/ai/reading-guide.ts`): each defect with its codes and their library names (Source Documents pass the active library; the order-document reader gives the codes without names), then the other terms; it counts the defect under that code when the template lists it, else under `unmapped` with the code's library name. Stored in `ai_settings.glossary` (migration `20261011120000`, no new one: `{ short, meaning, confirmed, kind, codes }`; `DEFAULT_GLOSSARY` in `lib/schemas/ai-settings.ts` until an admin saves the list). A list saved before 13 October 2026 has no kind or codes: each entry takes them, at read time, from the starting list's entry with the same shortform (ignoring case), keeping its own meaning and confirmation, and one the starting list lacks becomes a defect with no code yet (`upgradeGlossary`); the first save on the tab writes the whole list in the new shape. Saves go through `saveShortform` and `deleteShortform` (`app/(app)/admin/defects/actions.ts`): an active admin only, checked with zod, a newly linked code must be an active defect code, one entry at a time against the entry as the panel opened it, and the whole list saved with who saved it and when. The starting list is one inspector's confirmed list (11 October 2026): BF Between Finger, FT Finger Tip, SF Side Finger, P Palm, CF Cuff Area, MH Multiple Holes, GB Glove Burst, IB Improper Beading, DT Dirt, TA Thin Area, TS Thin Spot, SKV Skin Visual, L Lump, FM Flow Mark; plus guesses marked unconfirmed (FS, probably SF; Stain; TG32, a manufacturer; BK, initials).

## Webhook contract

For services that write the report or the second opinion (n8n, Make, a Python or Node service, an agent platform).

### Request

`POST <AI_REVIEW_WEBHOOK_URL or AI_REPORT_WEBHOOK_URL>`

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-SteriCare-Event` | `ai.review.requested` or `ai.report.requested` |
| `X-SteriCare-Delivery` | A UUID, unique per request. Use it to log and de-duplicate. |
| `X-SteriCare-Timestamp` | Unix time in seconds. |
| `X-SteriCare-Signature` | `sha256=` + hex HMAC-SHA256 of `<timestamp>.<raw body>` keyed with `AI_WEBHOOK_SECRET`. Sent only when the secret is set. |

The body is the inspection export, schema version `"1"` (`ExportSchema`):

| Field | Content |
|---|---|
| `schemaVersion`, `refNo`, `status` | `"1"`, `INS-2026-0001`, `draft`, `submitted`, `approved` or `reopened`. |
| `timestamps` | `createdAt`, `updatedAt` (identifies the inspection version), `submittedAt`, `approvedAt`, `exportedAt`. ISO 8601 with offset. |
| `inspector` | `id`, `name`, `email`. |
| `template` | `code`, `version`, `standard`, `productType`, the inspection's `client` and `manufacturer` (`{ id, name }` or null), `reportTitle`, `clientLogoUrl`, `sourceFile`. `sizes`: every size the template lists, in its order and whatever was ordered (the report's fixed size rows), as `{ value, label }`, the label being the size's "Shown as" or else the size. `unit`: `pcs` or `pairs`, how the gloves are counted. `pageHeader`: the header on the report's pages after the first, or null when the template sets none. Exports made before these three were added leave them out. |
| `modules[]` | Included modules in template order: `key`, `title` and `labels` in the template's wording (the source form's words in Title Case, see The report's wording below; a count in a title is this inspection's), `config` (the module's settings for this inspection: specs, decimals, AQLs, the inner unit, columns switched on or off), `data` (entered), `computed` (totals, statistics, code letters, limits), `result` (`status` pass, fail, warn, info or not_done, `summary`, `perSize`), `warnings`, `errors`, inspector `comment`. |
| `excludedModules[]` | Modules switched off for this inspection: `key`, `title`, `reason`. |
| `custom[]` | One-off template fields: `key`, `title`, `after`, `layout`, `fields`, `values`. A custom `key` is never a library module key: every key in `lib/schemas/module-result.ts` is reserved, optional modules included, so a key names one section wherever it appears. |
| `photos[]`, `files[]` | Signed URLs valid for 24 hours, with `moduleKey`, target (for example `size:M/defect:thin_spot/box:253`), caption, `includeInReport` and `flagged` (an unconverted original, often HEIC). `moduleKey` is `null` for a photo or file not tagged with a module (for example a desktop upload not yet retagged): the database columns `inspection_photos.module_key` and `inspection_files.module_key` allow it, so the export does too. An empty or blank tag is read as `null`, so receivers only ever see `null` for untagged. |
| `conclusion` | `suggestedResult` (computed), `finalResult` (the inspector's), `remark`, `inspector`, `date`. |

`config`, `data`, `computed` and custom `values` are plain JSON in each module's own shape (`modules/<key>/schema.ts` and `calc.ts`; field by field in `docs/DATA_DICTIONARY.md`). A file a module relies on is referenced in its `data` by the `files[]` id: `labReport` in `force_at_break` and `tensile`, `items.<item>.file` in `documents`. A filled example, built through the real modules: `lib/ai/__fixtures__/std-eg-export.ts`.

### The report's wording

The report prints the template's words, and the export carries them: each module's `title` and `labels`, the rows its `config` lists (defects, hole locations, labelling checks, the Safedon dispensing defects) and `template.reportTitle`. A count in a title is the inspection's own, so the report prints the gloves actually weighed: weight's "Average of 13 Gloves per Size" comes as "Average of 12 Gloves per Size" when the sampling plan has 12 gloves for dimension (its `computed.n` per size), and as "8 or 13" when sizes differ. Kenneth, 8 October 2026: the app and the report write labels in Title Case (`docs/DESIGN.md`, Capitalisation), so the export reads "Packing Configuration", "# Glove per Inner Box", "Total # Carton", "Thin Area Between Fingers (Crotch)". A report service prints them as they come: it does not recase them, and it does not go back to the paper forms' wording ("Packing configuration"), which stays in the coverage matrix of `docs/DATA_DICTIONARY.md` only. Sentences stay sentences (the stickiness legend, the Safedon definitions), and the conclusion words keep the reports' capitals (PASSED, FAILED, HOLD). The mock receivers below take the same export: the mock review names each module by its `title`, so a local run reads the same wording.

### Response

Answer with a 2xx status and JSON within the time limit: 90 seconds for a review, 180 seconds for a report. Redirects are not followed and bodies over 1 MB are rejected. The app does not retry.

Report (`AiReportResponseSchema`, `lib/schemas/ai-report.ts`):

```json
{ "reportUrl": "https://reports.example.com/INS-2026-0001.pdf" }
```

Second opinion (`AiReviewSchema`, `lib/schemas/ai-review.ts`):

```json
{
  "suggestedResult": "hold",
  "confidence": 0.7,
  "summary": "The data supports a pass except for the weight. Confirm the indicative weight before approving.",
  "findings": [
    {
      "id": "F1",
      "module": "weight",
      "size": "M",
      "severity": "major",
      "message": "Average weight is 17% below the indicative weight. Check the spec sheet and the scale.",
      "evidence": {
        "values": [{ "label": "Average weight, size M", "value": "2.9", "unit": "g" }],
        "boxes": [],
        "photos": ["00000000-0000-4000-8000-000000000303"]
      }
    }
  ],
  "questions": [{ "id": "Q1", "module": "conclusion", "question": "Why is the remark empty?" }]
}
```

- `suggestedResult`: `pass`, `fail` or `hold`. `confidence`: 0 to 1. `severity`: `critical`, `major`, `minor` or `info`.
- Finding and question ids must be unique within a review (`F1`, `F2` ... and `Q1`, `Q2` ...): admin decisions are stored against them.
- `module` (of a finding, and of a question unless `null`) must be the key of a module in the export: in `modules`, `excludedModules` or `custom`, or `header` or `conclusion`. Every id in `photos` must be a photo id from the export. The review panel links to both, so a review that names anything else is rejected as `invalid_response`, with a message naming each unknown reference (`findUnknownReferences` in `lib/schemas/ai-review.ts`).
- `size` is a size or `null`; `unit` may be omitted or `null`. Sizes and `boxes` are not checked against the export: flagging a size that was not ordered or a box missing from the carton list is part of the review.

### Verifying the signature

Verify the raw body before parsing it, reject timestamps more than 5 minutes from your clock, and compare in constant time. A Node or Next.js receiver:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SECONDS = 5 * 60;

export function isSignedBySteriCare(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(signature);
  if (!match) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(match[1], "hex"));
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const secret = process.env.AI_WEBHOOK_SECRET ?? "";
  const valid = isSignedBySteriCare(
    rawBody,
    request.headers.get("X-SteriCare-Timestamp"),
    request.headers.get("X-SteriCare-Signature"),
    secret,
  );
  if (!secret || !valid) return new Response("Invalid signature", { status: 401 });

  const exportDoc = JSON.parse(rawBody);
  // ... write the report or the review from exportDoc ...
  return Response.json({ reportUrl: "https://reports.example.com/INS-2026-0001.pdf" });
}
```

Test vector: secret `whsec_test_0123456789abcdef`, timestamp `1720000000`, body `{"refNo":"INS-2024-0001"}` gives `sha256=5157e5af21b53cbd68da3b5566c0cf2eb0c3214c8a86d3493feb6821b1fc2335`. Check from a shell:

```sh
printf '%s' '1720000000.{"refNo":"INS-2024-0001"}' | openssl dgst -sha256 -hmac 'whsec_test_0123456789abcdef'
```

The app's own helper is `verifySignature()` in `lib/ai/webhook.ts`.

### Trying it locally

Two mock receivers behave like real ones (they check the signature when `AI_WEBHOOK_SECRET` is set and validate the export). They return 404 in production unless `ENABLE_MOCK_AI=true`. The app calls them server to server without a session, so the auth proxy must let `/api/dev/` through; the routes protect themselves.

```sh
AI_REVIEW_WEBHOOK_URL=http://localhost:3000/api/dev/mock-ai-review
AI_REPORT_WEBHOOK_URL=http://localhost:3000/api/dev/mock-ai-report
AI_WEBHOOK_SECRET=<openssl rand -hex 32>
```

The review receiver answers with the mock review: a finding for each module that failed, warned or is not done, `fail` if any module failed, `hold` if any warned or is not done, and a question when the remark is empty. The report receiver answers with a link to a plain-text placeholder. `AI_REVIEW_PROVIDER=mock` gives the same mock review without HTTP.

## The second opinion on Claude

Set `ANTHROPIC_API_KEY` (console.anthropic.com > API Keys) and leave `AI_REVIEW_WEBHOOK_URL` empty. The model is `claude-opus-5-5` unless `AI_REVIEW_MODEL` says otherwise.

What `lib/ai/providers/claude.ts` sends, in one streamed request (`client.beta.messages.stream`):

- **System prompt** (`lib/ai/prompts/review-system.ts`): a senior glove QC auditor (ISO 2859-1 with AQL, EN 455, ASTM D6319, this app's modules) giving a second opinion. It lists what to check (weight deviation, duplicate or out-of-range carton numbers, boxes not in the carton list, critical defects, results that do not follow from the data, sizes not ordered, totals, dates), how to calibrate confidence and how to grade severity. It is byte-stable and sent with `cache_control`, so repeat reviews within 5 minutes read it from the cache.
- **User turn**: the export inside `<inspection_export>` tags, then up to `AI_REVIEW_MAX_PHOTOS` photos as image URLs (include-in-report photos first; flagged photos are skipped because the API cannot read them), each labelled with its photo id. Signed URLs are removed from the JSON text, and so is the inspector's email.
- **Depth**: thinking is always on for Claude Opus 5.5; `output_config.effort` is set from `AI_REVIEW_EFFORT` (the API default would be `medium`). No `temperature`, `thinking` or prefill: this model rejects them. `max_tokens` covers thinking plus the answer: 16,000 at `low`, `medium` and `high`, and 64,000 at `xhigh` and `max`, which think longer (Anthropic advises at least 64K at those levels). An answer that still runs out of room comes back as a cut-off answer.
- **Structured output**: `output_config.format` carries a JSON schema generated from `AiReviewSchema`. Structured outputs are generally available, so they need no beta header. The SDK's `zodOutputFormat` is not used: in SDK 0.131 its transform turns `enum` into description text (so `pass | fail | hold` would not be enforced), and its parser throws on a cut-off answer, which fails the stream before `stop_reason` can be read. `lib/ai/providers/claude-format.ts` keeps the enums and leaves parsing to the provider, which checks `stop_reason` first and then validates the last text block with zod. When a fallback model takes over mid-stream, the declined model's partial text comes before the fallback model's answer.
- **Refusal fallbacks are enabled**: `fallbacks: "default"` with the beta header `server-side-fallback-2026-07-01`. If Claude Opus 5.5's safety classifiers decline the request, the API reruns it on the fallback model Anthropic recommends for that category, in the same call. The `model` stored with the review is the one that wrote it. Only when the whole chain declines does the outcome become `refused`.
- **Streaming and the time limit**: the answer streams in as Claude writes it. A non-streaming call that thinks for minutes risks HTTP timeouts, and anything above about 16,000 output tokens has to stream. One time limit covers the whole review, retries included: 10 minutes at `low` to `high`, and 30 minutes at `xhigh` and `max` (the SDK's own estimate for that many output tokens). `requestAiReview(exportDoc, { timeoutMs })` overrides it.
- **Retries**: the SDK's own retries are off, because the SDK would rerun a timed-out review from the start and it would be billed twice. The provider retries only failures that come back before Claude writes anything: rate limits (429), overloads (529) and other 5xx answers, and connections that never opened. It retries at most twice, honouring `retry-after` (otherwise it waits 1 second, then 2). A wait of more than a minute, or one that would pass the time limit, is reported instead. A timeout, or an error after the stream opened, is never retried; the admin can run the review again. If a request with photos is rejected as invalid (for example an expired photo link), it is sent once more without photos.

Other models: the request shape targets Claude Opus 5.x. Effort, structured outputs and `fallbacks` are not supported by every model; an unsupported combination comes back as `error` with the API's explanation.

## Steri-AI Cost

Steri-AI Settings > Steri-AI Cost (`/admin/ai?view=cost`) shows what Steri-AI costs: an estimate from the tokens Anthropic reports for each call, priced with the list in force when the call was made. Anthropic's bill is final.

**What is recorded.** Every Claude call the app makes is one `ai_usage` row (migration `20261013120000`, docs/DATABASE.md), written with the secret key by `recordAiUsage` (`lib/ai/usage.ts`) after the response is sent, so recording never slows or fails the user's action. The readers report through `createMessage` and the second opinion from `reviewWithClaude` (`onCall`):

| Job (`feature`) | One row per | Inspection |
|---|---|---|
| New Inspection (`new_inspection_read`) | document read | none: it does not exist before Create |
| Source Documents (`source_document_read`) | file read and filled in | the inspection |
| Auto-Sort (`media_sort`) | batch of up to 12 previews (`item_count`) | the inspection |
| Second Opinion (`second_opinion`) | review, from the admin's button or on submit | the inspection |

Each row keeps the model that answered, who asked (the admin, or the user who submitted), the tokens (uncached input, output with its thinking, 5-minute and 1-hour cache writes, cache reads), how long it took, the outcome (`ok`; `refused` and `cut_off`, billed but not usable; `failed`, no answer, with the error type) and `cost_usd`. A server-side fallback bills each attempt at its own model, and the top-level usage covers only the last one, so the tokens come from `usage.iterations`, summed. A failed call costs 0: no answer came back, so there are no tokens to price (refused and cut-off answers are billed, and counted). Deleting the inspection or the person clears the link and keeps the row. Not recorded: Test Connection (no tokens), the AI report and review webhooks and the mock reviewer (no Claude call from the app), and requests that never reach Claude (no key, a file too large or of a type the readers do not take). Counting starts with migration `20261013120000`: earlier calls kept no tokens, so they are not estimated.

**The formula** (`costOfCall`): for each attempt, uncached input, 5-minute cache writes, 1-hour cache writes, cache reads and output, each times its rate for that model, per million tokens. A dated snapshot (`claude-opus-5-5-20260922`) takes its model's prices. Claude Haiku 5.5's higher rates apply to a whole request whose prompt (input, cache writes and reads) is over 100,000 tokens, output included. Then x1.1 when `usage.inference_geo` is `us` (US-only inference, also from a workspace default) and x0.5 for the Batch API (not used). Six decimals. A call on a model without a price stores no cost and counts as No Price, for example a fallback model when Opus declines; adding its price prices later calls only. Prompt caching counts at its own rates: the first Source Document of an inspection writes the cached modules block, and files read within 5 minutes read it at 0.20 USD per million tokens on Opus 5.5 instead of 4; the review's system prompt is cached the same way. Example: Opus 5.5 with 20,000 input, 3,000 cache-read and 4,000 output tokens is 0.08 + 0.0006 + 0.08 = 0.1606 USD.

**The prices** (`DEFAULT_AI_PRICES`, `lib/schemas/ai-prices.ts`), USD per million tokens, read on 12 October 2026 from https://platform.claude.com/docs/en/about-claude/pricing and checked against each model's page and https://claude.com/pricing (standard inference):

| Model | Input | Output | Cache Write (5 Min) | Cache Write (1 Hour) | Cache Read |
|---|---|---|---|---|---|
| Claude Opus 5.5 | 4 | 20 | 5 | 8 | 0.20 |
| Claude Sonnet 5.5 | 2 | 10 | 2.50 | 4 | 0.10 |
| Claude Haiku 5.5 | 0.10 | 0.50 | 0.125 | 0.20 | 0.01 |
| Claude Haiku 5.5, prompt over 100,000 tokens | 0.50 | 2.50 | 0.625 | 1 | 0.05 |

Admins edit the list in the view (`ai_settings.prices`, null for the app's list; `saveAiPrices`): the day they checked it, an added model, and an optional MYR rate with its date to show costs in ringgit (no live rate, no tax). The app's three models always stay in it (`withDefaultModels`). A change prices later calls only: each row keeps the cost it was recorded with. There is no pricing API, so the list is checked by hand.

**The view's numbers** (`loadAiCostReport`, `lib/ai/cost-report.ts`, read with the admin's own client: the functions `ai_usage_summary`, `ai_usage_trend` and `ai_usage_by_inspection` give anyone else no rows): the last 7, 30 or 90 Malaysia days or All Time; cost per job and per model, per document, per photo or video sorted and per review; per inspection, where New Inspection reads and drafts deleted since are counted apart; and a monthly rate once 7 days are counted. Days before the first recorded call are not drawn as zero cost.

**On screen**, top to bottom (`_components/cost-*.tsx`): the Period (Last 7, 30 or 90 Days, All Time) and, once the price list has a MYR rate, the Currency, with the one sentence on what the numbers are ("Estimated from token use; Anthropic's bill is final.", and when counting started); three tiles (Total Cost with its calls, failures and calls with no price; Per Inspection; Per Month at this rate); Cost per Day (by month for All Time over 92 days), a CSS column chart whose readout names the highest day, or the day a pointer, a tap or the arrow keys pick, with that day's jobs; Cost by Job, with what one document, photo or video, or review costs, and Cost by Model, with a line where calls had no price; Cost by Inspection, the 50 costliest, each linked to its review or capture screen, with New Inspection reads and deleted drafts under it; and the Price List. Filters replace the address, so Back leaves the view rather than each filter. Before the first call: No Steri-AI Costs Yet, the price list still below.

**Limits.** An estimate, not the invoice. A request that timed out or broke off mid-stream, and the SDK's own retry of one (the readers allow one), may be billed and not seen, so the estimate can run low; a fallback's declined attempt is counted with the tokens Anthropic reports, although a decline before any output is billed only in some categories. Days are Malaysia days and Anthropic's Console counts UTC days, so one day can differ. Matching the invoice automatically needs the Usage & Cost Admin API: an organisation account and an Admin API key, which can manage members and keys and so never goes in the app. That is not built: compare with Console > Usage and Cost by hand.

**A second opinion's size.** A review reads the system prompt (about 2,300 tokens), the export (about 4,000 tokens for one size, more for several) and the photos (up to about 4,800 tokens each at 2,048 px), then writes thinking plus the answer: about 0.15 to 0.50 USD at `high` effort with six photos on Opus 5.5. At `xhigh` and `max` the output budget is 64,000 tokens, up to about 1.30 USD on output alone. Lower the effort or the photos per review to spend less.

## Data handling

- Inspection data goes to whichever provider is configured: the full export (with 24-hour signed photo and file links) to a webhook, or the export without links plus the selected photos to Anthropic. Exports carry client, manufacturer, PO, lot and carton details and inspector names.
- Reading documents (New Inspection, Source Documents) sends the file to Anthropic, and Auto-Sort sends small previews of Media's photos and video frames; labels and cartons in them can show the same details.
- Before using Claude in production, check Anthropic's commercial terms and data-retention options (zero data retention is arranged per organization) against SteriCare's agreements with its clients. For a webhook, the same questions apply to whoever runs it.
- Keep `ANTHROPIC_API_KEY` and `AI_WEBHOOK_SECRET` server-side only: never prefix them with `NEXT_PUBLIC_`. `lib/ai` imports `server-only`, so the build fails if client code imports it.
- Test fixtures replace client, manufacturer, PO, lot and carton identifiers with placeholders (BUILD_SPEC rule 7).

## In the app (Phase 3)

The hand-offs are wired into the app; this is where each part lives.

- **The export**: `GET /api/inspections/[id]/export` (`app/api/inspections/[id]/export/route.ts`) answers the inspection's inspector and admins (401 signed out, 403 inactive, 404 for anyone else) with `buildInspectionExport` (`lib/export`): the inspection run through the module framework as capture and submit run it, its files passed to the context (`InspectionMeta.files`, so a deleted lab report reads as missing), validated by `ExportSchema`. Photos, files, the client logo and the template's source file get 24-hour signed URLs. Lab reports and certificates are referenced by id in module data (`force_at_break` and `tensile` `labReport`, `documents` `items.<item>.file`), so a receiver matches them with `files[].id`. Each module also carries its `config` as the template version sets it.
- **The review screen** (`/inspections/[id]/review`) shows the AI panel between the result and the module results: `LoadedAiReviewPanel` from `components/ai`, loaded beside the review by `loadAiPanel` (`lib/inspections/ai`). Elsewhere, `<AiReviewPanel inspectionId={id} />` loads itself. It puts the system's computed results, the inspector's result, remark and comments, and the AI's opinion side by side, per module; admins request second opinions, record agree, disagree (a note is required) or fixed per finding (`ai_review_actions` and the audit log), and send to the AI report; the inspector reads the opinions. Not connected, the panel says so, and tells admins whether `AI_REVIEW_PROVIDER` is `off` or nothing is set up. When the inspection's results cannot be worked out (its template version or saved data cannot be read), `loadAiPanel` answers `unreadable` and the panel says quietly that the second opinion and the AI report are not available, since the review's checks already give the cause; only a read that failed shows as an error.
- **Server Actions** (`lib/inspections/ai/actions.ts`): `requestAiSecondOpinion`, `recordAiFindingDecision`, `sendToAiReport` (stores `report_url`; when not connected it offers the JSON download) and `getAiReviewProgress` for the panel's poller.
- **The second opinion** runs from the admin button or on submit. `startAiReview` stores a `pending` `ai_reviews` row, then writes the opinion in `after()`, `done` or `failed`. `scheduleAiReviewOnSubmit(inspectionId)` is the submit trigger: the submit action calls it after the status change when the template's `ai.reviewOnSubmit` is on; it runs as the service role, never throws, and does nothing when no reviewer is connected.
- **Time limit**: a Claude review can take 10 minutes (30 at `xhigh` and `max`), and it runs inside the Server Action's `after()`, so the page that runs the action sets `export const maxDuration` above that. The review page sets 800 seconds, the most Vercel allows on Pro; the capture page needs the same for the submit trigger. Keep `AI_REVIEW_EFFORT` at `high` or below there, or pass a shorter `timeoutMs`.
- **Versions**: a review is kept per version of the inspection's content. `ai_reviews.inspection_fingerprint` (migration `20261007113245`) is a SHA-256 of the data, module overrides, final result, remark, template version and files (`inspectionFingerprint` in `lib/inspections/ai/fingerprint.ts`); approving, reopening or storing the report link changes none of them, so the opinion stays current. Photos are left out: they decide no result. A review stored without a fingerprint compares by `inspection_updated_at`, the save it reviewed. One review per version may be pending at a time (`ai_reviews_one_pending_per_content`, and `ai_reviews_one_pending_per_version` for reviews without a fingerprint): a second request answers "A second opinion of this version is being written."
