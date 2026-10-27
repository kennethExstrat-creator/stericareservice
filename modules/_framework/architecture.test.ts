// Guards the layering that keeps the module engine free of import cycles
// and keeps module code pure, so six people can build modules side by side:
//
//   lib/schemas, lib/sizes, lib/stats      leaves
//   lib/validation (except validate.ts),   import leaves and framework files only
//   lib/templates, modules/_framework
//   modules/<key>                          import @/modules/_framework, never the registry
//   modules/registry.ts, modules/index.ts  import the modules
//   lib/validation/validate.ts             the one lib file that loads the registry
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isModuleKey } from "@/lib/schemas/module-result";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

type Import = { file: string; specifier: string; typeOnly: boolean };

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function importsOf(file: string): Import[] {
  const source = readFileSync(join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
  const found: Import[] = [];
  for (const match of source.matchAll(/^\s*(import|export)\s+(type\s+)?[^;()]*?\bfrom\s*["']([^"']+)["']/gm)) {
    found.push({ file, specifier: match[3], typeOnly: match[2] !== undefined });
  }
  for (const match of source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) {
    found.push({ file, specifier: match[1], typeOnly: false });
  }
  return found;
}

const isTest = (file: string) => /\.test\.tsx?$/.test(file) || file.includes("__fixtures__");
const runtimeImports = (dirs: string[]) =>
  dirs.flatMap(sourceFiles).filter((file) => !isTest(file)).flatMap(importsOf).filter((entry) => !entry.typeOnly);

function offenders(imports: Import[], forbidden: (specifier: string) => boolean): string[] {
  return imports.filter((entry) => forbidden(entry.specifier)).map((entry) => `${entry.file} imports ${entry.specifier}`);
}

/**
 * The framework's React parts, for Capture.tsx only: imported by their own
 * path (`@/modules/_framework/file-slot`, `@/modules/_framework/header-actions`,
 * `@/modules/_framework/inspection-links`, `@/modules/_framework/lab-reports`,
 * `@/modules/_framework/shown-size`, `@/modules/_framework/summary-assist`),
 * never through the framework's index.
 */
const FRAMEWORK_CLIENT_FILES = [
  "modules/_framework/file-slot.tsx",
  "modules/_framework/header-actions.tsx",
  "modules/_framework/inspection-links.tsx",
  "modules/_framework/lab-reports.tsx",
  "modules/_framework/shown-size.ts",
  "modules/_framework/summary-assist.tsx",
];

const REGISTRY = (specifier: string) =>
  specifier === "@/modules" || specifier === "@/modules/registry" || specifier === "@/modules/index";
const VALIDATION_ENTRY = (specifier: string) =>
  specifier === "@/lib/validation" || specifier === "@/lib/validation/index" || specifier === "@/lib/validation/validate";

describe("module layering", () => {
  const moduleFolders = readdirSync(join(ROOT, "modules"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "_framework")
    .map((entry) => `modules/${entry.name}`);

  it("names every module folder after a module key", () => {
    expect(moduleFolders.filter((folder) => !isModuleKey(folder.slice("modules/".length)))).toEqual([]);
  });

  it("keeps modules and the framework from importing the registry or the validation entry point", () => {
    const imports = runtimeImports([...moduleFolders, "modules/_framework"]);
    expect(offenders(imports, (specifier) => REGISTRY(specifier) || VALIDATION_ENTRY(specifier))).toEqual([]);
  });

  it("keeps module logic free of React, Next, components and server code (Capture.tsx and the client parts aside)", () => {
    const imports = runtimeImports([...moduleFolders, "modules/_framework"]).filter(
      (entry) => !/\/Capture\.tsx$/.test(entry.file) && !FRAMEWORK_CLIENT_FILES.includes(entry.file),
    );
    const ui = (specifier: string) =>
      specifier === "react" ||
      specifier.startsWith("react/") ||
      specifier.startsWith("next") ||
      specifier.startsWith("@/components") ||
      specifier.startsWith("@/app") ||
      specifier.startsWith("@/lib/supabase") ||
      specifier.startsWith("@/lib/ai") ||
      specifier === "server-only";
    expect(offenders(imports, ui)).toEqual([]);
  });

  it("keeps the framework's client parts out of everything but Capture.tsx", () => {
    // Server code, calcs and the export import @/modules/_framework: it must never pull in React.
    const imports = runtimeImports([...moduleFolders, "modules/_framework", "lib/validation", "lib/templates"]).filter(
      (entry) => !/\/Capture\.tsx$/.test(entry.file) && !FRAMEWORK_CLIENT_FILES.includes(entry.file),
    );
    const specifiers = FRAMEWORK_CLIENT_FILES.flatMap((file) => {
      const stem = file.replace(/\.tsx?$/, "");
      return [`@/${stem}`, `./${stem.slice("modules/_framework/".length)}`];
    });
    expect(specifiers).toEqual([
      "@/modules/_framework/file-slot",
      "./file-slot",
      "@/modules/_framework/header-actions",
      "./header-actions",
      "@/modules/_framework/inspection-links",
      "./inspection-links",
      "@/modules/_framework/lab-reports",
      "./lab-reports",
      "@/modules/_framework/shown-size",
      "./shown-size",
      "@/modules/_framework/summary-assist",
      "./summary-assist",
    ]);
    expect(offenders(imports, (specifier) => specifiers.includes(specifier))).toEqual([]);
    for (const file of FRAMEWORK_CLIENT_FILES) {
      expect(readFileSync(join(ROOT, file), "utf8").startsWith('"use client";'), file).toBe(true);
    }
  });

  it("lets only the conclusion's Capture ask for a Steri-AI Summary", () => {
    // The slot drafts the Inspection Summary (docs/AI.md, "Steri-AI Summary"): no other module has one.
    const users = moduleFolders
      .flatMap(sourceFiles)
      .filter((file) => !isTest(file))
      .flatMap(importsOf)
      .filter((entry) => entry.specifier === "@/modules/_framework/summary-assist")
      .map((entry) => entry.file);
    expect(users).toEqual(["modules/conclusion/Capture.tsx"]);
    // Its types come from a client-safe leaf, so the slot pulls in nothing but React.
    expect(importsOf("modules/_framework/summary-assist.tsx").map((entry) => entry.specifier)).toEqual([
      "react",
      "@/lib/schemas/summary-style",
    ]);
  });

  it("keeps the inspection's links slot to React alone", () => {
    // The capture screen gives the links (Export Sampling Plan; Kenneth, 27 October 2026): the slot itself knows no route.
    expect(importsOf("modules/_framework/inspection-links.tsx").map((entry) => entry.specifier)).toEqual(["react"]);
  });

  it("lets only lib/validation/validate.ts load the registry from lib", () => {
    const imports = runtimeImports(["lib/schemas", "lib/sizes", "lib/templates", "lib/validation"]).filter(
      (entry) => entry.file !== "lib/validation/validate.ts",
    );
    expect(offenders(imports, (specifier) => REGISTRY(specifier) || /^@\/modules\/(?!_framework)/.test(specifier))).toEqual(
      [],
    );
  });

  it("keeps lib/schemas and lib/sizes as leaves", () => {
    const imports = runtimeImports(["lib/schemas", "lib/sizes"]);
    const outward = (specifier: string) =>
      specifier.startsWith("@/modules") || specifier.startsWith("@/lib/templates") || specifier.startsWith("@/lib/validation");
    expect(offenders(imports, outward)).toEqual([]);
  });

  it("reads imports the way the guard expects", () => {
    expect(importsOf("modules/registry.ts").map((entry) => entry.specifier)).toContain("./glove_info");
    expect(importsOf("modules/_framework/contract.ts").filter((entry) => entry.specifier === "react")).toEqual([
      { file: "modules/_framework/contract.ts", specifier: "react", typeOnly: true },
    ]);
    expect(relative(ROOT, join(ROOT, "modules"))).toBe("modules");
  });
});
