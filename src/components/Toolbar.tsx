import {
  ChevronRight,
  Columns2,
  Eye,
  PanelLeft,
  PenLine,
  Settings as SettingsIcon,
  TableOfContents,
  TextWrap,
} from "lucide-react";
import { IconButton } from "./Sidebar";
import TabBar, { type TabInfo } from "./TabBar";
import { basename, relative } from "../lib/paths";
import { altKey, isMac, modKey } from "../lib/platform";

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
  /** Tabs shown in the title bar in place of the path (when the path bar is off). */
  tabs?: TabInfo[];
  onSelectTab: (path: string) => void;
  onPinTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onMoveTab: (from: number, to: number) => void;
  onToggleOutline: () => void;
  onMode: (mode: ViewMode) => void;
  onWrap: () => void;
  onToggleSidebar: () => void;
  onToggleSettings: () => void;
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
      className={`toolbar ${isMac && !props.sidebarOpen ? "mac-inset" : ""} ${props.tabs ? "with-tabs" : ""}`}
      data-tauri-drag-region
    >
      {props.showSidebarToggle && (
        <IconButton title={`Toggle sidebar (${modKey}\\)`} onClick={props.onToggleSidebar}>
          <PanelLeft size={15} />
        </IconButton>
      )}

      {props.tabs ? (
        <TabBar
          embedded
          tabs={props.tabs}
          activePath={activePath}
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
        </>
      )}
      <span data-settings-toggle>
        <IconButton title={`Settings (${modKey},)`} active={props.settingsOpen} onClick={props.onToggleSettings}>
          <SettingsIcon size={15} />
        </IconButton>
      </span>
    </header>
  );
}
