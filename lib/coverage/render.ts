// Renders the dictionary, the templates, the defect lists and the coverage
// inventory as the generated blocks of docs/DATA_DICTIONARY.md, so the doc
// never drifts from the data. doc.test.ts checks the blocks; to rewrite them:
//   UPDATE_DATA_DICTIONARY=1 npx vitest run lib/coverage/doc.test.ts
import { MODULE_KEYS, type ModuleKey } from "@/lib/schemas/module-result";
import { formatSpec } from "@/lib/stats/spec";
import { SAFEDON_DISPENSING_DEFECTS, STICKINESS_CODES, VISUAL_DEFECTS, WATERTIGHT_LOCATIONS } from "./defects";
import { moduleSpec, moduleTitle, VALIDATION_RULES } from "./fields";
import { DEFECT_CLASSES, MEASURES } from "./keys";
import { diffPaths } from "./merge";
import { SOURCE_DOCUMENTS, sourceFields } from "./sources";
import { labelOverrides, samplingColumnSwitches, seedConfig, TEMPLATES, type TemplateModule, type TemplateSpec } from "./templates";
import {
  isConfigTarget,
  isCustomTarget,
  isFieldTarget,
  isLabelTarget,
  isTemplateTarget,
  SOURCE_IDS,
  TEMPLATE_CODES,
  type DataFieldSpec,
  type LabelOverrides,
  type RuleNumber,
  type SourceTarget,
  type TemplateCode,
} from "./types";
import { appWording } from "./wording";

/* ------------------------------------------------------------------ *
 * Markdown helpers
 * ------------------------------------------------------------------ */

/** One table cell: pipes escaped, `<` and `*` kept literal, never empty. */
function cell(text: string | number | undefined | null): string {
  const value = text === undefined || text === null || text === "" ? "" : String(text);
  return value.replace(/\|/g, "\\|").replace(/</g, "&lt;").replace(/\*/g, "\\*");
}

const code = (text: string) => `\`${text}\``;

function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function overrides(labels: LabelOverrides | undefined): string {
  return Object.entries(labels ?? {})
    .map(([template, label]) => `${template}: ${cell(label)}`)
    .join("<br>");
}

const rules = (list: readonly RuleNumber[] | undefined) => (list?.length ? list.join(", ") : "");

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function json(value: unknown): string {
  return code(JSON.stringify(value));
}

/* ------------------------------------------------------------------ *
 * Modules
 * ------------------------------------------------------------------ */

function fieldNotes(field: DataFieldSpec): string {
  const parts = [
    field.formula && `${field.formula}`,
    field.keyedBy && `Map keyed by ${field.keyedBy}.`,
    field.countOf && `Counts ${field.countOf}.`,
    field.options && `Values: ${field.options.join(", ")}.`,
    field.prefill && `Prefilled from ${field.prefill}.`,
    field.column && `Column ${code(field.column)}.`,
    field.addition && `**Beyond BUILD_SPEC 6.1:** ${field.addition}`,
    field.notes,
  ];
  return parts.filter(Boolean).map((part) => cell(part as string).replace(/\\\*\\\*/g, "**")).join(" ");
}

function groupWording(field: DataFieldSpec): string {
  const groups = Object.entries(field.groupLabels ?? {}).map(([group, value]) => {
    const others = overrides(value.labels);
    return `${group}: ${cell(value.label)}${others ? ` (${others})` : ""}`;
  });
  return groups.join("<br>");
}

