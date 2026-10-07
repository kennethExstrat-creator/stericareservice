// Markup of the admin overview's status cards in every state. The e2e run
// only sees the live, fully configured project, so the failure states are
// checked here: what each card says, and that no value of a key, secret or
// webhook URL ever reaches the page. AI states come from getAiStatus() itself.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getAiStatus } from "@/lib/ai";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import { AiReportCard, AiReviewCard, EmailCard, SupabaseCard, type DatabaseSummary } from "./admin-status-cards";

// Placeholders: none of these values may appear in the markup.
const ENV = { url: "https://abcdefghijklmnopqrst.supabase.co", publishableKey: "sb_publishable_placeholder0123" };
const API_KEY = "sk-ant-api03-placeholder-key-0123456789";
const REVIEW_WEBHOOK = "https://hooks.example.com/review?token=placeholder-review-token";
const REPORT_WEBHOOK = "https://hooks.example.com/report?token=placeholder-report-token";

const DATABASE: DatabaseSummary = {
  accounts: { active: 3, admins: 1, inspectors: 2, deactivated: 1 },
  reference: { manufacturers: 2, clients: 1, defectCodes: 32, templates: 0 },
};

/** The markup, and the text a reader sees (tags dropped, entities decoded). */
function render(element: ReactElement) {
  const html = renderToStaticMarkup(element);
  const text = html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
  return { html, text };
}

const hrefs = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1]);
const count = (text: string, phrase: string) => text.split(phrase).length - 1;

