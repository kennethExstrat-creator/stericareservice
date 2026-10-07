import { describe, expect, it } from "vitest";
import { lookupFrom } from "@/lib/templates";
import { asVersions, baseEg, clientEg, clientFactoryEg } from "@/lib/templates/__fixtures__/definitions";
import { TEST_CLIENT_ID, TEST_MANUFACTURER_ID, TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { pathKey } from "@/lib/zod-form";
import { inheritanceOf } from "./inheritance";
import { addCustomModule, moduleView, moveModule, setConfig, setInclude, type Draft, type EditorContext } from "./model";
import {
  collectProblems,
  configIssues,
  hasDraftPlace,
  isEditableShape,
  problemsOfModule,
  scopeProblems,
  type DraftError,
} from "./problems";

const getBase = lookupFrom(asVersions([baseEg(), clientEg()]));

function check(draft: Draft, code = draft.code, draftErrors: DraftError[] = []) {
  const context: EditorContext = { inheritance: inheritanceOf(draft, getBase), registry: TEST_REGISTRY };
  return { context, ...collectProblems(draft, context, { code, getBase, draftErrors }) };
}

describe("collectProblems", () => {
  it("passes the fixtures, and hands back the resolved template for the preview", () => {
    for (const draft of [baseEg(), clientEg(), clientFactoryEg()]) {
      const { problems, resolved } = check(draft);
      expect(problems).toEqual([]);
      expect(resolved?.code).toBe(draft.code);
    }
  });

  it("puts a module's config problem on its field, in plain words", () => {
    const draft = baseEg();
    const { context } = check(draft);
    const broken = setConfig(draft, context, "weight", { n: 0, warnThresholdPct: -1 });
    const { problems, resolved } = check(broken);
    expect(resolved).toBeNull();
    expect(problems.map((problem) => [problem.place, problem.message])).toEqual([
      [{ area: "module", moduleKey: "weight", part: "config", path: ["n"] }, "Must be 1 or more."],
      [{ area: "module", moduleKey: "weight", part: "config", path: ["warnThresholdPct"] }, "Must be 0 or more."],
    ]);
    expect(configIssues(problems, "weight").get(pathKey(["n"]))).toEqual(["Must be 1 or more."]);
    expect(problemsOfModule(problems, "weight")).toHaveLength(2);
  });

  it("names the module for definition problems found by position", () => {
    const draft: Draft = { ...baseEg(), name: " ", modules: [...baseEg().modules] };
    draft.modules[1] = { ...draft.modules[1], labels: { "bad key": "x" } };
    const { problems } = check(draft);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ place: { area: "template", path: ["name"] }, message: "Enter a value." }),
        expect.objectContaining({
          place: { area: "module", moduleKey: "glove_info", part: "labels", path: ["bad key"] },
        }),
      ]),
    );
  });

  it("passes on what only the resolver knows, with the custom field it is about", () => {
    const draft = clientEg();
    const { context } = check(draft);
    const noOrder = setInclude(baseEg(), check(baseEg()).context, "order_lots", false);
    expect(check(noOrder).problems).toEqual([
      expect.objectContaining({
        place: { area: "module", moduleKey: "order_lots", part: "include", path: [] },
        message: expect.stringContaining("so order_lots must be on"),
      }),
    ]);

    const mapped: Draft = {
      ...draft,
      customModules: [
        {
          key: "extra",
          title: "Extra",
          after: "weight",
          layout: "fields",
          fields: [
            { key: "note", label: "Note", type: "text" },
            { key: "po", label: "PO", type: "number", mapsTo: "modules.header.poNo" },
          ],
        },
      ],
    };
    expect(moveModule(mapped, context, "weight", 3)).toBeDefined();
    expect(check(mapped).problems).toEqual([
      expect.objectContaining({
        place: { area: "custom", index: 0, customKey: "extra", path: ["fields", 1, "mapsTo"] },
        message: "A number field cannot hold modules.header.poNo, which is text.",
      }),
    ]);
  });

  it("keeps the code of the version, and says once when a base is missing", () => {
    expect(check({ ...baseEg(), code: "OTHER" }, "BASE_EG").problems).toEqual([
      expect.objectContaining({ place: { area: "template", path: ["code"] } }),
    ]);
    const orphan = { ...clientEg(), extends: "NOWHERE" };
    // The resolver finds the same missing base: one cause, one problem.
    expect(
      check(orphan)
        .problems.filter((problem) => problem.place.area === "template" && problem.place.path[0] === "extends")
        .map((problem) => problem.message),
    ).toEqual(["Base template NOWHERE has no active version."]);
  });

  it("asks for an emptied number, and says what is wrong with text typed into one", () => {
    const draft = baseEg();
    const { context } = check(draft);
    const weight = moduleView(draft, context, "weight").config;
    const place = { area: "module", moduleKey: "weight", part: "config", path: ["n"] };
    expect(check(setConfig(draft, context, "weight", { ...weight, n: null })).problems).toEqual([
      expect.objectContaining({ place, message: "Enter a number." }),
    ]);
    expect(check(setConfig(draft, context, "weight", { ...weight, n: "2 40" })).problems).toEqual([
      expect.objectContaining({ place, message: "“2 40” is not a number: remove the space (240)." }),
    ]);
  });

  it("counts text a field holds that is not a value yet as a problem", () => {
    const draft = baseEg();
    const { problems } = check(draft, draft.code, [
      {
        place: { area: "module", moduleKey: "loading", part: "config", path: [] },
        message: "Not valid JSON yet: Unexpected end of JSON input",
        text: '{"a": ',
      },
    ]);
    expect(problems.map((problem) => problem.message)).toEqual(["Not valid JSON yet: Unexpected end of JSON input"]);
  });
});

