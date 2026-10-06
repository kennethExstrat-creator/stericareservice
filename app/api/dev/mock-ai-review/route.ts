import { receiveExport } from "@/lib/ai/dev-receiver";
import { mockReview } from "@/lib/ai/providers/mock";

// Mock AI second-opinion service for local runs and tests: set
// AI_REVIEW_WEBHOOK_URL=http://localhost:3000/api/dev/mock-ai-review.
// 404 in production unless ENABLE_MOCK_AI=true.
export async function POST(request: Request): Promise<Response> {
  const received = await receiveExport(request);
  if (!received.ok) return received.response;
  return Response.json(mockReview(received.exportDoc));
}
