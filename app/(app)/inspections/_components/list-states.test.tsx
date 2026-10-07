// The states shown instead of rows, as server-rendered markup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ListPagination } from "./list-pagination";
import { LoadFailed, NoInspectionsYet, NoMatches, PastTheEnd } from "./list-states";

const CLIENT = "20000000-0000-4000-8000-000000000001";

describe("NoInspectionsYet", () => {
  it("tells an inspector they see only their own", () => {
    const html = renderToStaticMarkup(<NoInspectionsYet scope="own" />);
    expect(html).toContain("<h2");
    expect(html).toContain("No Inspections Yet");
    expect(html).toContain("You see only your own; admins see everyone&#x27;s.");
    expect(html).toContain("Start one with New Inspection.");
    expect(html).not.toContain("next build");
  });

  it("tells an admin they see every inspector's", () => {
    const html = renderToStaticMarkup(<NoInspectionsYet scope="all" />);
    expect(html).toContain("Inspections from every inspector will appear here");
    expect(html).toContain("Inspectors see only their own.");
  });

  it("tells a lead inspector they see their team's too, read-only", () => {
    const html = renderToStaticMarkup(<NoInspectionsYet scope="team" />);
    expect(html).toContain("Inspections you and your team start will appear here");
    expect(html).toContain("Your team&#x27;s open read-only.");
  });
});

describe("NoMatches", () => {
  it("says what was asked and offers to clear the filters", () => {
    const html = renderToStaticMarkup(
      <NoMatches filters={{ q: "E2E-LOT-A", status: "draft", client: CLIENT, page: 1 }} names={{ client: "Client A" }} />,
    );
    expect(html).toContain("No Inspections Match");
    expect(html).toContain("Nothing matches “E2E-LOT-A”, status Draft, client Client A.");
    expect(html).toContain("Search matches part of a ref or PO number, or a whole lot or carton number.");
    expect(html).toMatch(/<a[^>]*href="\/inspections"[^>]*>Clear Filters/);
  });

  it("leaves out the search hint when nothing was searched", () => {
    const html = renderToStaticMarkup(<NoMatches filters={{ status: "approved", page: 1 }} names={{}} />);
    expect(html).toContain("Nothing matches status Approved.");
    expect(html).not.toContain("Search matches");
  });
});

describe("PastTheEnd", () => {
  it("names the missing page and links to the last one, keeping the filters", () => {
    const html = renderToStaticMarkup(<PastTheEnd filters={{ status: "draft", page: 9 }} total={120} pageCount={3} />);
    expect(html).toContain("There Is No Page 9");
    expect(html).toContain("There are 120 inspections, on 3 pages.");
    expect(html).toMatch(/<a[^>]*href="\/inspections\?status=draft&amp;page=3"[^>]*>Go to Page 3/);
  });

  it("links back to the list when everything fits on one page", () => {
    const html = renderToStaticMarkup(<PastTheEnd filters={{ page: 2 }} total={1} pageCount={1} />);
    expect(html).toContain("There is 1 inspection, all on one page.");
    expect(html).toMatch(/<a[^>]*href="\/inspections"[^>]*>Go to the List/);
  });
});

describe("LoadFailed", () => {
  it("says what to do without technical details", () => {
    const html = renderToStaticMarkup(<LoadFailed retryHref="/inspections?status=draft" />);
    expect(html).toContain('data-list-state="error"');
    expect(html).toContain("The Inspections Could Not Be Loaded");
    expect(html).toMatch(/<a[^>]*href="\/inspections\?status=draft"[^>]*>Try Again/);
  });
});

describe("focus after a list link goes away", () => {
  it.each([
    ["no inspections yet", <NoInspectionsYet key="empty" scope="own" />],
    ["no matches", <NoMatches key="no-matches" filters={{ q: "X", page: 1 }} names={{}} />],
    ["past the end", <PastTheEnd key="past" filters={{ page: 2 }} total={1} pageCount={1} />],
    ["load failed", <LoadFailed key="failed" retryHref="/inspections" />],
  ])("can land on the %s heading, which takes focus from script only", (_, state) => {
    const html = renderToStaticMarkup(state);
    expect(html).toMatch(/<h2 data-list-focus="results" tabindex="-1" class="[^"]*outline-none[^"]*">/);
  });
});

describe("ListPagination", () => {
  it("is not shown for a single page", () => {
    expect(renderToStaticMarkup(<ListPagination filters={{ page: 1 }} pageCount={1} />)).toBe("");
  });

  it("links to the neighbouring pages, keeping the filters", () => {
    const html = renderToStaticMarkup(<ListPagination filters={{ q: "PO 7", page: 2 }} pageCount={3} />);
    expect(html).toContain("Page 2 of 3");
    const links = [...html.matchAll(/<a\b[^>]*>/g)].map(([tag]) => ({
      rel: /rel="([^"]*)"/.exec(tag)?.[1],
      href: /href="([^"]*)"/.exec(tag)?.[1],
    }));
    expect(links).toEqual([
      { rel: "prev", href: "/inspections?q=PO+7" },
      { rel: "next", href: "/inspections?q=PO+7&amp;page=3" },
    ]);
  });

  it("switches off Previous on the first page and Next on the last", () => {
    const first = renderToStaticMarkup(<ListPagination filters={{ page: 1 }} pageCount={2} />);
    expect(first).toMatch(/<button[^>]*disabled=""[^>]*>.*Previous/);
    const last = renderToStaticMarkup(<ListPagination filters={{ page: 2 }} pageCount={2} />);
    expect(last).toMatch(/<button[^>]*disabled=""[^>]*>.*Next/);
  });
});
