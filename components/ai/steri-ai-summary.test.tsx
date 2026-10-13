// The Steri-AI Summary button (docs/AI.md, "Steri-AI Summary"): its rules
// without a browser (steri-ai-summary-state.ts), then the markup of each
// state. The repo has no DOM test environment, so the calls are driven
// through performSummaryRun with a fake screen, and the components are
// rendered on the server from a built model. e2e covers the live screen.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RichTextInsertResult } from "@/components/qc/rich-text-editor";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import { summaryTextHash } from "@/lib/inspections/capture/summary-basis";
import { richTextPlain } from "@/lib/rich-text";
import { RICH_TEXT_MAX_CHARACTERS, type RichTextDoc } from "@/lib/schemas/rich-text";
import { SUMMARY_MESSAGES, type SummaryDraftSuccess, type SummaryMenu, type SummaryOptions } from "@/lib/schemas/summary-style";
import {
  ReplaceDialogBody,
  SteriAiSummaryButton,
  SteriAiSummaryStatus,
  SummaryOptionsForm,
  type SteriAiSummary,
} from "./steri-ai-summary";
import {
  allowedChoices,
  applyDraft,
  createDeviceStore,
  figuresLine,
  fitsBelow,
  INITIAL_SUMMARY_STATE,
  markHolds,
  markLine,
  parseMark,
  performSummaryRun,
  placementFor,
  regenerateOptions,
  requestOptions,
  shownChoices,
  storedChoices,
  summaryDraftKey,
  summaryOptionsKey,
  summaryReducer,
  summaryStatus,
  SUMMARY_TEXT,
  textHashOf,
  withChoice,
  type SummaryAction,
  type SummaryMark,
  type SummaryRunIO,
  type SummaryState,
  type SummaryStatusView,
} from "./steri-ai-summary-state";

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const MENU: SummaryMenu = {
  length: "standard",
  paragraphs: "auto",
  format: "paragraphs",
  language: "en-GB",
  languagesOffered: ["en-GB"],
  inspectorsCanAdjust: true,
};
const WIDER: SummaryMenu = { ...MENU, languagesOffered: ["en-GB", "ms", "zh-Hans"] };
const LOCKED: SummaryMenu = { ...MENU, inspectorsCanAdjust: false };

function doc(...paragraphs: string[]): RichTextDoc {
  return { type: "doc", content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })) };
}

const DRAFT_DOC: RichTextDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "The inspection concluded " },
        { type: "text", text: "PASSED", marks: [{ type: "bold" }] },
        { type: "text", text: ". The watertight test found 6 holes in 500 gloves." },
      ],
    },
  ],
};
const DRAFT_HASH = summaryTextHash(richTextPlain(DRAFT_DOC));

function draft(overrides: Partial<SummaryDraftSuccess> = {}): SummaryDraftSuccess {
  return {
    ok: true,
    mode: "write",
    doc: DRAFT_DOC,
    text: richTextPlain(DRAFT_DOC),
    notes: ["The remark is blank although the conclusion differs from the suggested result."],
    figures: ["2,900"],
    words: 17,
    model: "claude-sonnet-5-5",
    basis: "00000000000000aa",
    ...overrides,
  };
}