function moduleSection(key: ModuleKey): string {
  const spec = moduleSpec(key);
  const kind = [spec.kind === "report" ? "Report module" : "Optional module", spec.alwaysOn ? "always on" : null]
    .filter(Boolean)
    .join(", ");
  const titleOverrides = overrides(spec.titles);
  const lines = [
    `### ${code(key)}: ${spec.title}`,
    "",
    `${kind}. Captures: ${spec.captures} Result: ${spec.result} Rules (6.2): ${rules(spec.rules)}.${
      titleOverrides ? ` Title in other templates: ${titleOverrides.replace(/<br>/g, "; ")}.` : ""
    }`,
    "",
    table(
      ["Key", "Label (STD_EG)", "Other wording", "Type", "Unit", "Per", "Entry", "Rules", "Notes"],
      spec.data.map((field) => [
        code(field.key),
        cell(field.label),
        [overrides(field.labels), groupWording(field)].filter(Boolean).join("<br>"),
        field.type,
        field.unit ?? "",
        field.per.length ? field.per.join(" › ") : "inspection",
        field.entry === "computed" ? "**computed**" : field.entry,
        rules(field.rules),
        fieldNotes(field),
      ]),
    ),
  ];
  if (spec.config.length) {
    lines.push(
      "",
      table(
        ["Config key", "Type", "Default", "Meaning"],
        spec.config.map((config) => [
          code(config.key),
          cell(config.type),
          config.defaultNote === undefined ? json(config.default) : cell(config.defaultNote),
          cell(config.meaning),
        ]),
      ),
    );
  } else {
    lines.push("", "No config.");
  }
  if (spec.labels.length) {
    lines.push(
      "",
      table(
        ["Caption key", "Label (STD_EG)", "Other wording", "Meaning"],
        spec.labels.map((label) => [code(label.key), cell(label.label), overrides(label.labels), cell(label.meaning)]),
      ),
    );
  }
  for (const note of spec.notes ?? []) lines.push("", `Note: ${note}`);
  return lines.join("\n");
}

function renderModules(): string {
  return MODULE_KEYS.map(moduleSection).join("\n\n");
}

function renderRules(): string {
  const rows = (Object.entries(VALIDATION_RULES) as [string, string][]).map(([number, text]) => {
    const rule = Number(number) as RuleNumber;
    const modules = MODULE_KEYS.filter((key) => moduleSpec(key).rules.includes(rule));
    return [number, cell(text), modules.map(code).join(", ")];
  });
  return table(["Rule", "BUILD_SPEC 6.2", "Modules that apply it"], rows);
}

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

const onOff = (record: Readonly<Record<string, boolean>>, value: boolean) =>
  Object.entries(record)
    .filter(([, on]) => on === value)
    .map(([key]) => key);

function configSummary(module: TemplateModule): string {
  switch (module.key) {
    case "header": {
      const off = onOff(module.config.fields, false);
      return `fields off: ${off.length ? off.join(", ") : "none"}; mfg / expiry dates: ${module.config.mfgExpiryPrecision}`;
    }
    case "glove_info":
      return `fields off: ${onOff(module.config.fields, false).join(", ") || "none"}; indicative weight for size ${module.config.indicativeWeightSize}`;
    case "order_lots":
      return `packing site ${module.config.fields.packingSite ? "on" : "off"}`;
    case "packing_config":
      return `inner unit ${module.config.innerUnit}; packing mode text ${module.config.fields.packingMode ? "on" : "off"}`;
    case "sampling_plan":
      return `columns off: ${onOff(samplingColumnSwitches(module.config.columns), false).join(", ") || "none"}; inspection level ${module.config.inspectionLevel ?? "none (to confirm)"}`;
    case "dimensions": {
      const decimals = module.config.measures.map((measure) => `${measure} ${module.config.decimals[measure]}`).join(", ");
      return `${module.config.statistic} of ${module.config.rows} gloves; measures ${module.config.measures.join(", ")}; decimals ${decimals}; specs ${module.config.specs.length ? `for ${module.config.specs.map((row) => row.size).join(", ")}, below` : "none"}`;
    }
    case "weight":
      return `${count(module.config.n, "value", "values")} per size; spec ${module.config.specs.length ? "per size, below" : "none (info)"}; warn beyond ${module.config.warnThresholdPct}%; ${module.config.decimals} decimals`;
    case "force_at_break":
      return `${module.config.n} readings per size; median ≥ ${module.config.specMin} N; ${module.config.decimals} decimals; standard label ${module.config.standardLabel ?? "none"}`;
    case "tensile":
      return `tensile ≥ ${module.config.tensileMin} MPa; elongation ≥ ${module.config.elongationMin}%; Spec. (${module.config.standardLabel}); decimals ${module.config.decimals.tensileStrength} and ${module.config.decimals.elongationAtBreak}`;
    case "watertight":
      return `AQL ${module.config.aql}; hand split ${module.config.handSplit ? "on" : "off"}; locations: ${module.config.locations
        .map((item) => `${item.label} (${item.code})`)
        .join(", ")}`;
    case "visual":
      return `hand split ${module.config.handSplit ? "on" : "off"}; ${DEFECT_CLASSES.map((cls) => {
        const value = module.config.classes[cls];
        return `${cls} ${value.include ? `AQL ${value.aql.toFixed(1)}, ${value.defects.length} defects` : "off"}`;
      }).join("; ")}`;
    case "dispensing_packing": {
      const bySize = Object.entries(module.config.boxesPerSize.bySize ?? {})
        .map(([size, rows]) => `${size} ${rows}`)
        .join(", ");
      return `layering ≥ ${module.config.minLayeringPct}%, dispensing ≥ ${module.config.minDispensingPct}%; ${module.config.boxesPerSize.default} boxes per size${bySize ? ` (${bySize})` : ""}; stickiness ${module.config.stickinessCodes
        .map((item) => `${item.code} ${item.pass ? "pass" : "fail"}`)
        .join(", ")}`;
    }
    case "dispensing_safedon":
      return `rate ≤ ${module.config.maxRatePct}% per size; ${module.config.glovesPerPack} gloves per pack; ${module.config.boxesPerSize.default} boxes per size; defects ${module.config.defects.map((item) => item.code).join(", ")}`;
    case "labeling":
      return (["inner", "carton"] as const)
        .map((level) => {
          const value = module.config.levels[level];
          return `${level}: ${value.include ? `${count(value.n, "box", "boxes")}, checks ${value.checks.map((check) => check.code).join(", ")}` : "off"}`;
        })
        .join("; ");
    case "dye_leak":
      return `pouches per size: ${module.config.n ?? "from the sampling plan"}`;
    case "documents":
      return module.config.items.map((item) => `${item.key}${item.required ? " (required)" : ""}`).join(", ");
    case "loading":
      return `fields off: ${onOff(module.config.fields, false).join(", ") || "none"}`;
    case "carton_sampling":
    case "conclusion":
      return "none";
  }
}

