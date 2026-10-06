import { mockReceiversEnabled, receiveExport } from "@/lib/ai/dev-receiver";

// Mock AI report service for local runs and tests: set
// AI_REPORT_WEBHOOK_URL=http://localhost:3000/api/dev/mock-ai-report.
// POST answers like a report service, with a reportUrl pointing at GET,
// which serves a placeholder. 404 in production unless ENABLE_MOCK_AI=true.

export async function POST(request: Request): Promise<Response> {
  const received = await receiveExport(request);
  if (!received.ok) return received.response;
  const reportUrl = new URL("/api/dev/mock-ai-report", request.url);
  reportUrl.searchParams.set("ref", received.exportDoc.refNo);
  return Response.json({ reportUrl: reportUrl.toString() });
}

export async function GET(request: Request): Promise<Response> {
  // Reading the URL first keeps this handler request-time under any caching mode.
  const ref = new URL(request.url).searchParams.get("ref") ?? "unknown";
  if (!mockReceiversEnabled()) return new Response(null, { status: 404 });
  // Plain text, so the echoed ref cannot inject markup.
  return new Response(
    `Mock AI report for inspection ${ref}.\n\nThis placeholder stands in for the report service. ` +
      "Set AI_REPORT_WEBHOOK_URL to the real service to get the finished report.\n",
    { headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } },
  );
}
