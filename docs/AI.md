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

Admin > AI Settings (`/admin/ai`, `app/(app)/admin/ai/`) holds the Anthropic API key and the Claude model for each AI job, so they can be changed without touching the server's variables:

- **API key**: write-only. It is encrypted before it is stored (`ai_settings`, migration `20261009120000`; AES-256-GCM keyed from `SUPABASE_SECRET_KEY`, `lib/ai/secret-box.ts`), and the screen only ever shows its last four characters. Rotating the Supabase secret key makes a saved key unreadable: the screen says so and asks for it again. Remove Saved Key goes back to `ANTHROPIC_API_KEY`, if set.
- **Models**: Reading Documents (default `claude-opus-5-5`) and Second Opinion (default `claude-opus-5-5`), from a list of current Claude models or any other Claude model id.
- **Test Connection** asks Anthropic whether the key works and may use both models (`GET /v1/models/{id}`, no tokens billed); it tests a key typed in the form before it is saved.

The saved values lie over the variables (`loadAiEnv` in `lib/ai/settings.ts`): a saved key wins over `ANTHROPIC_API_KEY`, and the saved models over `AI_REVIEW_MODEL` and `AI_DOCUMENT_MODEL`. The status cards, the review panel and the second opinion all read through it. The review's effort, photos and provider stay variables.

## Reading order documents

On `/inspections/new`, **Fill From a Document** replaces the template card until the client, manufacturer and product type are picked. The inspector uploads a PO, packing list, inspection request or a photo of one, in any layout (PDF up to 4 MB; photos are made 2048 px JPEG in the browser). The Server Action `readDocument` (`app/(app)/inspections/new/actions.ts`) sends it to Claude (`lib/ai/document-reader.ts`) with the client and manufacturer lists the user can pick from; Claude reads the file itself (no separate OCR) and answers in a JSON schema (`DocumentReadingSchema`, `lib/schemas/document-fill.ts`), at low effort so the inspector waits seconds, not minutes.

- `checkReading` (`lib/inspections/document-fill.ts`) keeps only ids from the lists, real dates and known sizes, and adds up the lines of one size.
- The client, manufacturer, product type and product name fill the form at once; a company that is not in the lists is named so an admin can add it.
- The PO, product code, factory glove code, manufacturing and expiry dates, and per size the cases and lot numbers, go in with Create (`applyDocumentFill`): only fields the template shows, only sizes it offers, never over a value already set (for example by Start From Previous).
- The file is not stored. The new inspection's audit log records `filled_from_document` with the file name, the fields filled and who uploaded it.
- Everything stays editable: the AI suggests, the inspector checks.


## Source Documents

The first step of every inspection, before its modules (`SOURCE_DOCUMENTS_KEY`, `lib/inspections/source-documents.ts`; the capture screen opens on it unless `?module=` names another page). The inspector uploads every file about the inspection: the handwritten inspection form, the PO, packing lists, lab reports, photos of labels and cartons. They are `inspection_files` rows with `module_key` `source_documents`, uploaded through the page's queue like any file; photos are made 2048 px JPEG first. The order document read on New Inspection is kept here too, already read.

