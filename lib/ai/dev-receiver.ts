import "server-only";
import { ExportSchema, type InspectionExport } from "@/lib/schemas";
import { readAiConfig, type AiEnv } from "./config";
import { WEBHOOK_HEADERS, verifySignature } from "./webhook";

/* ------------------------------------------------------------------ *
 * Shared front half of the /api/dev mock receivers: they behave like a
 * real receiver should (verify the signature, validate the export), so
 * pointing the webhook URLs at them tests the whole hand-off locally.
 * ------------------------------------------------------------------ */

export type ReceivedExport = { ok: true; exportDoc: InspectionExport } | { ok: false; response: Response };

/** Hidden in production unless ENABLE_MOCK_AI=true (for a preview deployment). */
export function mockReceiversEnabled(env: AiEnv = process.env): boolean {
  return readAiConfig(env).mockEnabled;
}

export async function receiveExport(request: Request, env: AiEnv = process.env): Promise<ReceivedExport> {
  const config = readAiConfig(env);
  if (!config.mockEnabled) return reject(new Response(null, { status: 404 }));
  if (!config.webhookSecret.ok) {
    return reject(Response.json({ error: "misconfigured", message: config.webhookSecret.problem }, { status: 500 }));
  }

  // The signature covers the raw bytes, so read text before parsing.
  const body = await request.text();
  const secret = config.webhookSecret.value;
  if (secret) {
    const check = verifySignature({
      secret,
      body,
      timestamp: request.headers.get(WEBHOOK_HEADERS.timestamp),
      signature: request.headers.get(WEBHOOK_HEADERS.signature),
    });
    if (!check.ok) {
      return reject(Response.json({ error: "invalid_signature", message: check.message }, { status: 401 }));
    }
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return reject(Response.json({ error: "invalid_json", message: "The body is not JSON." }, { status: 400 }));
  }

  const parsed = ExportSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 20).map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }));
    return reject(Response.json({ error: "invalid_export", issues }, { status: 422 }));
  }
  return { ok: true, exportDoc: parsed.data };
}

function reject(response: Response): ReceivedExport {
  return { ok: false, response };
}