function specTable(template: TemplateSpec): string | null {
  const dimensions = template.modules.find((module) => module.key === "dimensions");
  if (!dimensions || dimensions.key !== "dimensions" || dimensions.config.specs.length === 0) return null;
  const measures = MEASURES.filter((measure) => dimensions.config.measures.includes(measure));
  const rows = dimensions.config.specs.map(({ size, specs }) => [
    size,
    ...measures.map((measure) => {
      const spec = specs[measure];
      return spec ? cell(formatSpec(spec)) : "";
    }),
  ]);
  const weight = template.modules.find((module) => module.key === "weight");
  const lines = [
    `Dimension specs (mm, ${dimensions.config.statistic}; a size without a row is not judged):`,
    "",
    table(["Size", ...measures], rows),
  ];
  if (weight && weight.key === "weight" && weight.config.specs.length) {
    const specs = weight.config.specs.map(({ size, spec }) => `${size} ${formatSpec(spec)}`);
    lines.push("", `Weight specs: ${specs.join(", ")}.`);
  }
  return lines.join("\n");
}

function differences(template: TemplateSpec, base: TemplateSpec): string[] {
  const baseKeys = base.modules.map((module) => module.key);
  const keys = template.modules.map((module) => module.key);
  const lines: string[] = [];
  const removed = baseKeys.filter((key) => !keys.includes(key));
  const added = keys.filter((key) => !baseKeys.includes(key));
  if (removed.length || added.length) {
    lines.push(
      `Modules: ${added.map(code).join(", ")} instead of ${removed.map(code).join(", ")}, in the same places; the added modules' config is written whole.`,
    );
  }
  for (const entry of template.modules) {
    if (!baseKeys.includes(entry.key)) continue;
    const paths = diffPaths(seedConfig(template.code, entry.key) ?? {});
    if (paths.length) lines.push(`${code(entry.key)} config: ${paths.map(code).join(", ")}.`);
  }
  for (const key of keys) {
    const own = labelOverrides(template.code, key);
    const inherited = baseKeys.includes(key) ? labelOverrides(base.code, key) : {};
    const changed = Object.entries(own).filter(([label, value]) => inherited[label] !== value);
    if (changed.length) {
      lines.push(`${code(key)} wording: ${changed.map(([label, value]) => `${code(label)} "${cell(value)}"`).join(", ")}.`);
    }
    if (baseKeys.includes(key) && moduleTitle(template.code, key) !== moduleTitle(base.code, key)) {
      lines.push(`${code(key)} title: "${cell(moduleTitle(template.code, key))}".`);
    }
  }
  return lines;
}

