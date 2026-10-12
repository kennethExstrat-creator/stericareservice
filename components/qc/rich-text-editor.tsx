"use client";

// A paragraph field with formatting (the conclusion's Inspection Summary;
// Kenneth, 12 October 2026): Tiptap on ProseMirror with a 13-control toolbar,
// storing the allow-listed document of lib/schemas/rich-text.ts. Import it by
// its path, never through the kit's index, so Tiptap stays in the chunk of
// the Capture that uses it; no next/dynamic either, so the chunk the capture
// screen preloads holds the editor and it works offline.
//
// - Read-only (a submitted inspection, the moment saving starts, a conflict):
//   a grey box like a read-only Remark, RichTextView inside, no Tiptap, the
//   writing area's size and type.
// - Editable: a white frame, the toolbar sticking under the screen's bars
//   while the text scrolls under it, the writing area below: 16 px text on
//   relaxed lines, at least 320 px tall (260 px on a portrait screen) and
//   growing with the text. Until the editor exists (the server, tests, first
//   paint) the writing area shows RichTextView with the same classes, so
//   nothing moves.
// - Every change goes through toRichTextDoc and reaches onChange only when it
//   says something new: opening a draft never saves it. Data replaced from
//   outside (a merge) replaces the text, off the undo history; the editor's
//   own changes coming back, however late, never do.
// - The toolbar is one Tab stop (arrow keys inside, Radix Toolbar), its
//   groups split by short hairlines, in one row where it fits. Its buttons
//   keep the text's selection and the iPad keyboard (no focus on press); its
//   menus are popovers that leave the focus in the text when a finger opens
//   them. 32 px controls with a mouse, 44 px on any touchscreen.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type ChainedCommands, type Editor } from "@tiptap/react";
import { Toolbar as ToolbarPrimitive, ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import {
  ALargeSmallIcon,
  BaselineIcon,
  BoldIcon,
  CheckIcon,
  ChevronDownIcon,
  HighlighterIcon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  Redo2Icon,
  RemoveFormattingIcon,
  StrikethroughIcon,
  TextAlignCenterIcon,
  TextAlignEndIcon,
  TextAlignJustifyIcon,
  TextAlignStartIcon,
  UnderlineIcon,
  Undo2Icon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import {
  RICH_TEXT_COLOUR_NAME,
  RICH_TEXT_HIGHLIGHT_NAME,
  RICH_TEXT_SIZE_NAME,
  richTextKey,
  toRichTextDoc,
} from "@/lib/rich-text";
import {
  RICH_TEXT_COLOURS,
  RICH_TEXT_HIGHLIGHTS,
  RICH_TEXT_MAX_CHARACTERS,
  richTextLength,
  type RichTextAlign,
  type RichTextColour,
  type RichTextDoc,
  type RichTextHighlight,
  type RichTextSize,
} from "@/lib/schemas/rich-text";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toggleVariants } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { issuePathProps, type IssuePath } from "./issue-path";
import { StatusIcon } from "./status-icon";
import {
  RICH_TEXT_COLOUR_SWATCH,
  RICH_TEXT_CONTENT_CLASS,
  RICH_TEXT_HIGHLIGHT_CLASS,
  RICH_TEXT_SIZE_CLASS,
} from "./rich-text-classes";
import {
  alignToken,
  clearFormatting,
  colourToken,
  highlightToken,
  RICH_TEXT_EXTENSIONS,
  RICH_TEXT_FRAME_SLOT,
  RICH_TEXT_TOOLBAR_SLOT,
  sizeToken,
} from "./rich-text-extensions";
import { RichTextView } from "./rich-text-view";

export type RichTextEditorProps = {
  /** The stored document; null when nothing is written. */
  value: RichTextDoc | null;
  /** The canonical document after a change (toRichTextDoc); null when the text is cleared. */
  onChange: (doc: RichTextDoc | null) => void;
  /** The id of the field's label. */
  labelledBy?: string;
  readOnly?: boolean;
  /** Marks the text for issue links (useIssueFocus). */
  issuePath?: IssuePath | null;
  /** On the outer element: the frame, or the read-only box. */
  className?: string;
};

/** The counter shows from here on. */
const COUNTER_FROM = 4500;

/** Changes kept while the data has not come back with them; a screen renders each one, or a later one, at once. */
const MAX_UNCONFIRMED = 50;

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

/**
 * The writing area, the editor's and the first paint's alike, sized for
 * reading (Kenneth, 12 October 2026: the summary goes into the report): 16 px
 * text on every device, on relaxed lines (the content rules), with room
 * around it; at least 320 px tall on a landscape screen (a desktop, an iPad
 * held sideways) and 260 px on a portrait one, growing with the text. The
 * content rules come after the text size, so their line height stays, as in
 * RichTextView. ProseMirror's own rules stand in for the CSS Tiptap would
 * inject.
 */
const TEXT_AREA_CLASS = cn(
  "relative min-h-65 flex-1 px-4 py-3 text-base outline-none focus-ring-inset landscape:min-h-80 touch:px-5 touch:py-4",
  RICH_TEXT_CONTENT_CLASS,
  "[font-variant-ligatures:none] [&_img.ProseMirror-separator]:m-0! [&_img.ProseMirror-separator]:inline! [&_img.ProseMirror-separator]:size-0! [&_img.ProseMirror-separator]:border-0!",
);

/**
 * The grey box of a read-only field (as a read-only Remark), the writing
 * area's size and type: the text reads the same after submit, and the box
 * moves nothing when the editor takes its place.
 */
const READ_ONLY_CLASS =
  "min-h-65 rounded-md border border-input bg-muted px-4 py-3 text-base outline-none focus-ring-inset landscape:min-h-80 touch:px-5 touch:py-4";

/**
 * A toolbar control: 32 px with a mouse, 44 px on any touchscreen; pressed in
 * brand-100 with brand-700 (secondary); with nothing to do it greys out but
 * stays focusable (aria-disabled), as the signature pad's Undo does.
 */
const BUTTON = cn(
  toggleVariants({ size: "sm" }),
  "px-1.5 text-foreground aria-pressed:bg-secondary aria-pressed:text-secondary-foreground touch:[&_svg:not([class*='size-'])]:size-5",
  "aria-disabled:cursor-not-allowed aria-disabled:text-slate-400 aria-disabled:hover:bg-transparent aria-disabled:hover:text-slate-400",
);

/** A menu option: a full-width row with the current one checked. */
const OPTION =
  "flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-foreground outline-none select-none hover:bg-muted focus-ring-inset touch:h-11 touch:text-base data-[state=on]:font-medium";

type ToolbarState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  fontSize: RichTextSize | null;
  color: RichTextColour | null;
  highlight: RichTextHighlight | null;
  bulletList: boolean;
  orderedList: boolean;
  align: RichTextAlign | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Null until the editor exists. */
  characters: number | null;
};

