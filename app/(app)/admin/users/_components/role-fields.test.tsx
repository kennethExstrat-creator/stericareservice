// The role and lead fields that every placement dialog shares, drawn on the
// server. With nobody to choose, the lead picker keeps saying what to do,
// even after a refusal ("Choose their lead inspector" under an empty picker
// leads nowhere); a refusal about the role sits at the role, where focus goes.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { radioNames, radiosIn } from "../../_components/radio-card.testing";
import { INSPECTOR, LEAD, ROLES, STAND_INS } from "../_lib/roles.testing";
import { focusRole, LeadField, RoleField } from "./role-fields";

const LINA = { id: "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d", name: "Lina Lead", teamSize: 2 };
const NO_LEADS = "There is no active lead inspector yet. Make someone a lead inspector first.";
const NO_OTHER = "There is no other active lead inspector. Make someone else a lead inspector first.";
const NOBODY = "Nobody can lead them yet. Choose Lead Inspector or Admin, or make someone a lead inspector first.";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The field's text under the picker or the radios: a description, or an error (role="alert"). */
const hintOf = (html: string) => html.match(/data-slot="field-description"[^>]*>([^<]*)</)?.[1] ?? null;
const errorOf = (html: string) => html.match(/role="alert"[^>]*>([^<]*)</)?.[1] ?? null;

function lead(props: Partial<Parameters<typeof LeadField>[0]> = {}): string {
  return renderToStaticMarkup(<LeadField id="f" value="" onChange={() => {}} leads={[LINA]} {...props} />);
}

describe("LeadField", () => {
  it("says what a lead inspector sees, and shows a refusal in its place", () => {
    expect(lead()).toMatch(/<label[^>]*for="f-lead"[^>]*>Lead Inspector<\/label>/);
    expect(hintOf(lead())).toBe("Their lead inspector also sees their inspections, read-only.");
    const refused = lead({ error: "Choose their lead inspector." });
    expect(errorOf(refused)).toBe("Choose their lead inspector.");
    expect(refused).toMatch(/<button[^>]*aria-invalid="true"[^>]*aria-describedby="f-lead-error"/);
  });

  it("with nobody to choose, is disabled and says what to do, and still says it after a refusal", () => {
    const empty = lead({ leads: [] });
    expect(hintOf(empty)).toBe(NO_LEADS);
    expect(empty).toMatch(/<button[^>]*disabled=""/);
    expect(empty).toContain("No lead inspector yet");

    const refused = lead({ leads: [], error: "Choose their lead inspector." });
    expect(errorOf(refused)).toBe(NO_LEADS);
    expect(refused).not.toContain("Choose their lead inspector.");
  });

  it("tells the only lead inspector there is no other one", () => {
    expect(hintOf(lead({ leads: [], emptyHint: NO_OTHER }))).toBe(NO_OTHER);
    expect(errorOf(lead({ leads: [], emptyHint: NO_OTHER, error: "Choose their lead inspector." }))).toBe(NO_OTHER);
  });
});

describe("RoleField", () => {
  const field = (props: Partial<Parameters<typeof RoleField>[0]> = {}) =>
    renderToStaticMarkup(<RoleField id="f" value={INSPECTOR.id!} roles={ROLES} onChange={() => {}} {...props} />);

  it("names each role's radio by the role's name and describes what it sees, so Chrome does not leave it unnamed", () => {
    // The Invite, Change Role and Activate dialogs all draw these radios: the built-in roles, then custom roles.
    const html = field();
    expect(radioNames(html)).toEqual([
      { name: "Admin", description: "Sees All Inspections" },
      { name: "Lead Inspector", description: "Sees Team Inspections" },
      { name: "Inspector", description: "Sees Own Inspections" },
      { name: "Field Inspector", description: "Sees Own Inspections" },
      { name: "QA Reviewer", description: "Sees All Inspections" },
      { name: "Senior Lead", description: "Sees Team Inspections" },
    ]);
    expect(html).toContain(`aria-labelledby="f-role-${LEAD.id}-title"`);
    // Each sends the role's id; the one chosen is checked and in the form.
    expect(radiosIn(html).map((radio) => radio.value)).toEqual(ROLES.map((role) => role.id));
    expect(radiosIn(html).find((radio) => radio["aria-checked"] === "true")?.value).toBe(INSPECTOR.id);
    expect(html).toContain(`<input type="hidden" name="role" value="${INSPECTOR.id}"/>`);
  });

  it("sends a built-in role by its kind on a project without roles", () => {
    const html = field({ value: "inspector", roles: STAND_INS });
    expect(radiosIn(html).map((radio) => radio.value)).toEqual(["admin", "lead", "inspector"]);
    expect(html).toContain('<input type="hidden" name="role" value="inspector"/>');
  });

  it("names the group by its legend", () => {
    expect(field()).toMatch(/<legend[^>]*id="f-role-legend"[^>]*>Role<\/legend>/);
    expect(field()).toMatch(/role="radiogroup"[^>]*aria-labelledby="f-role-legend"/);
  });

  it("puts the role cards as far below their legend as every other field's control below its label", () => {
    // A fieldset's legend is no flex item: the FieldSet's gap never reaches it, so its own margin is the gap.
    const legend = /<legend data-slot="field-legend"[^>]*class="([^"]*)"/.exec(field())?.[1].split(" ");
    expect(legend).toContain("mb-3");
    expect(legend).not.toContain("mb-0");
    expect(legend).toContain("leading-snug");
  });

  it("puts a refusal about the role under the roles, as the group's description", () => {
    const html = field({ error: NOBODY });
    expect(html).toMatch(/<fieldset[^>]*aria-describedby="f-role-error"/);
    expect(html).toMatch(new RegExp(`id="f-role-error"[^>]*>${escape(NOBODY)}<`));
    expect(html).toContain('aria-invalid="true"');
  });
});

describe("focusRole", () => {
  it("focuses the chosen role, else the first one", () => {
    const checked = { focus: vi.fn() };
    const first = { focus: vi.fn() };
    const group = (withChecked: boolean) =>
      ({
        querySelector: (selector: string) =>
          selector.includes('aria-checked="true"') ? (withChecked ? checked : null) : first,
      }) as unknown as HTMLElement;

    focusRole(group(true));
    expect(checked.focus).toHaveBeenCalledOnce();
    expect(first.focus).not.toHaveBeenCalled();
    focusRole(group(false));
    expect(first.focus).toHaveBeenCalledOnce();
    expect(() => focusRole(null)).not.toThrow();
  });
});