function templateSection(code_: TemplateCode): string {
  const template = TEMPLATES[code_];
  const custom = template.customModules
    .map(
      (module) =>
        `${code(module.key)} "${cell(module.title)}" (${module.layout}) after ${code(module.after)}: ${module.fields
          .map((field) => `${code(field.key)} "${cell(field.label)}"`)
          .join(", ")}`,
    )
    .join("; ");
  const lines = [
    `### ${code(template.code)}: ${template.name}`,
    "",
    table(
      ["Property", "Value"],
      [
        ["Extends", template.extends ? code(template.extends) : "none"],
        [
          "Scope",
          `${template.scope.productType}, ${template.scope.standard}${template.scope.clientScoped ? ", one client" : ""}`,
        ],
        ["Built from", template.builtFrom.map((source) => code(SOURCE_DOCUMENTS[source].file)).join(", ")],
        ["Unit, sizes", `${template.unit}; ${template.sizes.map((size) => size.value).join(", ")}`],
        ["Report title", template.report.titleLines ? cell(template.report.titleLines.join(" / ")) : "to confirm"],
        ["Client logo", template.report.showClientLogo ? "yes" : "no"],
        ["Custom modules", custom || "none"],
      ],
    ),
    "",
    table(
      ["#", "Module", "Title", "Config"],
      template.modules.map((module, index) => [
        String(index + 1),
        code(module.key),
        cell(moduleTitle(template.code, module.key)),
        cell(configSummary(module)),
      ]),
    ),
  ];
  const specs = specTable(template);
  if (specs) lines.push("", specs);
  if (template.extends) {
    lines.push(
      "",
      `Differences from ${code(template.extends)}: its seed writes only these config values (\`seedConfig\`). Objects merge key by key and lists replace whole (\`merge.ts\`), so the spec rows are lists and \`templates.test.ts\` checks that merging them over ${code(template.extends)} gives the config above.`,
      "",
    );
    for (const line of differences(template, TEMPLATES[template.extends])) lines.push(`- ${line}`);
  } else if (template.code !== "STD_EG") {
    const wording = template.modules
      .map((module) => [module.key, labelOverrides(template.code, module.key)] as const)
      .filter(([, labels]) => Object.keys(labels).length > 0)
      .map(([key, labels]) =>
        `${code(key)}: ${Object.entries(labels)
          .map(([label, value]) => `${code(label)} "${cell(value)}"`)
          .join(", ")}`,
      );
    if (wording.length) {
      lines.push("", "Wording that differs from the defaults:", "");
      for (const line of wording) lines.push(`- ${line}`);
    }
  }
  if (template.toConfirm.length) {
    lines.push("", "To confirm:", "");
    for (const item of template.toConfirm) lines.push(`- ${code(item.path)}: ${cell(item.note)}`);
  }
  return lines.join("\n");
}

function renderTemplates(): string {
  return TEMPLATE_CODES.map(templateSection).join("\n\n");
}

/* ------------------------------------------------------------------ *
 * Defects
 * ------------------------------------------------------------------ */

