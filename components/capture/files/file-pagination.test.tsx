// The pages under Source Documents' files (Kenneth, 27 October 2026):
// "Showing 1–10 of 23", Previous, the page numbers and Next, 44 px on a
// touchscreen; nothing while the files fit on one page. A click is the
// button's own onClick, called on the element the component returns (the
// tests run without a browser).
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { FilePagination, type FilePaging } from "./file-pagination";

const PAGING: Omit<FilePaging, "page"> = { pageSize: 10, label: "Pages of files", onPageChange: () => {} };

const render = (total: number, page: number) => renderToStaticMarkup(<FilePagination total={total} page={page} {...PAGING} />);

/** Each button's markup, in order. */
const buttonsIn = (html: string) => html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];

type ButtonElement = ReactElement<{ onClick?: () => void; children?: ReactNode }>;

/** The words a node shows and reads out, without rendering it. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** The pagination's buttons as elements, by the words they read out: their onClick is what a click calls. */
function buttonNamed(total: number, page: number, onPageChange: (page: number) => void, name: string): ButtonElement {
  const found: ButtonElement[] = [];
  const walk = (node: ReactNode) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (isValidElement<{ children?: ReactNode }>(node)) {
      if (node.type === Button) found.push(node as ButtonElement);
      else walk(node.props.children);
    }
  };
  walk(FilePagination({ total, page, ...PAGING, onPageChange }));
  const button = found.find((element) => textOf(element.props.children) === name);
  if (!button) throw new Error(`no button "${name}" among ${found.map((element) => textOf(element.props.children)).join(", ")}`);
  return button;
}

describe("FilePagination", () => {
  it("shows nothing while the files fit on one page: ten or fewer", () => {
    expect(render(10, 1)).toBe("");
    expect(render(3, 1)).toBe("");
    expect(render(0, 1)).toBe("");
  });

  it("says which files show, with Previous, the page numbers and Next, page 1 current", () => {
    const html = render(23, 1);
    expect(html).toMatch(/^<nav aria-label="Pages of files" data-slot="file-pagination" class="relative /);
    expect(html).toContain("Showing 1–10 of 23");
    const buttons = buttonsIn(html);
    expect(buttons.map((button) => button.replace(/<[^>]+>/g, ""))).toEqual(["Previous Page", "1", "2", "3", "Next Page"]);
    // Previous greys out on page 1 but stays focusable; Next does not.
    expect(buttons[0]).toContain('aria-disabled="true"');
    expect(buttons[0]).not.toContain('disabled=""');
    expect(buttons[4]).not.toContain('aria-disabled="true"');
    expect(buttons[1]).toContain('aria-current="page"');
    expect(buttons[2]).not.toContain("aria-current");
  });

  it("goes to 11–20 with Next, and the last page shows the last 3 with Next greyed", () => {
    const onPageChange = vi.fn();
    buttonNamed(23, 1, onPageChange, "Next Page").props.onClick?.();
    expect(onPageChange).toHaveBeenCalledWith(2);
    expect(render(23, 2)).toContain("Showing 11–20 of 23");

    const last = render(23, 3);
    expect(last).toContain("Showing 21–23 of 23");
    const buttons = buttonsIn(last);
    expect(buttons.at(-1)).toContain('aria-disabled="true"');
    expect(buttons.find((button) => button.includes('aria-current="page"'))).toContain(">3<");

    const atEnd = vi.fn();
    buttonNamed(23, 3, atEnd, "Next Page").props.onClick?.();
    expect(atEnd).not.toHaveBeenCalled();
    buttonNamed(23, 3, atEnd, "Previous Page").props.onClick?.();
    expect(atEnd).toHaveBeenCalledWith(2);
  });

  it("turns to a page by its number", () => {
    const onPageChange = vi.fn();
    buttonNamed(23, 1, onPageChange, "3").props.onClick?.();
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("puts an ellipsis for the pages left out when there are many", () => {
    const html = render(120, 6);
    expect(buttonsIn(html).map((button) => button.replace(/<[^>]+>/g, ""))).toEqual(["Previous Page", "1", "5", "6", "7", "12", "Next Page"]);
    expect(html.match(/<span aria-hidden="true"[^>]*>…<\/span>/g)).toHaveLength(2);
  });

  it("is 44 px on any touchscreen and compact with a mouse, in the app's buttons", () => {
    const buttons = buttonsIn(render(23, 2));
    for (const button of [buttons[0], buttons.at(-1)!]) {
      expect(button).toContain('data-variant="outline"');
      expect(button).toMatch(/class="[^"]*\bh-8\b[^"]*\btouch:h-11\b/);
    }
    for (const button of buttons.slice(1, -1)) expect(button).toMatch(/class="[^"]*\bsize-8\b[^"]*\btouch:size-11\b/);
    expect(buttons[2]).toContain('data-variant="secondary"');
    expect(buttons[1]).toContain('data-variant="ghost"');
  });
});