describe("SupabaseCard", () => {
  it("is ready when the keys are set and the tables read", () => {
    const { html, text } = render(<SupabaseCard env={ENV} secretKeySet database={DATABASE} />);
    expect(text).toContain("Ready");
    expect(text).not.toContain("Needs Attention");
    expect(text).toContain("abcdefghijklmnopqrst.supabase.co");
    expect(text).toContain("3 active (1 admin, 2 inspectors) · 1 deactivated");
    expect(text).toContain("2 manufacturers · 1 client · 32 defect codes · 0 templates");
    expect(text).not.toContain("Missing");
    expect(text).not.toContain("Not Readable");
    expect(html).not.toContain(ENV.publishableKey);
  });

  it("needs attention without the secret key", () => {
    const { text } = render(<SupabaseCard env={ENV} secretKeySet={false} database={DATABASE} />);
    expect(text).toContain("Needs Attention");
    expect(text).not.toContain("Ready");
    expect(text).toContain("Missing");
    expect(text).toContain("Set SUPABASE_SECRET_KEY to invite and deactivate users.");
  });

  it("needs attention without the URL and publishable key", () => {
    const { text } = render(<SupabaseCard env={null} secretKeySet database={DATABASE} />);
    expect(text).toContain("Needs Attention");
    expect(text).toContain("Not set");
    expect(text).toContain("Missing");
    expect(text).toContain("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  });

  it("says which tables it could not read", () => {
    const accountsOnly = render(
      <SupabaseCard env={ENV} secretKeySet database={{ accounts: null, reference: DATABASE.reference }} />,
    ).text;
    expect(accountsOnly).toContain("Needs Attention");
    expect(count(accountsOnly, "Not Readable")).toBe(1);
    expect(accountsOnly).toContain("Could not read the accounts. Check the migrations are applied.");
    expect(accountsOnly).toContain("2 manufacturers");

    const neither = render(<SupabaseCard env={ENV} secretKeySet database={{ accounts: null, reference: null }} />).text;
    expect(count(neither, "Not Readable")).toBe(2);
    expect(neither).toContain("Could not read the reference tables. Check the migrations and seed are applied.");
  });
});

describe("EmailCard", () => {
  it("says the links come from the project's Site URL, and what it must be", () => {
    const { html, text } = render(<EmailCard env={ENV} siteUrl="https://qc.example.com" />);
    expect(text).toContain("Check by Hand");
    expect(text).toContain("The links start with the project's Site URL, which this page cannot check.");
    expect(text).toContain(
      "In Authentication → URL Configuration, set it to https://qc.example.com and add https://qc.example.com/** to the redirect URLs.",
    );
    expect(hrefs(html)).toEqual([
      "https://supabase.com/dashboard/project/abcdefghijklmnopqrst/auth/templates",
      "https://supabase.com/dashboard/project/abcdefghijklmnopqrst/auth/url-configuration",
      "https://github.com/kennethExstrat-creator/stericareservice/blob/main/README.md#supabase-setup",
    ]);
    expect(html).not.toContain(ENV.publishableKey);
  });

  it("asks for NEXT_PUBLIC_SITE_URL instead of showing the localhost fallback", () => {
    const { text } = render(<EmailCard env={ENV} siteUrl={null} />);
    expect(text).toContain("Needs Attention");
    expect(text).not.toContain("Check by Hand");
    expect(text).toContain("NEXT_PUBLIC_SITE_URL is not set, so the app does not know its public address.");
    expect(text).not.toContain("localhost");
    expect(text).not.toContain("redirect URLs");
  });

  it("links only the set-up guide while the project is unknown", () => {
    const { html } = render(<EmailCard env={null} siteUrl="http://localhost:3000" />);
    expect(hrefs(html)).toEqual([
      "https://github.com/kennethExstrat-creator/stericareservice/blob/main/README.md#supabase-setup",
    ]);
  });
});

describe("AiReviewCard", () => {
  const CONNECT_NOTE =
    "To connect it, set ANTHROPIC_API_KEY or AI_REVIEW_WEBHOOK_URL. If AI_REVIEW_PROVIDER is set to off, change it to auto.";

  it("says how to connect it when nothing is set", () => {
    const { text } = render(<AiReviewCard status={getAiStatus({}).review} />);
    expect(text).toContain("Not Connected");
    expect(text).toContain("None");
    expect(text).toContain(CONNECT_NOTE);
  });

  it("points at the switch when AI_REVIEW_PROVIDER=off holds back a key that is set", () => {
    const { html, text } = render(
      <AiReviewCard status={getAiStatus({ AI_REVIEW_PROVIDER: "off", ANTHROPIC_API_KEY: API_KEY }).review} />,
    );
    expect(text).toContain("Not Connected");
    expect(text).toContain(CONNECT_NOTE);
    expect(html).not.toContain(API_KEY);
  });

  it("shows Claude and its model, never the key", () => {
    const { html, text } = render(<AiReviewCard status={getAiStatus({ ANTHROPIC_API_KEY: API_KEY }).review} />);
    expect(text).toContain("Connected");
    expect(text).not.toMatch(/not connected/i);
    expect(text).toContain("Claude (Anthropic API)");
    expect(text).toContain("Model");
    expect(text).toContain("claude-opus-5-5");
    expect(html).not.toContain(API_KEY);
  });

  it("shows a webhook without its address", () => {
    const { html, text } = render(<AiReviewCard status={getAiStatus({ AI_REVIEW_WEBHOOK_URL: REVIEW_WEBHOOK }).review} />);
    expect(text).toContain("Connected");
    expect(text).toContain("Webhook (your own service)");
    expect(text).not.toContain("Model");
    expect(html).not.toContain("hooks.example.com");
    expect(html).not.toContain("placeholder-review-token");
  });

  it("flags the mock reviewer as test data", () => {
    const { text } = render(<AiReviewCard status={getAiStatus({ AI_REVIEW_PROVIDER: "mock" }).review} />);
    expect(text).toContain("Test Data Only");
    expect(text).toContain("Mock reviewer (test data only)");
  });

  it("names the variable to fix, never its value", () => {
    const invalid = render(<AiReviewCard status={getAiStatus({ AI_REVIEW_PROVIDER: "gpt-placeholder" }).review} />);
    expect(invalid.text).toContain("Configuration Error");
    expect(invalid.text).toContain("Not usable");
    expect(invalid.text).toContain("AI_REVIEW_PROVIDER must be one of auto, webhook, claude, mock or off.");
    expect(invalid.text).not.toContain("To connect it");
    expect(invalid.html).not.toContain("gpt-placeholder");

    // A key pasted on the wrong line.
    const pasted = render(<AiReviewCard status={getAiStatus({ AI_REVIEW_PROVIDER: API_KEY }).review} />);
    expect(pasted.text).toContain("Configuration Error");
    expect(pasted.text).toContain("AI_REVIEW_PROVIDER holds an API key. Move the key to ANTHROPIC_API_KEY");
    expect(pasted.html).not.toContain(API_KEY);
    expect(pasted.html).not.toContain("placeholder-key");
  });
});

describe("AiReportCard", () => {
  it("offers the JSON download while not connected", () => {
    const { text } = render(<AiReportCard status={getAiStatus({}).report} />);
    expect(text).toContain("Not Connected");
    expect(text).toContain("“Send to AI Report” offers the JSON download instead.");
    expect(text).toContain("Set AI_REPORT_WEBHOOK_URL to connect a report service.");
  });

  it("shows a webhook without its address", () => {
    const { html, text } = render(<AiReportCard status={getAiStatus({ AI_REPORT_WEBHOOK_URL: REPORT_WEBHOOK }).report} />);
    expect(text).toContain("Connected");
    expect(text).not.toMatch(/not connected/i);
    expect(text).toContain("Webhook (your own service)");
    expect(html).not.toContain("hooks.example.com");
    expect(html).not.toContain("placeholder-report-token");
  });

  it("names the variable to fix, never its value", () => {
    const { html, text } = render(
      <AiReportCard status={getAiStatus({ AI_REPORT_WEBHOOK_URL: "not a url placeholder-value" }).report} />,
    );
    expect(text).toContain("Configuration Error");
    expect(text).toContain("AI_REPORT_WEBHOOK_URL is not a valid URL.");
    expect(html).not.toContain("placeholder-value");
  });
});

describe("the cards' labels", () => {
  it("title each card, row and pill in Title Case (docs/DESIGN.md, Capitalisation)", () => {
    const html = [
      render(<SupabaseCard env={null} secretKeySet={false} database={{ accounts: null, reference: null }} />).html,
      render(<EmailCard env={ENV} siteUrl="https://qc.example.com" />).html,
      render(<AiReviewCard status={getAiStatus({ AI_REVIEW_PROVIDER: "mock" }).review} />).html,
      render(<AiReportCard status={getAiStatus({}).report} />).html,
    ].join("");
    const all = (pattern: RegExp) => [...html.matchAll(pattern)].map((match) => match[1]);
    const titles = all(/<h3>([^<]+)<\/h3>/g);
    const rows = all(/<dt[^>]*>([^<]+)<\/dt>/g);
    const pills = all(/data-slot="status-pill"[^>]*>.*?<span>([^<]+)<\/span>/g);
    expect(titles).toEqual(["Supabase", "Sign-In Emails", "AI Second Opinion", "AI Report"]);
    expect(rows).toEqual([
      "Project",
      "URL and Publishable Key",
      "Secret Key (Server Only)",
      "Accounts",
      "Reference Data",
      "Provider",
      "Provider",
    ]);
    expect(pills).toEqual([
      "Needs Attention",
      "Missing",
      "Missing",
      "Not Readable",
      "Not Readable",
      "Check by Hand",
      "Test Data Only",
      "Not Connected",
    ]);
    for (const label of [...titles, ...rows, ...pills]) expect(lowerCaseWords(label), label).toEqual([]);
  });
});