function renderDefects(): string {
  const lines: string[] = [];
  for (const template of ["STD_EG", "SAFEDON_EG"] as const) {
    lines.push(
      `${code(template)} visual defects, in report order, then the ones only the onsite forms have:`,
      "",
      table(
        ["Class", "Label", "Code", "Printed"],
        DEFECT_CLASSES.flatMap((cls) =>
          VISUAL_DEFECTS[template][cls].map((defect) => [
            cls,
            cell(defect.label),
            code(defect.code),
            cell(defect.written === undefined ? defect.printed : `not printed: written ${defect.written} on the onsite forms`),
          ]),
        ),
      ),
      "",
    );
  }
  lines.push(
    "`STD_SG` uses the STD_EG report's lists until confirmed, without Skin Visual and Flow Mark (Kenneth's yes of 12 October 2026 covered STD_EG and SAFEDON_EG): the SG form has blank rows.",
    "",
    "Severity per template, by code (a code in two classes of one template is a deliberate split):",
    "",
  );
  const codes = [
    ...new Set(
      (["STD_EG", "SAFEDON_EG"] as const).flatMap((template) =>
        DEFECT_CLASSES.flatMap((cls) => VISUAL_DEFECTS[template][cls].map((defect) => defect.code)),
      ),
    ),
  ];
  lines.push(
    table(
      ["Code", "STD_EG", "SAFEDON_EG"],
      codes.map((defectCode) => [
        code(defectCode),
        ...(["STD_EG", "SAFEDON_EG"] as const).map((template) =>
          DEFECT_CLASSES.flatMap((cls) =>
            VISUAL_DEFECTS[template][cls]
              .filter((defect) => defect.code === defectCode)
              .map((defect) => `${cls}: ${cell(defect.label)}`),
          ).join("<br>"),
        ),
      ]),
    ),
    "",
    "Watertight hole locations, in report order:",
    "",
    table(
      ["Template", "Locations (code)"],
      TEMPLATE_CODES.map((template) => [
        code(template),
        WATERTIGHT_LOCATIONS[template].map((location) => `${cell(location.label)} (${code(location.code)})`).join(", "),
      ]),
    ),
    "",
    "Safedon dispensing defects (SAFEDON_EG report page 3, Safedon onsite sheet):",
    "",
    table(
      ["Code", "Label", "Hint shown in the app", "Printed definition"],
      SAFEDON_DISPENSING_DEFECTS.map((defect) => [
        code(defect.code),
        cell(defect.label),
        cell(defect.hint),
        cell(defect.printedHint),
      ]),
    ),
    "",
    "Stickiness codes (STD_EG report page 4):",
    "",
    table(
      ["Code", "Legend", "Result", "Printed"],
      STICKINESS_CODES.map((item) => [code(item.code), cell(item.label), item.pass ? "pass" : "fail", cell(item.printed)]),
    ),
  );
  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * Coverage matrix
 * ------------------------------------------------------------------ */

function describeTarget(target: SourceTarget): string {
  if (isFieldTarget(target)) {
    return code(
      `${target.module}.${target.field}${target.group ? `[${target.group}]` : ""}${target.key ? `[${target.key}]` : ""}`,
    );
  }
  if (isConfigTarget(target)) return `config ${code(`${target.module}.${target.config}${target.key ? `[${target.key}]` : ""}`)}`;
  if (isLabelTarget(target)) {
    return target.label === "title" ? `title ${code(target.module)}` : `caption ${code(`${target.module}.${target.label}`)}`;
  }
  if (isCustomTarget(target)) return `custom ${code(`${target.custom}.${target.field}`)}`;
  if (isTemplateTarget(target)) return `template ${code(target.template)}`;
  return `layout: ${cell(target.layout)}`;
}

function renderCoverage(): string {
  return SOURCE_IDS.map((source) => {
    const document = SOURCE_DOCUMENTS[source];
    const fields = sourceFields(source);
    return [
      `#### ${code(document.file)}: ${fields.length} fields`,
      "",
      table(
        ["Section", "Label (verbatim)", "App wording", "Input", "Maps to", "Notes"],
        fields.map((field) => [
          cell(field.section),
          cell(field.label),
          cell(appWording(field)),
          field.input,
          field.targets.map(describeTarget).join("<br>"),
          cell(field.notes),
        ]),
      ),
    ].join("\n");
  }).join("\n\n");
}

/* ------------------------------------------------------------------ *
 * Blocks
 * ------------------------------------------------------------------ */

export const GENERATED_BLOCKS = {
  rules: renderRules,
  modules: renderModules,
  templates: renderTemplates,
  defects: renderDefects,
  coverage: renderCoverage,
} as const;

export type GeneratedBlock = keyof typeof GENERATED_BLOCKS;

/**
 * Replaces the content between `<!-- generated:<name> -->` and
 * `<!-- /generated:<name> -->` with the rendered block. Throws when a
 * marker is missing, so a test fails instead of silently skipping it.
 */
export function replaceGeneratedBlocks(document: string): string {
  let result = document;
  for (const [name, render] of Object.entries(GENERATED_BLOCKS)) {
    const start = `<!-- generated:${name} -->`;
    const end = `<!-- /generated:${name} -->`;
    const from = result.indexOf(start);
    const to = result.indexOf(end);
    if (from === -1 || to === -1 || to < from) throw new Error(`docs/DATA_DICTIONARY.md lacks the ${name} block markers`);
    result = `${result.slice(0, from + start.length)}\n\n${render()}\n\n${result.slice(to)}`;
  }
  return result;
}
