// Markup of the 404 and error screens. app/global-error.tsx is checked here
// too: it only renders when the root layout fails, which no e2e run can
// cause without breaking the app.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GlobalError from "@/app/global-error";
import { ERROR_SCREEN_TITLE, ErrorScreen } from "./error-screen";
import { NotFoundScreen, StandaloneFrame } from "./status-screen";

const retry = () => {};

/** The opening tag of the page's h1. */
const headingTag = (html: string) => html.match(/<h1[^>]*>/)?.[0] ?? "";

describe("NotFoundScreen", () => {
  it("says what happened and links back to the inspections", () => {
    const html = renderToStaticMarkup(<NotFoundScreen />);
    expect(html).toContain(">Page not found</h1>");
    expect(html).toContain('href="/inspections"');
    expect(html).toContain(">Go to inspections<");
    // Only the error screens move focus to their heading.
    expect(headingTag(html)).not.toContain("tabindex");
  });

  it("sits in a frame with the logo linking home", () => {
    const html = renderToStaticMarkup(
      <StandaloneFrame>
        <NotFoundScreen />
      </StandaloneFrame>,
    );
    expect(html).toContain('aria-label="SteriCare home"');
    expect(html).toContain('<main id="main-content"');
  });
});

describe("ErrorScreen", () => {
  it("offers Try again and shows the digest as a reference", () => {
    const error = Object.assign(new Error("boom"), { digest: "1399811856" });
    const html = renderToStaticMarkup(<ErrorScreen error={error} retry={retry} />);
    expect(html).toContain(">This page did not load</h1>");
    expect(html).toContain("Try again");
    expect(html).toContain("quote the reference below");
    expect(html).toContain(">1399811856<");
    // The message itself can be technical or sensitive: it never shows.
    expect(html).not.toContain("boom");
  });

  it("does not mention a reference it does not have", () => {
    const html = renderToStaticMarkup(<ErrorScreen error={new Error("boom")} retry={retry} />);
    expect(html).not.toContain("Reference");
    expect(html).not.toContain("quote the reference");
  });

  it("titles the tab and makes its heading the focus target", () => {
    const html = renderToStaticMarkup(<ErrorScreen error={new Error("boom")} retry={retry} />);
    // React moves the title into <head>; Next's route announcer reads it after a navigation.
    expect(html).toContain(`<title>${ERROR_SCREEN_TITLE}</title>`);
    expect(ERROR_SCREEN_TITLE).toBe("This page did not load · SteriCare QC");
    // Focus moves here on mount (e2e/shell checks it), so VoiceOver says what happened.
    expect(headingTag(html)).toContain('tabindex="-1"');
  });

  it("lets the page's scroll padding clear the top bar above its heading, with 0.5rem more", () => {
    // app/globals.css keeps the bar and 1rem; a margin of the bar's height again would double it.
    const html = renderToStaticMarkup(<ErrorScreen error={new Error("boom")} retry={retry} />);
    const classes = (/class="([^"]*)"/.exec(headingTag(html))?.[1] ?? "").split(" ");
    expect(classes.filter((name) => name.startsWith("scroll-mt"))).toEqual(["scroll-mt-2"]);
    expect(headingTag(html)).not.toContain("--shell-top");
  });
});

describe("GlobalError", () => {
  it("renders its own document with a way to retry and a way back", () => {
    const error = Object.assign(new Error("root layout failed"), { digest: "42" });
    const html = renderToStaticMarkup(<GlobalError error={error} retry={retry} />);
    expect(html).toMatch(/^<html lang="en"/);
    expect(html).toContain("<body");
    expect(html).toContain("<title>SteriCare QC could not load</title>");
    expect(html).toContain(">The app could not load</h1>");
    expect(headingTag(html)).toContain('tabindex="-1"');
    expect(html).toContain("Try again");
    // A plain link: the root layout failed, so it loads the app afresh.
    expect(html).toMatch(/<a [^>]*href="\/inspections"[^>]*>Go to inspections<\/a>/);
    expect(html).toContain(">42<");
    expect(html).not.toContain("root layout failed");
  });
});
