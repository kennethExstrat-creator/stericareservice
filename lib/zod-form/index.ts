// Forms generated from zod schemas: describe a schema (describe.ts), draw it
// (schema-form.tsx), check it with the schema's own messages (issues.ts).
// The template editor built every module's config form with it until Admin >
// Templates went (Kenneth, 26 October 2026); nothing in here knows about
// templates, so any zod schema of plain JSON works.
export {
  describeSchema,
  unitOf,
  FORM_UNITS,
  type ArrayNode,
  type BooleanNode,
  type DescribeOptions,
  type EnumNode,
  type FormMarker,
  type FormNode,
  type FormNodeKind,
  type FormOption,
  type FormProperty,
  type FormScalar,
  type JsonNode,
  type LiteralNode,
  type NullableNode,
  type NumberNode,
  type ObjectNode,
  type RecordKey,
  type RecordNode,
  type StringNode,
  type UnionNode,
  type UnionVariant,
} from "./describe";
export {
  countIssuesUnder,
  friendlyMessage,
  issuesAt,
  issuesByPath,
  NO_ISSUES,
  parseWithMessages,
  pathFromKey,
  pathKey,
  type FormIssues,
  type FormPath,
} from "./issues";
export {
  fieldLabel,
  humanize,
  humanizeValue,
  itemLabel,
  numberRange,
  optionText,
  pathLabels,
  recordKeyLabel,
  singularLabel,
  type KeyOption,
  type NamingHooks,
} from "./labels";
export {
  deepEqual,
  emptyObject,
  emptyValue,
  emptyVariant,
  getAt,
  isPlainObject,
  moveItem,
  optionIndex,
  setAt,
  variantOf,
  type FormValue,
} from "./values";
