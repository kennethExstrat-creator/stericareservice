import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GENERATED_BLOCKS, replaceGeneratedBlocks } from "./render";

const DOC = new URL("../../docs/DATA_DICTIONARY.md", import.meta.url);
const UPDATE = "UPDATE_DATA_DICTIONARY=1 npx vitest run lib/coverage/doc.test.ts";

describe("docs/DATA_DICTIONARY.md", () => {
  it("has every generated block", () => {
    const text = readFileSync(DOC, "utf8");
    for (const name of Object.keys(GENERATED_BLOCKS)) {
      expect(text, name).toContain(`<!-- generated:${name} -->`);
      expect(text, name).toContain(`<!-- /generated:${name} -->`);
    }
  });

  it("matches lib/coverage: the generated blocks are up to date", () => {
    const text = readFileSync(DOC, "utf8");
    const rendered = replaceGeneratedBlocks(text);
    if (process.env.UPDATE_DATA_DICTIONARY === "1") {
      if (rendered !== text) writeFileSync(DOC, rendered);
      return;
    }
    expect(rendered === text, `docs/DATA_DICTIONARY.md is stale: run ${UPDATE}`).toBe(true);
  });
});