function mark(overrides: Partial<SummaryMark> = {}): SummaryMark {
  return {
    textHash: DRAFT_HASH,
    basis: "00000000000000aa",
    model: "claude-sonnet-5-5",
    notes: [],
    figures: [],
    at: 1_760_000_000_000,
    mode: "write",
    words: 17,
    unit: "words",
    whole: true,
    options: {},
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** A fake screen for performSummaryRun: what it inserted, kept and said, and the state those actions add up to. */
function fakeScreen({
  value = null,
  kept = null,
  menu = MENU,
  answer = Promise.resolve(draft()),
  applies = true,
}: {
  value?: RichTextDoc | null;
  kept?: SummaryMark | null;
  menu?: SummaryMenu;
  answer?: Promise<SummaryDraftSuccess | { ok: false; reason: "error" | "not_connected"; message: string }>;
  applies?: boolean;
} = {}) {
  const actions: SummaryAction[] = [];
  const inserts: { doc: RichTextDoc | null; mode: string }[] = [];
  const marks: SummaryMark[] = [];
  const asked: SummaryOptions[] = [];
  let current = true;
  const io: SummaryRunIO = {
    menu,
    draft: (options) => {
      asked.push(options);
      return answer;
    },
    isCurrent: () => current,
    field: () => ({ value, mark: kept }),
    insert: (inserted, mode): RichTextInsertResult => {
      inserts.push({ doc: inserted, mode });
      if (!applies) return { applied: false };
      const after = mode === "below" && value ? { type: "doc" as const, content: [...value.content, { type: "paragraph" as const }, ...(inserted?.content ?? [])] } : inserted;
      return { applied: true, cut: false, before: value, after };
    },
    keepMark: (next) => marks.push(next),
    dispatch: (action) => actions.push(action),
    now: () => 1_760_000_000_000,
  };
  const state = () => actions.reduce(summaryReducer, INITIAL_SUMMARY_STATE);
  return { io, actions, inserts, marks, asked, state, stopWaiting: () => (current = false) };
}

/* ------------------------------------------------------------------ *
 * The menu's choices
 * ------------------------------------------------------------------ */

describe("the menu's choices", () => {
  it("keeps only what the house style allows now, and nothing equal to it", () => {
    expect(allowedChoices({ length: "brief", paragraphs: 3, format: "bullets", language: "ms" }, MENU)).toEqual({
      length: "brief",
      paragraphs: 3,
      format: "bullets",
    });
    expect(allowedChoices({ length: "standard", paragraphs: "auto", format: "paragraphs" }, MENU)).toEqual({});
    expect(allowedChoices({ length: "huge", paragraphs: "3", format: 7, extra: true }, MENU)).toEqual({});
    // A language only when two or more are offered, and only an offered one.
    expect(allowedChoices({ language: "ms" }, WIDER)).toEqual({ language: "ms" });
    expect(allowedChoices({ language: "en-US" }, WIDER)).toEqual({});
    // Locked: nothing from the menu applies, the language included.
    expect(allowedChoices({ length: "brief", language: "ms" }, { ...WIDER, inspectorsCanAdjust: false })).toEqual({});
    expect(allowedChoices(null, MENU)).toEqual({});
    expect(allowedChoices(["brief"], MENU)).toEqual({});
  });

  it("reads the device's value, ignoring what it cannot read", () => {
    expect(storedChoices('{"length":"detailed"}', MENU)).toEqual({ length: "detailed" });
    expect(storedChoices("not json", MENU)).toEqual({});
    expect(storedChoices(null, MENU)).toEqual({});
  });

  it("drops a choice set back to the house style's, so it follows the house style again", () => {
    const brief = withChoice({}, "length", "brief", MENU);
    expect(brief).toEqual({ length: "brief" });
    expect(withChoice(brief, "length", "standard", MENU)).toEqual({});
    expect(shownChoices(MENU, brief)).toEqual({ length: "brief", paragraphs: "auto", format: "paragraphs", language: "en-GB" });
  });

  it("asks with the choices and a trimmed note, leaving a blank note out", () => {
    expect(requestOptions("write", { length: "brief" }, "  The factory agreed to re-sort size M.  ")).toEqual({
      mode: "write",
      length: "brief",
      note: "The factory agreed to re-sort size M.",
    });
    expect(requestOptions("polish", {}, "   ")).toEqual({ mode: "polish" });
  });

  it("keys the device's values per user, and the mark per inspection and user", () => {
    expect(summaryOptionsKey("u1")).toBe("stericare:summary-options:v1:u1");
    expect(summaryDraftKey("i1", "u1")).toBe("stericare:summary-draft:v1:i1:u1");
  });
});

/* ------------------------------------------------------------------ *
 * The device
 * ------------------------------------------------------------------ */

describe("what the device keeps", () => {
  it("reads and writes localStorage and tells this page's readers", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
    values.set("a", "kept before");
    const store = createDeviceStore(() => storage);
    expect(store.read("a")).toBe("kept before");
    let told = 0;
    const stop = store.subscribe(() => (told += 1));
    store.write("b", "new");
    expect(values.get("b")).toBe("new");
    store.write("b", null);
    expect(values.has("b")).toBe(false);
    expect(store.read("b")).toBeNull();
    stop();
    store.write("c", "x");
    expect(told).toBe(2);
    expect(store.read(null)).toBeNull();
  });

  it("copes when localStorage throws or is missing: this page still sees what it wrote", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    const store = createDeviceStore(() => throwing);
    expect(store.read("mark")).toBeNull();
    expect(() => store.write("mark", "value")).not.toThrow();
    expect(store.read("mark")).toBe("value");
    const missing = createDeviceStore(() => {
      throw new Error("no window");
    });
    expect(missing.read("mark")).toBeNull();
    missing.write("mark", "value");
    expect(missing.read("mark")).toBe("value");
  });
});

/* ------------------------------------------------------------------ *
 * The mark
 * ------------------------------------------------------------------ */

