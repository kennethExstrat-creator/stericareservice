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
- **Evidence or a question.** The reviewer must cite the values, carton or box numbers and photo ids behind every finding, and ask the inspector instead of guessing when evidence is missing.
- **Inspection text is data.** Comments, remarks and captions are passed as data; the reviewer is told never to follow instructions found in them.
- **Not connected is a normal state.** With nothing configured the review panel shows "AI second opinion not connected" and the report button shows "AI not connected" with a JSON download.

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
| `AI_REVIEW_EFFORT` | `high` | `low`, `medium`, `high`, `xhigh` or `max`. |
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
| `invalid_response` | The answer was not valid JSON in the expected shape, or was cut off. |
| `timeout` | No answer in time. |
| `error` | HTTP or network error, rate limit, outage, or an export that failed validation. |

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
| `template` | `code`, `version`, `standard`, `productType`, the inspection's `client` and `manufacturer` (`{ id, name }` or null), `reportTitle`, `clientLogoUrl`, `sourceFile`. |
| `modules[]` | Included modules in template order: `key`, `title` and `labels` as on the source form, `data` (entered), `computed` (totals, statistics, code letters, limits), `result` (`status` pass, fail, warn, info or not_done, `summary`, `perSize`), `warnings`, `errors`, inspector `comment`. |
| `excludedModules[]` | Modules switched off for this inspection: `key`, `title`, `reason`. |
| `custom[]` | One-off template fields: `key`, `title`, `after`, `layout`, `fields`, `values`. |
| `photos[]`, `files[]` | Signed URLs valid for 24 hours, with module, target (for example `size:M/defect:thin_spot/box:253`), caption, `includeInReport` and `flagged` (an unconverted original, often HEIC). |
| `conclusion` | `suggestedResult` (computed), `finalResult` (the inspector's), `remark`, `inspector`, `date`. |

`data`, `computed` and custom `values` are plain JSON whose shape per module is defined in Phase 2. A filled example: `lib/ai/__fixtures__/std-eg-export.ts`.

### Response

Answer with a 2xx status and JSON within the time limit: 90 seconds for a review, 180 seconds for a report. Redirects are not followed and bodies over 1 MB are rejected. The app does not retry.

Report (`AiReportResponseSchema`):

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
- `module` is a module key or custom module key; `size` is a size or `null`; `unit` may be omitted or `null`; `photos` are photo ids from the export.

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

What `lib/ai/providers/claude.ts` sends, in one non-streaming request:

- **System prompt** (`lib/ai/prompts/review-system.ts`): a senior glove QC auditor (ISO 2859-1 with AQL, EN 455, ASTM D6319, this app's modules) giving a second opinion. It lists what to check (weight deviation, duplicate or out-of-range carton numbers, boxes not in the carton list, critical defects, results that do not follow from the data, sizes not ordered, totals, dates), how to calibrate confidence and how to grade severity. It is byte-stable and sent with `cache_control`, so repeat reviews within 5 minutes read it from the cache.
- **User turn**: the export inside `<inspection_export>` tags, then up to `AI_REVIEW_MAX_PHOTOS` photos as image URLs (include-in-report photos first; flagged photos are skipped because the API cannot read them), each labelled with its photo id. Signed URLs are removed from the JSON text, and so is the inspector's email.
- **Depth**: thinking is always on for Claude Opus 5.5; `output_config.effort` is set from `AI_REVIEW_EFFORT` (the API default would be `medium`). No `temperature`, `thinking` or prefill: this model rejects them. `max_tokens` is 16,000 for thinking plus the answer, which suits `high`; `xhigh` and `max` think longer and can run out of room, which comes back as a cut-off answer.
- **Structured output**: `output_config.format` carries a JSON schema generated from `AiReviewSchema`. The SDK's `zodOutputFormat` is not used: in SDK 0.131 its transform turns `enum` into description text (so `pass | fail | hold` would not be enforced) and its parser throws on a cut-off answer before `stop_reason` can be read. `lib/ai/providers/claude-format.ts` keeps the enums and returns `null` instead of throwing; `stop_reason` is checked first and the answer is validated again with zod.
- **Refusal fallbacks are enabled**: `fallbacks: "default"` with the beta header `server-side-fallback-2026-07-01`. If Claude Opus 5.5's safety classifiers decline the request, the API reruns it on the fallback model Anthropic recommends for that category, in the same call. The `model` stored with the review is the one that wrote it. Only when the whole chain declines does the outcome become `refused`.
- **Limits**: 300 seconds per attempt and one retry (the SDK retries rate limits, overloads and dropped connections and honours `retry-after`). If a request with photos is rejected as invalid (for example an expired photo link), it is sent once more without photos.

Other models: the request shape targets Claude Opus 5.x. Effort, structured outputs and `fallbacks` are not supported by every model; an unsupported combination comes back as `error` with the API's explanation.

### Cost

Claude Opus 5.5 costs 4 USD per million input tokens and 20 USD per million output tokens; cache reads cost 0.20 USD per million. A review reads the system prompt (about 2,300 tokens), the export (about 4,000 tokens for one size, more for several) and the photos (up to about 4,800 tokens each at 2,048 px), then writes thinking plus the answer. As a rough guide, expect about 0.15 to 0.50 USD per review at `high` effort with six photos. Each successful Claude outcome carries `usage` (input, output and cache tokens): log it, or give `ai_reviews` a column for it, to track real cost. Lower `AI_REVIEW_EFFORT` or `AI_REVIEW_MAX_PHOTOS` to spend less.

## Data handling

- Inspection data goes to whichever provider is configured: the full export (with 24-hour signed photo and file links) to a webhook, or the export without links plus the selected photos to Anthropic. Exports carry client, manufacturer, PO, lot and carton details and inspector names.
- Before using Claude in production, check Anthropic's commercial terms and data-retention options (zero data retention is arranged per organization) against SteriCare's agreements with its clients. For a webhook, the same questions apply to whoever runs it.
- Keep `ANTHROPIC_API_KEY` and `AI_WEBHOOK_SECRET` server-side only: never prefix them with `NEXT_PUBLIC_`. `lib/ai` imports `server-only`, so the build fails if client code imports it.
- Test fixtures replace client, manufacturer, PO, lot and carton identifiers with placeholders (BUILD_SPEC rule 7).

## What Phase 3 adds

The slot is built; Phase 3 wires it into the app:

- `GET /api/inspections/[id]/export` builds the export (owner or admin only) and validates it with `ExportSchema`, with 24-hour signed URLs.
- "Send to AI report" (admin, submitted or approved inspections) calls `requestAiReport` and stores `report_url`; when not connected it offers the JSON download.
- The second opinion runs on submit (a template setting) or from an admin button: an `ai_reviews` row per inspection version (`inspection_updated_at`), `pending` then `done` or `failed`, with model, suggested result, confidence, summary, findings and questions. A Claude review can take minutes, so run it in the background (for example `after()`) and raise the route's `maxDuration`.
- The review panel: the system's computed results, the inspector's result and comments, and the AI's opinion side by side, with agree, disagree (note required) or fixed per finding stored in `ai_review_actions` and the audit log.
