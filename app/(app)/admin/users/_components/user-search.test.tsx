// The search's parts, drawn on the server with the search the page opened
// with (?q=). Typing, Escape and Clear Search in the browser are covered by
// e2e/users/uid.spec.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Table, TableBody } from "@/components/ui/table";
import type { TeamFilter } from "../_lib/team-filter";
import { userSearchText } from "../_lib/user-search";
import { UserRows, UserSearch, UserSearchBox, UserSearchSummary } from "./user-search";

const PEOPLE = [
  { id: "ada", uid: "SC-0001", fullName: "Ada Admin", email: "ada@test.local" },
  { id: "olga", uid: "SC-0042", fullName: "Olga Other", email: "olga@test.local" },
  { id: "ivan", uid: "SC-0043", fullName: "Ivan Inspector", email: "ivan@test.local" },
];
const ENTRIES = PEOPLE.map((person) => ({ id: person.id, text: userSearchText(person) }));
const ROWS = PEOPLE.map((person) => ({ id: person.id, row: <tr data-person={person.id} /> }));
const EVERYONE: TeamFilter = { kind: "everyone" };

function draw(query: string, { rows = ROWS, filter = EVERYONE }: { rows?: typeof ROWS; filter?: TeamFilter } = {}) {
  return renderToStaticMarkup(
    <UserSearch entries={ENTRIES} initialQuery={query} view="all">
      <UserSearchBox placeholder="Name, email or UID" />
      <UserSearchSummary filter={filter} shown={rows.length} total={PEOPLE.length} />
      <Table>
        <TableBody>
          <UserRows rows={rows} columns={9} emptyMessage="Nobody here yet." filter={filter} />
        </TableBody>
      </Table>
    </UserSearch>,
  );
}

const people = (html: string) => [...html.matchAll(/data-person="([^"]+)"/g)].map((match) => match[1]);

describe("the search box", () => {
  it("is labelled Search, says what it finds, and suits a keyboard and the iPad's", () => {
    const html = draw("");
    const input = html.match(/<input[^>]*>/)![0];
    const id = input.match(/\sid="([^"]+)"/)![1];
    expect(html).toContain(`for="${id}">Search</label>`);
    expect(input).toContain('type="search"');
    expect(input).toContain('placeholder="Name, email or UID"');
    expect(input).toContain('enterKeyHint="search"');
    expect(input).toContain('autoCapitalize="none"');
    expect(input).toContain('autoCorrect="off"');
    expect(input).toContain('spellCheck="false"');
    // 44 px tall on touch (docs/DESIGN.md, Density), like every field.
    expect(html).toMatch(/data-slot="input-group"[^>]*class="[^"]*\btouch:h-11\b/);
    expect(html).not.toContain("Clear Search");
  });

  it("offers Clear Search inside the box while it holds a search, with a hit area a finger finds", () => {
    const html = draw("olga");
    expect(html.match(/<input[^>]*>/)![0]).toContain('value="olga"');
    const clear = html.match(/<button[^>]*aria-label="Clear Search"[^>]*>/)![0];
    expect(clear).toMatch(/touch:after:-inset-\[5px\]/);
    expect(clear).toMatch(/touch:size-9/);
  });
});

describe("the rows a search leaves", () => {
  it("shows everyone without a search, and without a UserSearch around them", () => {
    expect(people(draw(""))).toEqual(["ada", "olga", "ivan"]);
    const alone = renderToStaticMarkup(
      <table>
        <tbody>
          <UserRows rows={ROWS} columns={9} emptyMessage="Nobody here yet." filter={EVERYONE} />
        </tbody>
      </table>,
    );
    expect(people(alone)).toEqual(["ada", "olga", "ivan"]);
  });

  it("shows only the people the search finds, in the list's order, and counts them", () => {
    const byUid = draw("sc-004");
    expect(people(byUid)).toEqual(["olga", "ivan"]);
    expect(byUid).toContain('role="status">2 of 3 people.</p>');
    expect(people(draw("SC-0042"))).toEqual(["olga"]);
    expect(people(draw("Ivan"))).toEqual(["ivan"]);
    expect(people(draw("ada@"))).toEqual(["ada"]);
  });

  it("says when nobody matches, across the table, with Clear Search", () => {
    const html = draw("zzz");
    expect(people(html)).toEqual([]);
    expect(html).toMatch(/<td[^>]*colSpan="9"[^>]*>.*Nobody matches “zzz”\..*Clear Search<\/button>/);
    expect(html).toContain('role="status">0 of 3 people.</p>');
  });

  it("keeps the view's own line when the view holds nobody, search or not", () => {
    const html = draw("olga", { rows: [], filter: { kind: "no-lead" } });
    expect(html).toMatch(/colSpan="9"[^>]*>Nobody here yet\.<\/td>/);
    expect(html).not.toContain("Clear Search</button>");
    expect(html).toContain('role="status">Every active inspector has a lead inspector.</p>');
  });
});