describe("the Drafted by Steri-AI mark", () => {
  it("reads only a mark this build understands", () => {
    expect(parseMark(JSON.stringify(mark()))).toEqual(mark());
    expect(parseMark(JSON.stringify({ ...mark(), later: "a key added by a later build" }))).toEqual(mark());
    expect(parseMark(JSON.stringify({ ...mark(), textHash: "not a hash" }))).toBeNull();
    expect(parseMark(JSON.stringify({ ...mark(), notes: ["1", "2", "3", "4"] }))).toBeNull();
    expect(parseMark("{")).toBeNull();
    expect(parseMark(null)).toBeNull();
    // Choices it can no longer read are dropped, the mark kept.
    expect(parseMark(JSON.stringify({ ...mark(), options: { length: "huge" } }))?.options).toEqual({});
  });

  it("stays while the plain text is unchanged, formatting included, and goes with any change of wording", () => {
    const plain = doc("The inspection concluded PASSED. The watertight test found 6 holes in 500 gloves.");
    expect(markHolds(mark(), textHashOf(DRAFT_DOC))).toBe(true);
    // Bold taken off: the same words.
    expect(markHolds(mark(), textHashOf(plain))).toBe(true);
    expect(markHolds(mark(), textHashOf(doc("The inspection concluded PASSED. The watertight test found 7 holes in 500 gloves.")))).toBe(false);
    expect(markHolds(mark(), textHashOf(null))).toBe(false);
    expect(markHolds(null, textHashOf(DRAFT_DOC))).toBe(false);
    expect(textHashOf({ type: "doc", content: [{ type: "paragraph" }] })).toBeNull();
  });

  it("says who drafted it and how long it is", () => {
    expect(markLine(mark({ words: 152 }))).toBe("Drafted by Steri-AI · 152 words. Check it before you sign.");
    expect(markLine(mark({ words: 1_204 }))).toBe("Drafted by Steri-AI · 1,204 words. Check it before you sign.");
    expect(markLine(mark({ mode: "polish", words: 160 }))).toBe("Polished by Steri-AI · 160 words. Check it before you sign.");
    expect(markLine(mark({ whole: false, words: 1 }))).toBe("Drafted by Steri-AI and added below · 1 word. Check it before you sign.");
    expect(markLine(mark({ unit: "characters", words: 300 }))).toBe("Drafted by Steri-AI · 300 characters. Check it before you sign.");
    expect(figuresLine(["2,900", "17%"])).toBe(
      "Check these figures before you sign: 2,900, 17%. Steri-AI did not find them in the inspection.",
    );
  });
});

/* ------------------------------------------------------------------ *
 * Where a draft goes
 * ------------------------------------------------------------------ */

describe("where a draft goes", () => {
  it("fills an empty field, replaces Steri-AI's own unedited draft and polishes in place; otherwise asks", () => {
    expect(placementFor("write", null, null)).toBe("replace");
    expect(placementFor("write", { type: "doc", content: [{ type: "paragraph" }] }, null)).toBe("replace");
    expect(placementFor("write", DRAFT_DOC, mark())).toBe("replace");
    expect(placementFor("write", doc("My own words."), mark())).toBe("ask");
    expect(placementFor("write", doc("My own words."), null)).toBe("ask");
    // Added below the inspector's text: the field is not all Steri-AI's.
    expect(placementFor("write", DRAFT_DOC, mark({ whole: false }))).toBe("ask");
    // Polished: the inspector's facts in Steri-AI's wording, so a new draft asks first.
    expect(placementFor("write", DRAFT_DOC, mark({ mode: "polish" }))).toBe("ask");
    expect(placementFor("polish", DRAFT_DOC, mark({ mode: "polish" }))).toBe("replace");
    expect(placementFor("polish", doc("My own words."), null)).toBe("replace");
  });

  it("asks with the draft as written and puts it in as written (the field spaces its paragraphs)", async () => {
    const two = doc("The inspection concluded PASSED.", "Weight passed with a warning.");
    const screen = fakeScreen({ answer: Promise.resolve(draft({ doc: two })) });
    await performSummaryRun(screen.io, 1, { mode: "write" });
    expect(screen.inserts[0].doc).toEqual(two);
    const asking = fakeScreen({ value: doc("My own words."), answer: Promise.resolve(draft({ doc: two })) });
    await performSummaryRun(asking.io, 1, { mode: "write" });
    expect(asking.state().asking?.draft.doc).toEqual(two);
  });

  it("refuses Add Below past the field's 5,000 characters", () => {
    const draftLength = richTextPlain(DRAFT_DOC).length;
    expect(fitsBelow(doc("x".repeat(RICH_TEXT_MAX_CHARACTERS - draftLength)), DRAFT_DOC)).toBe(true);
    expect(fitsBelow(doc("x".repeat(RICH_TEXT_MAX_CHARACTERS - draftLength + 1)), DRAFT_DOC)).toBe(false);
    expect(fitsBelow(null, DRAFT_DOC)).toBe(true);
  });

  it("writes again with the same choices, or one length shorter or longer with paragraphs back on Auto", () => {
    const written = mark({ options: { length: "standard", paragraphs: 3, format: "bullets" } });
    expect(regenerateOptions(written, "again", MENU, "")).toEqual({ mode: "write", length: "standard", paragraphs: 3, format: "bullets" });
    expect(regenerateOptions(written, "shorter", MENU, "")).toEqual({ mode: "write", length: "brief", paragraphs: "auto", format: "bullets" });
    expect(regenerateOptions(written, "longer", MENU, "Re-sort agreed.")).toEqual({
      mode: "write",
      length: "detailed",
      paragraphs: "auto",
      format: "bullets",
      note: "Re-sort agreed.",
    });
    // Written in the house style: from the house length.
    expect(regenerateOptions(mark(), "shorter", MENU, "").length).toBe("brief");
  });
});

