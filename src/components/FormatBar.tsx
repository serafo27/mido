import { useEffect, useRef, useState, type ReactNode } from "react";
import { redo, undo } from "@codemirror/commands";
import type { Command } from "@codemirror/view";
import {
  Bold,
  ChevronDown,
  Code,
  Ellipsis,
  ImagePlus,
  Italic,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Redo2,
  Sigma,
  SquareCode,
  Strikethrough,
  Superscript,
  Table,
  TextQuote,
  Undo2,
  Workflow,
} from "lucide-react";
import { activeEditor, insertEditorImages, watchEditorFormat } from "./Editor";
import {
  EMPTY_FORMAT,
  insertCodeBlock,
  insertDiagram,
  insertFootnote,
  insertLink,
  insertMath,
  insertRule,
  insertTable,
  setHeading,
  toggleBold,
  toggleInlineCode,
  toggleItalic,
  toggleList,
  toggleStrikethrough,
  type FormatState,
} from "../lib/formatting";
import { modKey } from "../lib/platform";

const HEADINGS = ["Paragraph", "Heading 1", "Heading 2", "Heading 3", "Heading 4", "Heading 5", "Heading 6"];
const TABLE_ROWS = 8;
const TABLE_COLUMNS = 8;

type Popup = "heading" | "table" | "more";

/** Runs `command` in the editor showing the active document. */
function run(command: Command) {
  const view = activeEditor();
  if (!view) return;
  command(view);
  view.focus();
}

/** Keeps the editor focused (and its selection) when a button is pressed. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

function FormatButton(props: { title: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      className={`icon-button ${props.active ? "active" : ""}`}
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.active}
      disabled={props.disabled}
      onMouseDown={keepFocus}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/** Picks a table's size by hovering over a grid of cells. */
function TableGrid({ onPick }: { onPick: (rows: number, columns: number) => void }) {
  const [size, setSize] = useState({ rows: 2, columns: 3 });
  return (
    <div className="format-popup table-grid-popup" role="dialog" aria-label="Insert table">
      <div className="table-grid" onMouseLeave={() => setSize({ rows: 2, columns: 3 })}>
        {Array.from({ length: TABLE_ROWS * TABLE_COLUMNS }, (_, i) => {
          const rows = Math.floor(i / TABLE_COLUMNS) + 1;
          const columns = (i % TABLE_COLUMNS) + 1;
          return (
            <button
              key={i}
              className={rows <= size.rows && columns <= size.columns ? "on" : ""}
              aria-label={`${rows} × ${columns}`}
              onMouseDown={keepFocus}
              onMouseEnter={() => setSize({ rows, columns })}
              onFocus={() => setSize({ rows, columns })}
              onClick={() => onPick(rows, columns)}
            />
          );
        })}
      </div>
      <div className="table-grid-size">
        {size.rows} {size.rows === 1 ? "row" : "rows"} × {size.columns} {size.columns === 1 ? "column" : "columns"}
      </div>
    </div>
  );
}

function MenuItem(props: { icon: ReactNode; label: string; hint?: string; className?: string; onClick: () => void }) {
  return (
    <button className={`menu-item ${props.className ?? ""}`} role="menuitem" onMouseDown={keepFocus} onClick={props.onClick}>
      {props.icon}
      <span>{props.label}</span>
      {props.hint && <span className="menu-hint">{props.hint}</span>}
    </button>
  );
}

