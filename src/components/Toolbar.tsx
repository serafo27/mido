import { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  FileCode2,
  FileText,
  Columns2,
  Eye,
  FileDown,
  MessageSquare,
  PanelLeft,
  PenLine,
  Printer,
  Settings as SettingsIcon,
  TableOfContents,
  TextWrap,
} from "lucide-react";
import { IconButton } from "./Sidebar";
import TabBar, { type TabInfo } from "./TabBar";
import { basename, relative } from "../lib/paths";
import { altKey, isWeb, macWindowInset, modKey } from "../lib/platform";
import { WebBrand } from "./Welcome";

export type ViewMode = "view" | "split" | "edit";

interface ToolbarProps {
  showSidebarToggle: boolean;
  sidebarOpen: boolean;
  root: string | null;
  activePath: string | null;
  dirty: boolean;
  mode: ViewMode;
  wrap: boolean;
  settingsOpen: boolean;
  outlineOpen: boolean;
  commentsOpen: boolean;
  /** Open comment threads in the document. */
  commentCount: number;
  /** Tabs shown in the title bar in place of the path (when the path bar is off). */
  tabs?: TabInfo[];
  /** The active tab's key: a file's path, or a diff's. */
  activeTab: string | null;
  onSelectTab: (path: string) => void;
  onPinTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onMoveTab: (from: number, to: number) => void;
  onToggleOutline: () => void;
  onToggleComments: () => void;
  onMode: (mode: ViewMode) => void;
  onWrap: () => void;
  onToggleSidebar: () => void;
  onToggleSettings: () => void;
  /** The web version has no File menu: export and print sit in the toolbar. */
  onExport?: () => void;
  onExportWord?: () => void;
  onPrint?: () => void;
  /** Minimal Mode: only the sidebar's toggle, the tabs (or the path) and Read · Split · Edit. */
  minimal?: boolean;
}

const MODES: { id: ViewMode; label: string; icon: React.ReactNode; key: string }[] = [
  { id: "view", label: "Read", icon: <Eye size={14} />, key: "1" },
  { id: "split", label: "Split", icon: <Columns2 size={14} />, key: "2" },
  { id: "edit", label: "Edit", icon: <PenLine size={14} />, key: "3" },
];

export default function Toolbar(props: ToolbarProps) {
  const { root, activePath } = props;
  // Workspace folder › subfolders › file
  const crumbs = root && activePath ? [basename(root), ...relative(root, activePath).split(/[\\/]/)] : [];

  return (
    <header
      className={`toolbar ${macWindowInset && !props.sidebarOpen ? "mac-inset" : ""} ${props.tabs ? "with-tabs" : ""}`}
      data-tauri-drag-region
    >
      {/* With the sidebar open, the brand sits in its header instead. */}
      {isWeb && !props.sidebarOpen && <WebBrand />}
      {props.showSidebarToggle && (
        <IconButton title={`Toggle sidebar (${modKey}\\)`} onClick={props.onToggleSidebar}>
          <PanelLeft size={15} />
        </IconButton>
      )}

      {props.tabs ? (
        <TabBar
          embedded
          tabs={props.tabs}
          activePath={props.activeTab}
          onSelect={props.onSelectTab}
          onPin={props.onPinTab}
          onClose={props.onCloseTab}
          onMove={props.onMoveTab}
        />
      ) : (
        <div className="breadcrumbs" data-tauri-drag-region title={activePath ?? undefined}>
          {crumbs.map((part, i) => (
            <span key={i} className={i === crumbs.length - 1 ? "crumb current" : i === 0 ? "crumb root" : "crumb"}>
              {i > 0 && <ChevronRight size={12} className="crumb-sep" />}
              {part}
            </span>
          ))}
          {props.dirty && <span className="dirty-dot" title="Unsaved changes" />}
        </div>
      )}

      {activePath && (
        <>
          <div className="segmented" role="tablist">
            {MODES.map((m) => (
              <button
                key={m.id}
                role="tab"
                aria-selected={props.mode === m.id}
                className={props.mode === m.id ? "selected" : ""}
                onClick={() => props.onMode(m.id)}
                title={`${m.label} (${modKey}${m.key})`}
              >
                {m.icon}
                <span>{m.label}</span>
              </button>
            ))}
          </div>
          {!props.minimal && (
            <>
            <IconButton
              title={`${props.wrap ? "Wrapping lines" : "Not wrapping — scroll horizontally"} (${altKey}Z)`}
              active={props.wrap}
              onClick={props.onWrap}
            >
              <TextWrap size={15} />
            </IconButton>
            <IconButton title={`Outline (${modKey}⇧O)`} active={props.outlineOpen} onClick={props.onToggleOutline}>
              <TableOfContents size={15} />
            </IconButton>
            <span className="comments-toggle">
              <IconButton
                title={`Comments (${modKey}⇧M)${props.commentCount ? ` · ${props.commentCount} open` : ""}`}
                active={props.commentsOpen}
                onClick={props.onToggleComments}
              >
                <MessageSquare size={15} />
              </IconButton>
              {props.commentCount > 0 && <span className="comments-badge">{props.commentCount}</span>}
            </span>
            {props.onExport && props.onExportWord && (
              <ExportMenu onExportHtml={props.onExport} onExportWord={props.onExportWord} />
            )}
            {props.onPrint && (
              <IconButton title={`Print or save as PDF (${altKey}${modKey}P)`} onClick={props.onPrint}>
                <Printer size={15} />
              </IconButton>
            )}
            </>
          )}
        </>
      )}
      {!props.minimal && (
        <span data-settings-toggle>
          <IconButton title={`Settings (${modKey},)`} active={props.settingsOpen} onClick={props.onToggleSettings}>
            <SettingsIcon size={15} />
          </IconButton>
        </span>
      )}
    </header>
  );
}

/** Export as HTML or Word, from a button (the web version has no File menu). */
function ExportMenu(props: { onExportHtml: () => void; onExportWord: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const pick = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <span className="export-menu" ref={ref}>
      <IconButton title="Export" active={open} onClick={() => setOpen((o) => !o)}>
        <FileDown size={15} />
      </IconButton>
      {open && (
        <div className="context-menu export-popup" role="menu">
          <button className="menu-item" role="menuitem" onClick={() => pick(props.onExportHtml)}>
            <FileCode2 size={14} />
            <span>Export as HTML</span>
            <span className="menu-hint">{modKey}⇧E</span>
          </button>
          <button className="menu-item" role="menuitem" onClick={() => pick(props.onExportWord)}>
            <FileText size={14} />
            <span>Export as Word</span>
            <span className="menu-hint">{altKey}{modKey}E</span>
          </button>
        </div>
      )}
    </span>
  );
}
