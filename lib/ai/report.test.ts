import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as mockReportReceiver } from "@/app/api/dev/mock-ai-report/route";
import { makeStdEgExport } from "./__fixtures__/std-eg-export";
import { requestAiReport } from "./report";
import { WEBHOOK_HEADERS } from "./webhook";

const SECRET = "whsec_test_0123456789abcdef";
const REPORT_ENV = { AI_REPORT_WEBHOOK_URL: "https://reports.example.com/hook", AI_WEBHOOK_SECRET: SECRET };

// requestAiReport gets its env explicitly; the mock receiver reads process.env, so pin it.
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("ENABLE_MOCK_AI", "");
  vi.stubEnv("AI_WEBHOOK_SECRET", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function answering(response: () => Response) {
  return vi.fn<typeof fetch>(async () => response());
}

describe("requestAiReport", () => {
  it("is not connected without AI_REPORT_WEBHOOK_URL", async () => {
    expect(await requestAiReport(makeStdEgExport(), { env: {} })).toEqual({
      ok: false,
      reason: "not_connected",
      message: "AI not connected.",
    });
  });

  it("reports a misconfigured URL", async () => {
    const outcome = await requestAiReport(makeStdEgExport(), { env: { AI_REPORT_WEBHOOK_URL: "reports.example.com" } });
    expect(outcome).toMatchObject({ ok: false, reason: "misconfigured" });
    expect(!outcome.ok && outcome.message).toContain("AI_REPORT_WEBHOOK_URL");
  });

  it("posts the signed export and returns the report URL", async () => {
    const fetchSpy = answering(() => Response.json({ reportUrl: "https://reports.example.com/r/INS-2024-0001.pdf" }));
    expect(await requestAiReport(makeStdEgExport(), { env: REPORT_ENV, fetch: fetchSpy })).toEqual({
      ok: true,
      reportUrl: "https://reports.example.com/r/INS-2024-0001.pdf",
    });
    const headers = new Headers(fetchSpy.mock.calls[0][1]?.headers);
    expect(headers.get(WEBHOOK_HEADERS.event)).toBe("ai.report.requested");
    expect(headers.get(WEBHOOK_HEADERS.signature)).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it.each([
    ["a missing reportUrl", { url: "https://reports.example.com/r/1.pdf" }],
    ["a reportUrl that is not http(s)", { reportUrl: "javascript:alert(1)" }],
  ])("rejects %s", async (_label, body) => {
    const outcome = await requestAiReport(makeStdEgExport(), { env: REPORT_ENV, fetch: answering(() => Response.json(body)) });
    expect(outcome).toMatchObject({ ok: false, reason: "invalid_response" });
  });

  it("maps HTTP errors and timeouts", async () => {
    expect(
      await requestAiReport(makeStdEgExport(), {
        env: REPORT_ENV,
        fetch: answering(() => new Response(null, { status: 502 })),
      }),
    ).toMatchObject({ ok: false, reason: "error", message: "The webhook answered HTTP 502." });

    const hanging = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    expect(await requestAiReport(makeStdEgExport(), { env: REPORT_ENV, fetch: hanging, timeoutMs: 20 })).toMatchObject({
      ok: false,
      reason: "timeout",
    });
  });

  it("never throws: an unexpected error is logged and reported", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const brokenEnv = new Proxy<Record<string, string>>(
      {},
      {
        get() {
          throw new Error("environment unavailable");
        },
      },
    );
    expect(await requestAiReport(makeStdEgExport(), { env: brokenEnv })).toEqual({
      ok: false,
      reason: "error",
      message: "Unexpected error while requesting the AI report.",
    });
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it("completes a signed round trip through the mock receiver", async () => {
    vi.stubEnv("AI_WEBHOOK_SECRET", SECRET);
    const outcome = await requestAiReport(makeStdEgExport(), {
      env: { ...REPORT_ENV, AI_REPORT_WEBHOOK_URL: "http://localhost:3000/api/dev/mock-ai-report" },
      fetch: async (input, init) => mockReportReceiver(new Request(input, init)),
    });
    expect(outcome).toEqual({
      ok: true,
      reportUrl: "http://localhost:3000/api/dev/mock-ai-report?ref=INS-2024-0001",
    });
  });
});