/** The writing tools over the editor in Edit mode, like a word processor's. */
export default function FormatBar() {
  const [format, setFormat] = useState<FormatState>(EMPTY_FORMAT);
  const [popup, setPopup] = useState<Popup | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(
    () =>
      watchEditorFormat((next) => setFormat(next ?? EMPTY_FORMAT)),
    [],
  );

  // Clicking elsewhere or pressing Escape closes a popup.
  useEffect(() => {
    if (!popup) return;
    const onDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setPopup(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setPopup(null);
      activeEditor()?.focus();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [popup]);

  const toggle = (which: Popup) => setPopup((p) => (p === which ? null : which));
  const pick = (command: Command) => {
    setPopup(null);
    run(command);
  };
  const block = format.codeBlock;

  return (
    <div className="format-bar" ref={barRef} role="toolbar" aria-label="Formatting">
      {/* Hidden when the bar is very narrow: ⌘Z still works. */}
      <div className="format-group history-group">
        <FormatButton title={`Undo (${modKey}Z)`} disabled={!format.canUndo} onClick={() => run(undo)}>
          <Undo2 size={15} />
        </FormatButton>
        <FormatButton title={`Redo (${modKey}⇧Z)`} disabled={!format.canRedo} onClick={() => run(redo)}>
          <Redo2 size={15} />
        </FormatButton>
      </div>

      <div className="format-group">
        <div className="format-anchor">
          <button
            className={`format-select ${popup === "heading" ? "open" : ""}`}
            title="Paragraph style"
            aria-haspopup="menu"
            aria-expanded={popup === "heading"}
            onMouseDown={keepFocus}
            onClick={() => toggle("heading")}
          >
            <span>{block ? "Code" : HEADINGS[format.heading]}</span>
            <ChevronDown size={13} />
          </button>
          {popup === "heading" && (
            <div className="format-popup heading-menu" role="menu">
              {HEADINGS.map((label, level) => (
                <button
                  key={level}
                  role="menuitemradio"
                  aria-checked={format.heading === level}
                  className={`heading-option level-${level} ${format.heading === level ? "selected" : ""}`}
                  onMouseDown={keepFocus}
                  onClick={() => pick(setHeading(level))}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="format-group">
        <FormatButton title={`Bold (${modKey}B)`} active={format.bold} onClick={() => run(toggleBold)}>
          <Bold size={15} />
        </FormatButton>
        <FormatButton title={`Italic (${modKey}I)`} active={format.italic} onClick={() => run(toggleItalic)}>
          <Italic size={15} />
        </FormatButton>
        <FormatButton
          title={`Strikethrough (${modKey}⇧X)`}
          active={format.strikethrough}
          onClick={() => run(toggleStrikethrough)}
        >
          <Strikethrough size={15} />
        </FormatButton>
        <FormatButton title="Inline code" active={format.code} onClick={() => run(toggleInlineCode)}>
          <Code size={15} />
        </FormatButton>
      </div>

      <div className="format-group">
        <FormatButton title="Link" active={format.link} onClick={() => run(insertLink)}>
          <Link size={15} />
        </FormatButton>
        <FormatButton title="Image…" onClick={() => fileRef.current?.click()}>
          <ImagePlus size={15} />
        </FormatButton>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) insertEditorImages(files);
          }}
        />
      </div>

      <div className="format-group">
        <FormatButton title="Bulleted list" active={format.list === "bullet"} onClick={() => run(toggleList("bullet"))}>
          <List size={15} />
        </FormatButton>
        <FormatButton
          title="Numbered list"
          active={format.list === "ordered"}
          onClick={() => run(toggleList("ordered"))}
        >
          <ListOrdered size={15} />
        </FormatButton>
        <FormatButton title="Task list" active={format.list === "task"} onClick={() => run(toggleList("task"))}>
          <ListTodo size={15} />
        </FormatButton>
      </div>

      {/* Moved into the More menu when the bar is narrow. */}
      <div className="format-group wide-only">
        <FormatButton title="Quote" active={format.list === "quote"} onClick={() => run(toggleList("quote"))}>
          <TextQuote size={15} />
        </FormatButton>
        <FormatButton title="Code block" active={format.codeBlock} onClick={() => run(insertCodeBlock())}>
          <SquareCode size={15} />
        </FormatButton>
        <div className="format-anchor">
          <FormatButton title="Table" active={popup === "table"} onClick={() => toggle("table")}>
            <Table size={15} />
          </FormatButton>
          {popup === "table" && <TableGrid onPick={(rows, columns) => pick(insertTable(rows, columns))} />}
        </div>
        <FormatButton title="Horizontal rule" onClick={() => run(insertRule)}>
          <Minus size={15} />
        </FormatButton>
      </div>

      <div className="format-group">
        <div className="format-anchor">
          <FormatButton title="More" active={popup === "more"} onClick={() => toggle("more")}>
            <Ellipsis size={15} />
          </FormatButton>
          {popup === "more" && (
            <div className="format-popup context-menu more-menu" role="menu">
              <MenuItem className="narrow-only" icon={<TextQuote size={14} />} label="Quote" onClick={() => pick(toggleList("quote"))} />
              <MenuItem className="narrow-only" icon={<SquareCode size={14} />} label="Code Block" onClick={() => pick(insertCodeBlock())} />
              <MenuItem className="narrow-only" icon={<Table size={14} />} label="Table" onClick={() => pick(insertTable(2, 3))} />
              <MenuItem className="narrow-only" icon={<Minus size={14} />} label="Horizontal Rule" onClick={() => pick(insertRule)} />
              <div className="menu-sep narrow-only" />
              <MenuItem icon={<Sigma size={14} />} label="Math Formula" onClick={() => pick(insertMath)} />
              <MenuItem icon={<Workflow size={14} />} label="Mermaid Diagram" onClick={() => pick(insertDiagram)} />
              <MenuItem icon={<Superscript size={14} />} label="Footnote" onClick={() => pick(insertFootnote)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
