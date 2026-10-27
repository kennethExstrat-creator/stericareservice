// The defect marking tool (Kenneth, 27 October 2026), as it renders before
// it has measured its frame. Dragging, resizing and the keys are checked in
// a browser; the geometry behind them in lib/photos/markers.test.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PhotoMarkup } from "./photo-markup";

const MARKS = [
  { x: 0.4, y: 0.5, r: 0.1 },
  { x: 0.7, y: 0.3, r: 0.05 },
];

describe("PhotoMarkup", () => {
  it("offers Mark Defect, the keys' hint and the save state to whoever may change the photo", () => {
    const html = renderToStaticMarkup(
      <PhotoMarkup src="https://storage.example/photo.jpg" alt="Photo 3" markers={MARKS} onMarkersChange={() => {}} status={<span>Saved</span>} />,
    );
    expect(html).toContain('role="group" aria-label="Defect Marks"');
    expect(html).toMatch(/<button[^>]*>.*Mark Defect<\/button>/);
    expect(html).toContain("The arrow keys move a mark, plus and minus size it, and Delete removes it.");
    expect(html).toContain("<span>Saved</span>");
    expect(html).toContain('alt="Photo 3"');
    // Nothing is selected yet: no size buttons, no Remove Mark.
    expect(html).not.toContain("Remove Mark");
    expect(html).not.toContain("Make Mark Larger");
    expect(html).toContain("2 defect marks");
  });

  it("shows the circles without tools to anyone who may not change the photo", () => {
    const html = renderToStaticMarkup(<PhotoMarkup src="https://storage.example/photo.jpg" alt="Photo 3" markers={MARKS.slice(0, 1)} />);
    expect(html).not.toContain("Mark Defect");
    expect(html).not.toContain("Defect Marks");
    expect(html).not.toContain("The arrow keys");
    expect(html).toContain("1 defect mark");
  });

  it("greys Mark Defect, still focusable, once the photo has its 20", () => {
    const full = Array.from({ length: 20 }, (_, index) => ({ x: index / 20, y: 0.5, r: 0.05 }));
    const html = renderToStaticMarkup(<PhotoMarkup src="https://storage.example/photo.jpg" alt="Photo 3" markers={full} onMarkersChange={() => {}} />);
    expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*title="At most 20 marks on one photo"[^>]*>.*Mark Defect/);
  });
});