- Each uploaded file is read once, one at a time (`use-source-documents.ts`, Server Action `readSourceFile` in `app/(app)/inspections/[id]/source-actions.ts`, `lib/ai/source-reader.ts`). Claude gets the file, the inspection's included modules with each module's data JSON Schema, settings and sizes (cached for the next file), and the data entered so far, and answers values for the empty fields it can read, as JSON (no structured output: per-size records do not fit a strict schema).
- The capture screen fills the answer in through its own autosave (`applyProposals`): only modules the inspection includes, never the conclusion (the inspector's result, remark and signature), only fields still empty, only values each module's schema accepts, size by size. Totals and results are still calculated by the app.
- The reading is kept on the file row (`ai_status` `read` or `failed`, `ai_read_at`, `ai_summary`; migration `20261009150000`), so a file is read once whichever device uploaded it. A read file shows **AI Verified** with a green tick and what it filled; the step's tick turns green once every file is verified. A file the AI could not read says why and offers Read Again. Not connected or a model error leaves the file unread, to be read once the AI works.
- The audit log records `source_document_read` (file, modules proposed, who, model). Inspection data goes to Anthropic as in "Data handling" below.

## PO parts

One inspection can cover several purchase orders (Kenneth, 11 October 2026): one factory visit, a paper form per PO and lot, each sampled and tested on its own. Each PO is a **part**, an `inspections` row of its own (its PO, lots, sizes, sampling, tests, AQL and conclusion), linked by `inspections.group_id` (docs/DATABASE.md, "PO parts"). The first part stands for the inspection: its reference number is the inspection's.

- **Capture screen** (`parts-bar.tsx`, `capture-header.tsx`): the title is the inspection's reference for every part, with "PO 2680277 · Part 2 of 3" and the part's own reference under it; a bar of PO pills switches parts (saving first, like Photos and Review) and **Add PO** (`addInspectionPart`, `createPart`) adds an empty part for the same client, manufacturer, template and inspector.
- **Source Documents** are shared: stored on the first part, shown and uploaded from every part. One reading fills every part: the AI answers per part (`parts`) and for POs in the documents that have no part yet (`newParts`, at most 10 per reading), matching forms by PO number or lot, never merging forms of different POs. The open part is filled through its autosave; the other parts are filled on the server through the capture save path while draft or reopened (a part changed meanwhile is skipped and named); new POs become parts. The file keeps a per-part report ("Filled PO 2680277: 18 fields; added PO 2680280 with 20 fields"). A file being read is claimed through `ai_read_at` for 15 minutes so two screens do not read it twice.
- **Submit, Approve and Reopen** move every part together (`part-moves.ts`): Submit checks every part as today's submit checks one, and submits none while any PO fails (naming it); Approve refuses while a part is draft or reopened; Reopen skips parts already back with the inspector. Writes go part by part, so a retry finishes a move another device interrupted. On submit, the AI second opinion starts per part when the template asks for it.
- **Inspections list**: one row per inspection, the first part's, with "+2 POs" listing each PO with its product, status and result; search by PO, lot or carton finds the inspection through any part (computed columns `parts_*`, migration `20261011150400`); the status shows the least advanced part and "Mixed" when they differ, the result the worst. Delete is hidden for an inspection of several POs.
- **One report for all POs**: the export carries every part (`parts`, above); Send to AI Report waits until every part is submitted or approved.

## The paper form and shortforms

On the factory floor inspectors write on paper (photos and phones are restricted on some visits), then upload the forms with the manufacturer's PO, product and batch papers to Source Documents. Both readers (Source Documents and New Inspection) get `PAPER_FORM_GUIDE` (`lib/ai/reading-guide.ts`): the form's parts (Purchase Order / Shipment Information, PO Info, Sampling Plan, Watertight Inspection, Visual Inspection, Dispensing Result), tally marks (each stroke is one), "2+1" (add them), "x/500" (defects in 500 gloves; trust the rows over a total that disagrees), "50x10" (50 inner boxes of 10 gloves), dates (inspection date day/month/year, mfg and expiry often year/month/day), and that forms of different POs or lots are never merged.

**Every inspector writes defects their own way.** The AI works out what each entry means from its wording, where it is on the form (watertight: where the hole is; visual: what the defect is; the Major or Minor part: its class) and glove QC knowledge, then records it in the standard list: the template's own defect or hole location code when one means the same thing, otherwise `unmapped` with a short standard English name (the defect library's name when it has one), never the raw shortform, so an admin maps it under Admin > Defects. It also answers `mappings` (written → recorded as), kept with the file ("Read as: SKV → Skin Visual (new label); BF → Between Fingers (Crotch)") so an admin can check the reading.