describe("hasDraftPlace", () => {
  const error = (place: DraftError["place"]): DraftError => ({ place, message: "Not valid JSON yet", text: "{" });

  it("keeps text while the setting or list item it was typed into is there", () => {
    const draft = baseEg();
    const context = check(draft).context;
    expect(hasDraftPlace(error({ area: "module", moduleKey: "loading", part: "config", path: [] }), draft, context)).toBe(true);
    expect(hasDraftPlace(error({ area: "module", moduleKey: "weight", part: "config", path: ["n"] }), draft, context)).toBe(true);
    // A list item that went: its text goes with it.
    expect(
      hasDraftPlace(error({ area: "module", moduleKey: "weight", part: "config", path: ["specs", 3, "spec"] }), draft, context),
    ).toBe(false);
  });

  it("drops text of a custom module that is no longer there", () => {
    const draft = baseEg();
    const context = check(draft).context;
    const place = { area: "custom", index: 0, customKey: "custom_1", path: ["fields", 0, "min"] } as const;
    expect(hasDraftPlace(error(place), draft, context)).toBe(false);
    const added = addCustomModule(draft, context).draft;
    expect(hasDraftPlace(error(place), added, context)).toBe(true);
    expect(hasDraftPlace(error({ ...place, path: ["fields", 4, "min"] }), added, context)).toBe(false);
  });
});

describe("scopeProblems", () => {
  const OTHER = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

  it("accepts a client and a manufacturer the database has, or none", () => {
    const options = { clients: [{ id: TEST_CLIENT_ID }], manufacturers: [{ id: TEST_MANUFACTURER_ID }] };
    expect(scopeProblems(clientFactoryEg(), options)).toEqual([]);
    expect(scopeProblems(baseEg(), { clients: [], manufacturers: [] })).toEqual([]);
  });

  it("puts one it does not have on the scope field, and leaves a malformed id to the schema", () => {
    const draft = clientEg();
    const problems = scopeProblems(draft, { clients: [{ id: OTHER }], manufacturers: [] });
    expect(problems).toEqual([
      expect.objectContaining({
        place: { area: "template", path: ["scope", "clientId"] },
        message: "Not one of the clients: choose a client, or Any Client.",
      }),
    ]);
    const malformed = { ...draft, scope: { ...draft.scope, clientId: "acme" } } as Draft;
    expect(scopeProblems(malformed, { clients: [], manufacturers: [] })).toEqual([]);
  });
});

describe("isEditableShape", () => {
  it("accepts a definition with a module list, and refuses one the module list cannot show", () => {
    expect(isEditableShape(baseEg())).toBe(true);
    expect(isEditableShape({ ...baseEg(), modules: [{ key: "nope", include: true }] } as unknown as Draft)).toBe(false);
    expect(isEditableShape({ code: "X" } as unknown as Draft)).toBe(false);
  });
});