const IDLE: ToolbarState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  fontSize: null,
  color: null,
  highlight: null,
  bulletList: false,
  orderedList: false,
  align: null,
  canUndo: false,
  canRedo: false,
  characters: null,
};

function readToolbarState(editor: Editor): ToolbarState {
  const style = editor.getAttributes("textStyle");
  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    underline: editor.isActive("underline"),
    strike: editor.isActive("strike"),
    fontSize: sizeToken(style.fontSize),
    color: colourToken(style.color),
    highlight: editor.isActive("highlight") ? (highlightToken(editor.getAttributes("highlight").color) ?? "yellow") : null,
    bulletList: editor.isActive("bulletList"),
    orderedList: editor.isActive("orderedList"),
    align: alignToken(editor.getAttributes("paragraph").textAlign),
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
    characters: editor.storage.characterCount.characters(),
  };
}

export function RichTextEditor({ readOnly = false, ...props }: RichTextEditorProps) {
  return readOnly ? <ReadOnlyRichText {...props} /> : <EditableRichText {...props} />;
}

function ReadOnlyRichText({ value, labelledBy, issuePath, className }: Omit<RichTextEditorProps, "readOnly" | "onChange">) {
  return (
    <div
      role="textbox"
      aria-readonly="true"
      aria-multiline="true"
      aria-labelledby={labelledBy}
      tabIndex={0}
      data-slot="rich-text-read-only"
      className={cn(READ_ONLY_CLASS, className)}
      {...issuePathProps(issuePath)}
    >
      <RichTextView doc={value} />
    </div>
  );
}