/* ------------------------------------------------------------------ *
 * A call
 * ------------------------------------------------------------------ */

describe("a call", () => {
  it("fills an empty field at once, keeps the mark on the device and says so", async () => {
    const screen = fakeScreen();
    await performSummaryRun(screen.io, 1, { mode: "write" });
    expect(screen.inserts).toEqual([{ doc: DRAFT_DOC, mode: "replace" }]);
    expect(screen.marks).toEqual([
      mark({ notes: draft().notes, figures: ["2,900"], at: 1_760_000_000_000, options: {} }),
    ]);
    const state = screen.state();
    expect(state.run).toBeNull();
    expect(state.announcement).toBe(SUMMARY_TEXT.wrote);
    expect(state.notes).toEqual({ notes: draft().notes, figures: ["2,900"], cut: false });
    expect(state.undo).toEqual({ before: null, textHash: DRAFT_HASH });
  });

  it("asks once the draft is ready when the field holds the inspector's text, and puts in nothing", async () => {
    const screen = fakeScreen({ value: doc("My own words.") });
    await performSummaryRun(screen.io, 1, { mode: "write", length: "brief" });
    expect(screen.inserts).toEqual([]);
    expect(screen.marks).toEqual([]);
    expect(screen.state().asking).toEqual({ id: 1, options: { mode: "write", length: "brief" }, draft: draft() });
  });

  it("replaces Steri-AI's own unedited draft without asking (Shorter)", async () => {
    const shorter = regenerateOptions(mark(), "shorter", MENU, "");
    const screen = fakeScreen({ value: DRAFT_DOC, kept: mark() });
    await performSummaryRun(screen.io, 4, shorter);
    expect(screen.asked).toEqual([{ mode: "write", length: "brief", paragraphs: "auto" }]);
    expect(screen.inserts).toEqual([{ doc: DRAFT_DOC, mode: "replace" }]);
    expect(screen.state().asking).toBeNull();
    expect(screen.marks[0].options).toEqual({ length: "brief", paragraphs: "auto" });
  });

  it("then Replace or Add Below, each one insert through the editor; Add Below's mark is not the whole field", async () => {
    const mine = doc("My own words.");
    const screen = fakeScreen({ value: mine });
    await performSummaryRun(screen.io, 1, { mode: "write" });
    const asking = screen.state().asking!;
    applyDraft(screen.io, asking, "below");
    expect(screen.inserts).toEqual([{ doc: DRAFT_DOC, mode: "below" }]);
    expect(screen.marks[0].whole).toBe(false);
    expect(screen.state().asking).toBeNull();
    expect(screen.state().undo?.before).toEqual(mine);

    const again = fakeScreen({ value: mine });
    await performSummaryRun(again.io, 1, { mode: "write" });
    applyDraft(again.io, again.state().asking!, "replace");
    expect(again.inserts).toEqual([{ doc: DRAFT_DOC, mode: "replace" }]);
    expect(again.marks[0].whole).toBe(true);
  });

  it("keeps the field when Replace Your Summary? is cancelled", async () => {
    const screen = fakeScreen({ value: doc("My own words.") });
    await performSummaryRun(screen.io, 1, { mode: "write" });
    const state = summaryReducer(screen.state(), { type: "kept" });
    expect(state.asking).toBeNull();
    expect(screen.inserts).toEqual([]);
  });

  it("drops an answer that comes after Cancel", async () => {
    const answer = deferred<SummaryDraftSuccess>();
    const screen = fakeScreen({ answer: answer.promise });
    const run = performSummaryRun(screen.io, 1, { mode: "write" });
    expect(screen.state().run).toEqual({ id: 1, options: { mode: "write" }, slow: false });
    screen.stopWaiting();
    screen.actions.push({ type: "cancelled" });
    answer.resolve(draft());
    await run;
    expect(screen.inserts).toEqual([]);
    expect(screen.marks).toEqual([]);
    expect(screen.state().run).toBeNull();
    // Still what Cancel said: the late answer adds nothing.
    expect(screen.state().announcement).toBe(SUMMARY_TEXT.cancelled);
  });

  it("shows the server's message with Try Again, and changes nothing", async () => {
    const screen = fakeScreen({ answer: Promise.resolve({ ok: false, reason: "not_connected", message: SUMMARY_MESSAGES.notConnected }) });
    await performSummaryRun(screen.io, 1, { mode: "write", note: "Re-sort agreed." });
    expect(screen.inserts).toEqual([]);
    expect(screen.state().error).toEqual({ message: SUMMARY_MESSAGES.notConnected, retry: { mode: "write", note: "Re-sort agreed." } });
  });

  it("says the server could not be reached when the call itself fails, and when the editor takes nothing", async () => {
    const broken = fakeScreen({ answer: Promise.reject(new Error("network")) });
    await performSummaryRun(broken.io, 1, { mode: "write" });
    expect(broken.state().error?.message).toBe(SUMMARY_MESSAGES.unreachable);

    const refused = fakeScreen({ applies: false });
    await performSummaryRun(refused.io, 1, { mode: "write" });
    expect(refused.marks).toEqual([]);
    expect(refused.state().error?.message).toBe(SUMMARY_TEXT.notPutIn);
  });

  it("counts Chinese in characters", async () => {
    const screen = fakeScreen({ menu: WIDER });
    await performSummaryRun(screen.io, 1, { mode: "write", language: "zh-Hans" });
    expect(screen.marks[0].unit).toBe("characters");
    const house = fakeScreen({ menu: LOCKED });
    await performSummaryRun(house.io, 1, { mode: "write", language: "zh-Hans" });
    expect(house.marks[0].unit).toBe("words");
  });

  it("follows only the call on screen", () => {
    const writing = summaryReducer(INITIAL_SUMMARY_STATE, { type: "started", id: 2, options: { mode: "write" } });
    expect(summaryReducer(writing, { type: "slow", id: 1 })).toBe(writing);
    expect(summaryReducer(writing, { type: "slow", id: 2 }).run?.slow).toBe(true);
    expect(summaryReducer(writing, { type: "failed", id: 1, message: "late" })).toBe(writing);
    expect(summaryReducer(writing, { type: "dropped", id: 1 })).toBe(writing);
    expect(summaryReducer(writing, { type: "asked", id: 1, draft: draft() })).toBe(writing);
    const blocked = summaryReducer(INITIAL_SUMMARY_STATE, { type: "blocked", notice: "offline", message: SUMMARY_MESSAGES.offline });
    expect(blocked.notice).toEqual({ kind: "offline", message: SUMMARY_MESSAGES.offline });
    expect(summaryReducer(blocked, { type: "started", id: 3, options: { mode: "write" } }).notice).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * The status line
 * ------------------------------------------------------------------ */

function status(input: Partial<Parameters<typeof summaryStatus>[0]> = {}): SummaryStatusView {
  return summaryStatus({
    state: INITIAL_SUMMARY_STATE,
    menu: MENU,
    online: true,
    needsResult: false,
    mark: null,
    textHash: null,
    basisNow: () => "00000000000000aa",
    ...input,
  });
}

describe("the status line", () => {
  it("shows only the progress while Steri-AI writes", () => {
    const state = summaryReducer(INITIAL_SUMMARY_STATE, { type: "started", id: 1, options: { mode: "write" } });
    expect(status({ state, mark: mark(), textHash: DRAFT_HASH })).toEqual({ activity: { kind: "writing", slow: false }, mark: null, notes: null });
  });

  it("says why a press did nothing while that still holds", () => {
    const offline = summaryReducer(INITIAL_SUMMARY_STATE, { type: "blocked", notice: "offline", message: SUMMARY_MESSAGES.offline });
    expect(status({ state: offline, online: false }).activity).toEqual({ kind: "notice", message: SUMMARY_MESSAGES.offline });
    expect(status({ state: offline, online: true }).activity).toBeNull();
    const needs = summaryReducer(INITIAL_SUMMARY_STATE, { type: "blocked", notice: "needs_result", message: "Choose PASSED, FAILED or HOLD first: the summary starts with the conclusion." });
    expect(status({ state: needs, needsResult: true }).activity?.kind).toBe("notice");
    expect(status({ state: needs, needsResult: false }).activity).toBeNull();
  });

  it("shows the mark with Shorter, Longer, Write Again and Undo while the draft is unedited", () => {
    const state: SummaryState = { ...INITIAL_SUMMARY_STATE, undo: { before: null, textHash: DRAFT_HASH } };
    expect(status({ state, mark: mark({ words: 152 }), textHash: DRAFT_HASH }).mark).toEqual({
      line: "Drafted by Steri-AI · 152 words. Check it before you sign.",
      stale: false,
      shorter: "on",
      longer: "on",
      writeAgain: true,
      undo: true,
    });
    // Unavailable at the ends, focusable all the same.
    expect(status({ mark: mark({ options: { length: "brief" } }), textHash: DRAFT_HASH }).mark).toMatchObject({ shorter: "off", longer: "on", undo: false });
    expect(status({ mark: mark({ options: { length: "detailed" } }), textHash: DRAFT_HASH }).mark).toMatchObject({ shorter: "on", longer: "off" });
    // Locked by the admin: no Shorter or Longer.
    expect(status({ menu: LOCKED, mark: mark(), textHash: DRAFT_HASH }).mark).toMatchObject({ shorter: null, longer: null, writeAgain: true });
    // Polished, or added below: only Undo.
    expect(status({ mark: mark({ mode: "polish" }), textHash: DRAFT_HASH }).mark).toMatchObject({ shorter: null, longer: null, writeAgain: false });
    expect(status({ mark: mark({ whole: false }), textHash: DRAFT_HASH }).mark).toMatchObject({ shorter: null, writeAgain: false });
  });

  it("goes as soon as the text is edited", () => {
    expect(status({ mark: mark(), textHash: summaryTextHash("Something else.") }).mark).toBeNull();
  });

  it("says when the inspection changed after the draft was written, with Write Again", () => {
    expect(status({ mark: mark(), textHash: DRAFT_HASH, basisNow: () => "00000000000000bb" }).mark).toEqual({
      line: SUMMARY_TEXT.stale,
      stale: true,
      shorter: null,
      longer: null,
      writeAgain: true,
      undo: false,
    });
  });

  it("shows the draft's notes and figures until dismissed, edited or not; after a reload while unedited", () => {
    const notes = { notes: ["The remark is blank."], figures: ["2,900"], cut: false };
    const state: SummaryState = { ...INITIAL_SUMMARY_STATE, notes };
    expect(status({ state, mark: mark(), textHash: summaryTextHash("Edited.") }).notes).toEqual(notes);
    expect(status({ mark: mark({ notes: ["The remark is blank."] }), textHash: DRAFT_HASH }).notes).toEqual({
      notes: ["The remark is blank."],
      figures: [],
      cut: false,
    });
    expect(status({ mark: mark({ notes: ["The remark is blank."] }), textHash: summaryTextHash("Edited.") }).notes).toBeNull();
    expect(summaryReducer(state, { type: "dismissed" }).notes).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * The markup
 * ------------------------------------------------------------------ */

function model(overrides: Partial<SteriAiSummary> = {}): SteriAiSummary {
  const noop = () => {};
  return {
    shown: true,
    writing: false,
    online: true,
    needsResult: false,
    hasText: false,
    menu: MENU,
    choices: shownChoices(MENU, {}),
    note: "",
    setNote: noop,
    choose: noop,
    resetChoices: noop,
    write: noop,
    polish: noop,
    regenerate: noop,
    undo: noop,
    cancel: noop,
    retry: noop,
    dismissNotes: noop,
    asking: null,
    fitsBelow: true,
    replace: noop,
    addBelow: noop,
    keep: noop,
    status: { activity: null, mark: null, notes: null },
    announcement: "",
    statusId: "summary-status",
    describedBy: undefined,
    writeBlocked: null,
    buttonId: "summary-button",
    focusButton: noop,
    ...overrides,
  };
}

const buttonTags = (html: string) => html.match(/<button[^>]*>/g) ?? [];
/** The attribute, not the classes that style it. */
const UNAVAILABLE = /\saria-disabled="true"/;
/** As React writes text into HTML. */
const escaped = (text: string) => text.replaceAll("'", "&#x27;");
/** A whole button, by the words it ends with (after its icon). */
const buttonNamed = (html: string, name: string) =>
  [...html.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]).find((button) => button.endsWith(`${name}</button>`));

describe("the button", () => {
  it("is a split pill named Steri-AI Summary: the main part, and the menu behind a chevron", () => {
    const html = renderToStaticMarkup(<SteriAiSummaryButton summary={model()} />);
    expect(html).toMatch(/^<div role="group" aria-label="Steri-AI Summary" data-slot="steri-ai-summary"/);
    const [main, chevron] = buttonTags(html);
    expect(main).toContain('data-action="steri-ai-summary"');
    expect(main).not.toMatch(UNAVAILABLE);
    expect(chevron).toContain('aria-label="Summary Options"');
    expect(chevron).toContain('aria-haspopup="dialog"');
    expect(chevron).toContain('aria-expanded="false"');
    // 32 px with a mouse, 44 px on any touchscreen.
    for (const tag of [main, chevron]) expect(tag).toMatch(/\bh-8\b[\s\S]*\btouch:h-11\b/);
    expect(chevron).toMatch(/\bw-8\b[\s\S]*\btouch:w-11\b/);
  });

  it("greys out but stays focusable offline and before the conclusion, and spins while writing", () => {
    for (const summary of [model({ online: false }), model({ needsResult: true })]) {
      const [main] = buttonTags(renderToStaticMarkup(<SteriAiSummaryButton summary={summary} />));
      expect(main).toContain('aria-disabled="true"');
      expect(main).not.toMatch(/\sdisabled=""/);
    }
    const writing = renderToStaticMarkup(<SteriAiSummaryButton summary={model({ writing: true, describedBy: "summary-status" })} />);
    const [main] = buttonTags(writing);
    expect(main).toContain('aria-busy="true"');
    expect(main).toContain('aria-describedby="summary-status"');
    expect(writing).toContain('<span class="col-start-1 row-start-1 invisible">Steri-AI Summary</span>');
    expect(writing).toContain('<span class="col-start-1 row-start-1">Writing…</span>');
  });
});

describe("Summary Options", () => {
  it("offers Length, Paragraphs and Format, Language only when two or more are offered, and the note", () => {
    const html = renderToStaticMarkup(<SummaryOptionsForm summary={model()} onDone={() => {}} />);
    for (const label of ["Length", "Paragraphs", "Format", "Note for Steri-AI (Optional)"]) expect(html).toContain(`>${label}<`);
    expect(html).not.toContain(">Language<");
    expect(html).toContain("Brief</button>");
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>Standard<\/button>/);
    expect(html).toContain("0 of 300");
    expect(html).toContain('maxLength="300"');
    expect(buttonNamed(html, "Write Summary")).not.toMatch(UNAVAILABLE);
    expect(html).toContain(">Reset to House Style<");
    // An empty field has nothing to polish.
    expect(html).not.toContain("Polish My Text");
    const wider = renderToStaticMarkup(<SummaryOptionsForm summary={model({ menu: WIDER, choices: shownChoices(WIDER, {}) })} onDone={() => {}} />);
    expect(wider).toContain(">Language<");
  });

  it("shows only the note and the buttons, with one line, while the house style is locked", () => {
    const html = renderToStaticMarkup(<SummaryOptionsForm summary={model({ menu: { ...WIDER, inspectorsCanAdjust: false } })} onDone={() => {}} />);
    expect(html).toContain("Length, paragraphs and format follow SteriCare&#x27;s house style.");
    for (const label of [">Length<", ">Paragraphs<", ">Format<", ">Language<", "Reset to House Style"]) expect(html).not.toContain(label);
    expect(html).toContain(">Note for Steri-AI (Optional)<");
    expect(html).toContain(">Write Summary<");
  });

  it("offers Polish My Text with its hint when the field has text, and says why Write Summary waits", () => {
    const html = renderToStaticMarkup(
      <SummaryOptionsForm
        summary={model({ hasText: true, needsResult: true, writeBlocked: "Choose PASSED, FAILED or HOLD first: the summary starts with the conclusion." })}
        onDone={() => {}}
      />,
    );
    expect(buttonNamed(html, "Polish My Text")).not.toMatch(UNAVAILABLE);
    expect(html).toContain("Keeps your facts and figures, fixes the wording and adds nothing. Formatting other than bold and lists is reset.");
    expect(buttonNamed(html, "Write Summary")).toContain('aria-disabled="true"');
    expect(html).toContain("Choose PASSED, FAILED or HOLD first: the summary starts with the conclusion.");
  });

  it("is 44 px on touch: the length's choices, the selects and the buttons", () => {
    const html = renderToStaticMarkup(<SummaryOptionsForm summary={model({ hasText: true })} onDone={() => {}} />);
    for (const tag of buttonTags(html)) {
      expect(tag, tag).toMatch(/touch:h-11|touch:data-\[size=sm\]:h-11/);
    }
  });

  it("names every label in Title Case (docs/DESIGN.md)", () => {
    const labels = [
      SUMMARY_TEXT.button,
      SUMMARY_TEXT.options,
      SUMMARY_TEXT.write,
      SUMMARY_TEXT.reset,
      SUMMARY_TEXT.dialogTitle,
      SUMMARY_TEXT.replace,
      SUMMARY_TEXT.addBelow,
      SUMMARY_TEXT.tryAgain,
      SUMMARY_TEXT.writeAgain,
      SUMMARY_TEXT.shorter,
      SUMMARY_TEXT.longer,
      SUMMARY_TEXT.undo,
      SUMMARY_TEXT.dismiss,
      SUMMARY_TEXT.cancel,
    ];
    expect(labels.filter((label) => lowerCaseWords(label).length > 0)).toEqual([]);
  });
});

describe("the status line's markup", () => {
  const render = (status: SummaryStatusView, overrides: Partial<SteriAiSummary> = {}) =>
    renderToStaticMarkup(<SteriAiSummaryStatus summary={model({ status, ...overrides })} />);

  it("is a live region from the start, empty", () => {
    const html = render({ activity: null, mark: null, notes: null });
    expect(html).toBe(
      '<div class="relative" data-slot="steri-ai-summary-status"><div id="summary-status" class="space-y-2 empty:hidden"></div><p class="sr-only" aria-live="polite" data-slot="steri-ai-summary-announcement"></p></div>',
    );
    expect(render({ activity: null, mark: null, notes: null }, { announcement: SUMMARY_TEXT.wrote })).toContain(
      `aria-live="polite" data-slot="steri-ai-summary-announcement">${SUMMARY_TEXT.wrote}</p>`,
    );
  });

  it("writes, then offers Cancel once it is slow", () => {
    expect(render({ activity: { kind: "writing", slow: false }, mark: null, notes: null })).toContain("Steri-AI is writing the summary…");
    const slow = render({ activity: { kind: "writing", slow: true }, mark: null, notes: null });
    expect(slow).toContain("Still writing. This can take up to a minute on a slow connection.");
    expect(buttonNamed(slow, "Cancel")).toMatch(/touch:h-11/);
  });

  it("shows a failure in red with Try Again", () => {
    const html = render({ activity: { kind: "error", message: SUMMARY_MESSAGES.checksFailed }, mark: null, notes: null });
    expect(html).toMatch(/class="[^"]*text-fail[^"]*"/);
    expect(html).toContain(escaped(SUMMARY_MESSAGES.checksFailed));
    expect(html).toContain("Try Again</button>");
  });

  it("shows the mark and its buttons, quiet and 44 px on touch, and the notes with the figures to check", () => {
    const html = render({
      activity: null,
      mark: { line: "Drafted by Steri-AI · 152 words. Check it before you sign.", stale: false, shorter: "off", longer: "on", writeAgain: true, undo: true },
      notes: { notes: ["The remark is blank although the conclusion differs from the suggested result."], figures: ["2,900", "17%"], cut: false },
    });
    expect(html).toContain("Drafted by Steri-AI · 152 words. Check it before you sign.");
    expect(buttonNamed(html, "Shorter")).toContain('aria-disabled="true"');
    expect(buttonNamed(html, "Longer")).not.toMatch(UNAVAILABLE);
    for (const name of ["Write Again", "Undo", "Dismiss"]) expect(buttonNamed(html, name), name).toBeDefined();
    for (const tag of buttonTags(html)) expect(tag).toMatch(/\btouch:h-11\b/);
    expect(html).toContain(">Before you sign:<");
    expect(html).toContain("<li>The remark is blank although the conclusion differs from the suggested result.</li>");
    expect(html).toContain("Check these figures before you sign: 2,900, 17%. Steri-AI did not find them in the inspection.");
  });

  it("says in amber that the inspection changed", () => {
    const html = render({ activity: null, mark: { line: SUMMARY_TEXT.stale, stale: true, shorter: null, longer: null, writeAgain: true, undo: false }, notes: null });
    expect(html).toMatch(/<p class="[^"]*text-warn[^"]*">[\s\S]*The inspection changed after Steri-AI wrote this summary\./);
    expect(buttonNamed(html, "Shorter")).toBeUndefined();
    expect(buttonNamed(html, "Write Again")).toBeDefined();
  });
});

describe("Replace Your Summary?", () => {
  it("shows the draft read-only, and why Add Below is unavailable past 5,000 characters", () => {
    const fits = renderToStaticMarkup(<ReplaceDialogBody draft={DRAFT_DOC} fitsBelow tooLongId="too-long" />);
    expect(fits).toMatch(/<div role="region" aria-label="Steri-AI&#x27;s draft" tabindex="0" class="max-h-64 overflow-y-auto[^"]*">/);
    expect(fits).toContain("<strong>PASSED</strong>");
    expect(fits).not.toContain("Too long to add below");
    const tooLong = renderToStaticMarkup(<ReplaceDialogBody draft={DRAFT_DOC} fitsBelow={false} tooLongId="too-long" />);
    expect(tooLong).toContain('<p id="too-long"');
    expect(tooLong).toContain("Too long to add below: the summary holds up to 5,000 characters.");
  });
});
