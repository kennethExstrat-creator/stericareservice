// Markup of the 404 and error screens. app/global-error.tsx is checked here
// too: it only renders when the root layout fails, which no e2e run can
// cause without breaking the app.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GlobalError from "@/app/global-error";
import { ErrorScreen } from "./error-screen";
import { NotFoundScreen, StandaloneFrame } from "./status-screen";

const retry = () => {};

describe("NotFoundScreen", () => {
  it("says what happened and links back to the inspections", () => {
    const html = renderToStaticMarkup(<NotFoundScreen />);
    expect(html).toContain(">Page not found</h1>");
    expect(html).toContain('href="/inspections"');
    expect(html).toContain(">Go to inspections<");
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
});

describe("GlobalError", () => {
  it("renders its own document with a way to retry", () => {
    const error = Object.assign(new Error("root layout failed"), { digest: "42" });
    const html = renderToStaticMarkup(<GlobalError error={error} retry={retry} />);
    expect(html).toMatch(/^<html lang="en"/);
    expect(html).toContain("<body");
    expect(html).toContain("<title>SteriCare QC could not load</title>");
    expect(html).toContain(">The app could not load</h1>");
    expect(html).toContain("Try again");
    expect(html).toContain(">42<");
    expect(html).not.toContain("root layout failed");
  });
});