function EditableRichText({ value, onChange, labelledBy, issuePath, className }: Omit<RichTextEditorProps, "readOnly">) {
  const baseId = useId();
  const editorId = `${baseId}-text`;
  const counterId = `${baseId}-count`;
  // The document as the editor opened it, and the last one received or sent, in canonical form.
  const [opened] = useState(() => ({ content: value, key: richTextKey(value) }));
  const lastKey = useRef(opened.key);
  // Documents handed to onChange that the data has not come back with yet, oldest first.
  const sent = useRef<string[]>([]);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });

  const editorProps = useMemo(
    () => ({
      attributes: {
        id: editorId,
        role: "textbox",
        "aria-multiline": "true",
        ...(labelledBy ? { "aria-labelledby": labelledBy } : {}),
        // The counter, empty and hidden until 4,500 characters.
        "aria-describedby": counterId,
        // Issue links and Tab land on the text itself.
        tabindex: "0",
        class: TEXT_AREA_CLASS,
      },
    }),
    [editorId, labelledBy, counterId],
  );

  const editor = useEditor({
    extensions: RICH_TEXT_EXTENSIONS,
    content: opened.content ?? undefined,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    injectCSS: false,
    editorProps,
    onUpdate: ({ editor: current }) => {
      const next = toRichTextDoc(current.getJSON());
      const key = JSON.stringify(next);
      if (key === lastKey.current) return;
      lastKey.current = key;
      sent.current.push(key);
      if (sent.current.length > MAX_UNCONFIRMED) sent.current.shift();
      onChangeRef.current(next);
    },
  });

  // Data replaced from outside: the text follows, off the undo history and without a save of its own.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const key = richTextKey(value);
    // The editor's own change coming back, maybe after a later one was typed (a render that
    // lags the typing): never put back, which would undo the later letters and send the caret
    // to the end (setContent replaces the whole document).
    const own = sent.current.indexOf(key);
    if (own !== -1) {
      sent.current.splice(0, own + 1);
      return;
    }
    if (key === lastKey.current) return;
    sent.current = [];
    lastKey.current = key;
    editor.chain().setMeta("addToHistory", false).setContent(value ?? EMPTY_DOC, { emitUpdate: false }).run();
  }, [editor, value]);

  const state = useEditorState({ editor, selector: ({ editor: current }) => (current ? readToolbarState(current) : IDLE) }) ?? IDLE;
  const characters = state.characters ?? richTextLength(value ?? { content: [] });
  const showCounter = characters >= COUNTER_FROM;
  // Full: amber with the warning icon, never colour alone (docs/DESIGN.md), as the conclusion's differs note.
  const full = characters >= RICH_TEXT_MAX_CHARACTERS;

  return (
    <div data-slot={RICH_TEXT_FRAME_SLOT} className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex flex-1 flex-col rounded-md border border-input bg-card shadow-xs">
        <FormattingToolbar editor={editor} state={state} controls={editorId} />
        <div className="flex flex-1 flex-col" {...issuePathProps(issuePath)}>
          {editor ? (
            <EditorContent editor={editor} className="flex flex-1 flex-col" />
          ) : (
            <RichTextView doc={value} className={TEXT_AREA_CLASS} />
          )}
        </div>
      </div>
      <p
        id={counterId}
        hidden={!showCounter}
        className={cn("flex items-start justify-end gap-1.5 text-sm text-muted-foreground touch:text-base", full && "text-warn")}
      >
        {showCounter && full && <StatusIcon status="warn" className="mt-0.5 size-4 shrink-0 touch:mt-1" />}
        {showCounter ? `${formatCount(characters)} of ${formatCount(RICH_TEXT_MAX_CHARACTERS)} characters` : null}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The toolbar
 * ------------------------------------------------------------------ */

/** A shortcut as the keyboard shows it: ⌘ and ⇧ on a Mac or iPad, Ctrl and Shift elsewhere. */
type Shortcut = { mod?: boolean; shift?: boolean; key: string };

function shortcutText({ mod = true, shift = false, key }: Shortcut): string {
  const apple = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  if (apple) return `${shift ? "⇧" : ""}${mod ? "⌘" : ""}${key}`;
  return [mod ? "Ctrl" : null, shift ? "Shift" : null, key].filter(Boolean).join("+");
}

/** The name, and its shortcut beside it (tooltips open on hover and keyboard focus, never on touch). */
function Hint({ name, shortcut, children }: { name: string; shortcut?: Shortcut; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {name}
        {shortcut && <Kbd>{shortcutText(shortcut)}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

/** Keeps the text's focus, selection and the iPad keyboard when a control is pressed. */
const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

function ToolButton({
  name,
  icon: Icon,
  shortcut,
  pressed,
  disabled = false,
  onPress,
}: {
  name: string;
  icon: LucideIcon;
  shortcut?: Shortcut;
  /** Left out for an action (Undo, Clear Formatting): no aria-pressed. */
  pressed?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Hint name={name} shortcut={shortcut}>
      <ToolbarPrimitive.Button
        type="button"
        aria-label={name}
        aria-pressed={pressed}
        aria-disabled={disabled || undefined}
        className={BUTTON}
        onMouseDown={keepFocus}
        onClick={() => {
          if (!disabled) onPress();
        }}
      >
        <Icon aria-hidden />
      </ToolbarPrimitive.Button>
    </Hint>
  );
}

type MenuOption = {
  value: string;
  label: string;
  /** Before the label: a colour's dot, an alignment's icon. */
  preview?: ReactNode;
  /** The label's own look: a size shown at its size. */
  labelClassName?: string;
};

/**
 * A toolbar menu: a popover, not a dropdown menu (that always takes the
 * focus, and the iPad keyboard would close), holding one choice. Opened by a
 * finger or a pen it leaves the focus in the text; by a mouse or the keyboard
 * it focuses the checked option (arrow keys between them). A choice runs at
 * once, closes the menu and hands the focus back to the text; Escape hands it
 * back to the button.
 */
function ToolbarMenu({
  name,
  shortcut,
  trigger,
  options,
  current,
  editor,
  onChoose,
}: {
  name: string;
  shortcut?: Shortcut;
  trigger: ReactNode;
  options: readonly MenuOption[];
  current: string;
  editor: Editor | null;
  onChoose: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const openedByTouch = useRef(false);
  const chose = useRef(false);
  const content = useRef<HTMLDivElement>(null);

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <Hint name={name} shortcut={shortcut}>
        <PopoverTrigger asChild>
          <ToolbarPrimitive.Button
            type="button"
            aria-label={name}
            className={cn(BUTTON, "gap-0.5")}
            onMouseDown={keepFocus}
            onPointerDown={(event) => {
              openedByTouch.current = event.pointerType === "touch" || event.pointerType === "pen";
            }}
            onKeyDown={() => {
              openedByTouch.current = false;
            }}
          >
            {trigger}
            <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          </ToolbarPrimitive.Button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent
        ref={content}
        aria-label={name}
        align="start"
        className="w-auto min-w-44 gap-0 p-1 touch:min-w-52"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (openedByTouch.current) return;
          const options = content.current?.querySelectorAll<HTMLElement>('[role="radio"]');
          const checked = content.current?.querySelector<HTMLElement>('[role="radio"][data-state="on"]');
          (checked ?? options?.[0])?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (chose.current || openedByTouch.current) event.preventDefault();
          if (chose.current) editor?.commands.focus();
          chose.current = false;
        }}
      >
        <ToggleGroupPrimitive.Root type="single" orientation="vertical" value={current} aria-label={name} className="flex flex-col">
          {options.map((option) => (
            <ToggleGroupPrimitive.Item
              key={option.value}
              value={option.value}
              className={OPTION}
              onMouseDown={keepFocus}
              onClick={() => {
                chose.current = true;
                onChoose(option.value);
                setOpen(false);
              }}
            >
              {option.preview}
              <span className={cn("min-w-0 flex-1 truncate", option.labelClassName)}>{option.label}</span>
              <CheckIcon aria-hidden className={cn("size-4 shrink-0", option.value === current ? "text-foreground" : "invisible")} />
            </ToggleGroupPrimitive.Item>
          ))}
        </ToggleGroupPrimitive.Root>
      </PopoverContent>
    </Popover>
  );
}

/** A 3 px bar under a menu's icon, in the colour it applies now. */
function ColourBar({ className }: { className: string }) {
  return <span aria-hidden className={cn("h-[3px] w-4 rounded-full touch:w-5", className)} />;
}

/** Each shown at its size; Normal is no size. */
const SIZE_OPTIONS: readonly MenuOption[] = [
  { value: "small", label: RICH_TEXT_SIZE_NAME.small, labelClassName: RICH_TEXT_SIZE_CLASS.small },
  { value: "normal", label: "Normal" },
  { value: "large", label: RICH_TEXT_SIZE_NAME.large, labelClassName: RICH_TEXT_SIZE_CLASS.large },
  { value: "xlarge", label: RICH_TEXT_SIZE_NAME.xlarge, labelClassName: RICH_TEXT_SIZE_CLASS.xlarge },
];

const dot = (className: string) => <span aria-hidden className={cn("size-3 shrink-0 rounded-full", className)} />;

const COLOUR_OPTIONS: readonly MenuOption[] = [
  { value: "default", label: "Default", preview: dot("bg-foreground") },
  ...RICH_TEXT_COLOURS.map((colour) => ({
    value: colour,
    label: RICH_TEXT_COLOUR_NAME[colour],
    preview: dot(RICH_TEXT_COLOUR_SWATCH[colour]),
  })),
];

const HIGHLIGHT_OPTIONS: readonly MenuOption[] = [
  { value: "none", label: "No Highlight", preview: dot("border border-slate-400 bg-card") },
  ...RICH_TEXT_HIGHLIGHTS.map((highlight) => ({
    value: highlight,
    label: RICH_TEXT_HIGHLIGHT_NAME[highlight],
    preview: dot(cn("border border-slate-400", RICH_TEXT_HIGHLIGHT_CLASS[highlight])),
  })),
];

const ALIGN_ICON: Readonly<Record<RichTextAlign | "left", LucideIcon>> = {
  left: TextAlignStartIcon,
  center: TextAlignCenterIcon,
  right: TextAlignEndIcon,
  justify: TextAlignJustifyIcon,
};

const ALIGN_OPTIONS: readonly MenuOption[] = (
  [
    ["left", "Align Left"],
    ["center", "Align Centre"],
    ["right", "Align Right"],
    ["justify", "Justify"],
  ] as const
).map(([value, label]) => {
  const Icon = ALIGN_ICON[value];
  return { value, label, preview: <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" /> };
});

/**
 * Controls that belong together, after a short hairline (slate-200, 20 px).
 * The rows sit 16 px to the left of the toolbar's clipping padding, so the
 * line before a group that starts a row is cut off: a line only ever stands
 * between two groups, in one row where the toolbar is wide enough and with
 * groups wrapping whole where it is not, never at either end of a row.
 */
function ToolGroup({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex flex-nowrap gap-0.5 ps-4 before:absolute before:start-2 before:top-1/2 before:h-5 before:w-px before:-translate-y-1/2 before:bg-border">
      {children}
    </div>
  );
}

function FormattingToolbar({ editor, state, controls }: { editor: Editor | null; state: ToolbarState; controls: string }) {
  // Commands run in the tap handler with the focus first, so iOS keeps the keyboard up.
  const run = (command: (chain: ChainedCommands) => ChainedCommands) => {
    if (editor) command(editor.chain().focus()).run();
  };
  const AlignIcon = ALIGN_ICON[state.align ?? "left"];

  return (
    <TooltipProvider delayDuration={400}>
      <ToolbarPrimitive.Root
        aria-label="Formatting"
        aria-controls={controls}
        data-slot={RICH_TEXT_TOOLBAR_SLOT}
        className="sticky top-[var(--capture-sticky-top,0px)] z-10 overflow-hidden rounded-t-md border-b border-border bg-card p-1.5"
      >
        {/* 16 px to the left, under the clipping padding: the line before a group that starts a row is cut off (ToolGroup). */}
        <div className="-ms-4 flex flex-wrap gap-y-1">
          <ToolGroup>
            <ToolButton name="Undo" icon={Undo2Icon} shortcut={{ key: "Z" }} disabled={!state.canUndo} onPress={() => run((chain) => chain.undo())} />
            <ToolButton
              name="Redo"
              icon={Redo2Icon}
              shortcut={{ shift: true, key: "Z" }}
              disabled={!state.canRedo}
              onPress={() => run((chain) => chain.redo())}
            />
          </ToolGroup>
          <ToolGroup>
            <ToolbarMenu
              name="Font Size"
              editor={editor}
              trigger={<ALargeSmallIcon aria-hidden />}
              current={state.fontSize ?? "normal"}
              options={SIZE_OPTIONS}
              onChoose={(value) => {
                const size = sizeToken(value);
                run((chain) => (size ? chain.setFontSize(size) : chain.unsetFontSize()));
              }}
            />
          </ToolGroup>
          <ToolGroup>
            <ToolButton name="Bold" icon={BoldIcon} shortcut={{ key: "B" }} pressed={state.bold} onPress={() => run((chain) => chain.toggleBold())} />
            <ToolButton
              name="Italic"
              icon={ItalicIcon}
              shortcut={{ key: "I" }}
              pressed={state.italic}
              onPress={() => run((chain) => chain.toggleItalic())}
            />
            <ToolButton
              name="Underline"
              icon={UnderlineIcon}
              shortcut={{ key: "U" }}
              pressed={state.underline}
              onPress={() => run((chain) => chain.toggleUnderline())}
            />
            <ToolButton
              name="Strikethrough"
              icon={StrikethroughIcon}
              shortcut={{ shift: true, key: "S" }}
              pressed={state.strike}
              onPress={() => run((chain) => chain.toggleStrike())}
            />
          </ToolGroup>
          <ToolGroup>
            <ToolbarMenu
              name="Font Colour"
              editor={editor}
              trigger={
                <span className="flex flex-col items-center gap-px">
                  <BaselineIcon aria-hidden />
                  <ColourBar className={state.color ? RICH_TEXT_COLOUR_SWATCH[state.color] : "bg-foreground"} />
                </span>
              }
              current={state.color ?? "default"}
              options={COLOUR_OPTIONS}
              onChoose={(value) => {
                const colour = colourToken(value);
                run((chain) => (colour ? chain.setColor(colour) : chain.unsetColor()));
              }}
            />
            <ToolbarMenu
              name="Highlight"
              shortcut={{ shift: true, key: "H" }}
              editor={editor}
              trigger={
                <span className="flex flex-col items-center gap-px">
                  <HighlighterIcon aria-hidden />
                  <ColourBar className={state.highlight ? RICH_TEXT_HIGHLIGHT_CLASS[state.highlight] : "bg-transparent"} />
                </span>
              }
              current={state.highlight ?? "none"}
              options={HIGHLIGHT_OPTIONS}
              onChoose={(value) => {
                const highlight = highlightToken(value);
                run((chain) => (highlight ? chain.setHighlight({ color: highlight }) : chain.unsetHighlight()));
              }}
            />
          </ToolGroup>
          <ToolGroup>
            <ToolButton
              name="Bulleted List"
              icon={ListIcon}
              shortcut={{ shift: true, key: "8" }}
              pressed={state.bulletList}
              onPress={() => run((chain) => chain.toggleBulletList())}
            />
            <ToolButton
              name="Numbered List"
              icon={ListOrderedIcon}
              shortcut={{ shift: true, key: "7" }}
              pressed={state.orderedList}
              onPress={() => run((chain) => chain.toggleOrderedList())}
            />
          </ToolGroup>
          <ToolGroup>
            <ToolbarMenu
              name="Align"
              editor={editor}
              trigger={<AlignIcon aria-hidden />}
              current={state.align ?? "left"}
              options={ALIGN_OPTIONS}
              onChoose={(value) => {
                const align = alignToken(value);
                run((chain) => (align ? chain.setTextAlign(align) : chain.unsetTextAlign()));
              }}
            />
          </ToolGroup>
          <ToolGroup>
            <ToolButton
              name="Clear Formatting"
              icon={RemoveFormattingIcon}
              shortcut={{ key: "\\" }}
              onPress={() => {
                if (editor) clearFormatting(editor);
              }}
            />
          </ToolGroup>
        </div>
      </ToolbarPrimitive.Root>
    </TooltipProvider>
  );
}