**Shortforms** (Admin > AI Settings): examples of what inspectors write, a help for the AI and not a standard (`ai_settings.glossary`, migration `20261011120000`; `DEFAULT_GLOSSARY` in `lib/schemas/ai-settings.ts` until an admin saves the list). It starts with one inspector's confirmed list (11 October 2026): BF Between Finger, FT Finger Tip, SF Side Finger, P Palm, CF Cuff Area, MH Multiple Holes, GB Glove Burst, IB Improper Beading, DT Dirt, TA Thin Area, TS Thin Spot, SKV Skin Visual, L Lump, FM Flow Mark; plus guesses marked unconfirmed (FS, probably SF; Stain; TG32, a manufacturer; BK, initials). An unconfirmed meaning is given to the AI as a guess.

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
| `modules[]` | Included modules in template order: `key`, `title` and `labels` in the template's wording (the source form's words in Title Case, see The report's wording below), `config` (the module's settings for this inspection: specs, decimals, AQLs, the inner unit, columns switched on or off), `data` (entered), `computed` (totals, statistics, code letters, limits), `result` (`status` pass, fail, warn, info or not_done, `summary`, `perSize`), `warnings`, `errors`, inspector `comment`. |
| `excludedModules[]` | Modules switched off for this inspection: `key`, `title`, `reason`. |
| `custom[]` | One-off template fields: `key`, `title`, `after`, `layout`, `fields`, `values`. A custom `key` is never a library module key: every key in `lib/schemas/module-result.ts` is reserved, optional modules included, so a key names one section wherever it appears. |
| `photos[]`, `files[]` | Signed URLs valid for 24 hours, with `moduleKey`, target (for example `size:M/defect:thin_spot/box:253`), caption, `includeInReport` and `flagged` (an unconverted original, often HEIC). `moduleKey` is `null` for a photo or file not tagged with a module (for example a desktop upload not yet retagged): the database columns `inspection_photos.module_key` and `inspection_files.module_key` allow it, so the export does too. An empty or blank tag is read as `null`, so receivers only ever see `null` for untagged. |
| `conclusion` | `suggestedResult` (computed), `finalResult` (the inspector's), `remark`, `inspector`, `date`. |
| `parts` | Only for an inspection of several POs (PO parts, below): each other PO's export in this same shape, in part order, without a `parts` of its own. The top-level fields are the first PO's; a report reads every entry for that PO's own header, order, results and conclusion. A one-PO inspection's export has no `parts`. Exporting any part gives the inspection's export. The AI second opinion still reviews one part at a time, without `parts`. |

`config`, `data`, `computed` and custom `values` are plain JSON in each module's own shape (`modules/<key>/schema.ts` and `calc.ts`; field by field in `docs/DATA_DICTIONARY.md`). A file a module relies on is referenced in its `data` by the `files[]` id: `labReport` in `force_at_break` and `tensile`, `items.<item>.file` in `documents`. A filled example, built through the real modules: `lib/ai/__fixtures__/std-eg-export.ts`.

### The report's wording

The report prints the template's words, and the export carries them: each module's `title` and `labels`, the rows its `config` lists (defects, hole locations, labelling checks, the Safedon dispensing defects) and `template.reportTitle`. Kenneth, 8 October 2026: the app and the report write labels in Title Case (`docs/DESIGN.md`, Capitalisation), so the export reads "Packing Configuration", "# Glove per Inner Box", "Total # Carton", "Thin Area Between Fingers (Crotch)". A report service prints them as they come: it does not recase them, and it does not go back to the paper forms' wording ("Packing configuration"), which stays in the coverage matrix of `docs/DATA_DICTIONARY.md` only. Sentences stay sentences (the stickiness legend, the Safedon definitions), and the conclusion words keep the reports' capitals (PASSED, FAILED, HOLD). The mock receivers below take the same export: the mock review names each module by its `title`, so a local run reads the same wording.

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

### Cost

Claude Opus 5.5 costs 4 USD per million input tokens and 20 USD per million output tokens; cache reads cost 0.20 USD per million. A review reads the system prompt (about 2,300 tokens), the export (about 4,000 tokens for one size, more for several) and the photos (up to about 4,800 tokens each at 2,048 px), then writes thinking plus the answer. As a rough guide, expect about 0.15 to 0.50 USD per review at `high` effort with six photos. At `xhigh` and `max` the output budget is 64,000 tokens, so one review can spend up to about 1.30 USD on output alone. Each successful Claude outcome carries `usage` (input, output and cache tokens): log it, or give `ai_reviews` a column for it, to track real cost. Lower `AI_REVIEW_EFFORT` or `AI_REVIEW_MAX_PHOTOS` to spend less.

## Data handling

- Inspection data goes to whichever provider is configured: the full export (with 24-hour signed photo and file links) to a webhook, or the export without links plus the selected photos to Anthropic. Exports carry client, manufacturer, PO, lot and carton details and inspector names.
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
