import { Download, FileText, FolderOpen, Lock } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { basename } from "../lib/paths";
import { altKey, DOWNLOAD_URL, HOME_URL, isWeb, modKey } from "../lib/platform";

export function Logo({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="64 64 896 896" aria-hidden>
      <defs>
        <linearGradient id="mido-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2d6a5f" />
          <stop offset="1" stopColor="#173a34" />
        </linearGradient>
      </defs>
      <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#mido-bg)" />
      <rect x="232" y="224" width="560" height="576" rx="56" fill="#f7f3ea" />
      <path d="M332 640V384l90 120 90-120v256" fill="none" stroke="#1f3d37" strokeWidth="44" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M632 384v252m-62-62 62 64 62-64" fill="none" stroke="#d98a3d" strokeWidth="44" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The web version's top-left corner: Mido's icon and name, back to the website. */
export function WebBrand() {
  return (
    <a className="web-brand" href={HOME_URL} title="Mido website">
      <Logo size={20} />
      <span>Mido</span>
    </a>
  );
}

export function Welcome(props: { recents: string[]; onOpen: (path?: string) => void }) {
  if (isWeb) return <WebWelcome {...props} />;
  return (
    <div className="welcome" data-tauri-drag-region>
      <Logo size={72} />
      <h1>Mido</h1>
      <p className="tagline">A quiet place to read and write Markdown.</p>
      <button className="primary-button" onClick={() => props.onOpen()}>
        <FolderOpen size={16} />
        Open Folder
        <kbd>{modKey}O</kbd>
      </button>
      {props.recents.length > 0 && (
        <div className="recents">
          <h2>Recent</h2>
          {props.recents.map((path) => (
            <button key={path} className="recent" onClick={() => props.onOpen(path)} title={path}>
              <span className="recent-name">{basename(path) || path}</span>
              <span className="recent-path">{path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Chromium can read a folder again (and reopen it from the recent list);
// Safari and Firefox only get a snapshot of what was picked.
export const canReadFolders = isWeb && "showDirectoryPicker" in window;

/** The web version's start page: open a folder or files from this computer, read-only. */
function WebWelcome(props: { recents: string[]; onOpen: (path?: string) => void }) {
  return (
    <div className="welcome web-welcome">
      <Logo size={72} />
      <h1>Mido for the web</h1>
      <p className="tagline">Read your Markdown, right in the browser.</p>
      <div className="web-actions">
        <button className="primary-button" onClick={() => props.onOpen()}>
          <FolderOpen size={16} />
          Open Folder
        </button>
        <button className="ghost-button large" onClick={() => openDialog({ multiple: true })}>
          <FileText size={16} />
          Open Files
        </button>
      </div>
      <p className="web-drop-hint">or drop a folder or Markdown files anywhere on this page</p>
      <p className="web-privacy">
        <Lock size={13} />
        Your files never leave your computer: Mido reads them in this browser and uploads nothing.
      </p>
      {!canReadFolders && (
        <p className="web-browser-note">
          In this browser Mido reads a folder as it is when you open it. For live updates and recent folders, use
          Chrome, Edge or another Chromium browser.
        </p>
      )}
      {canReadFolders && props.recents.length > 0 && (
        <div className="recents">
          <h2>Recent</h2>
          {props.recents.map((path) => (
            <button key={path} className="recent" onClick={() => props.onOpen(path)} title={path.slice(1)}>
              <span className="recent-name">{basename(path) || path}</span>
            </button>
          ))}
        </div>
      )}
      <a className="web-download" href={DOWNLOAD_URL} target="_blank" rel="noopener">
        <Download size={14} />
        To edit and write, get Mido for Mac. It's free.
      </a>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  [`${modKey}1 / 2 / 3`, "Read · Split · Edit"],
  [`${altKey}Z`, "Toggle line wrap"],
  [`${modKey}S`, "Save"],
  [`${modKey}P`, "Quick search"],
  [`${modKey}W`, "Close tab"],
  [`${modKey}⇧[ / ]`, "Previous · next tab"],
  [`${modKey}⇧O`, "Outline"],
  [`${modKey},`, "Settings"],
  [`${modKey}\\`, "Toggle sidebar"],
  [`${modKey}B / I / K`, "Bold · Italic · Link"],
  [`${modKey}K / ${modKey}⇧K`, "Commit · Push (git)"],
];

// The web version reads only, and the browser keeps some shortcuts (like closing tabs) for itself.
const WEB_SHORTCUTS: [string, string][] = [
  [`${modKey}P`, "Quick search"],
  [`${modKey}⇧F`, "Search in files"],
  [`${altKey}Z`, "Toggle line wrap"],
  [`${modKey}⇧[ / ]`, "Previous · next tab"],
  [`${modKey}⇧O`, "Outline"],
  [`${modKey}⇧E / ${altKey}${modKey}E`, "Export as HTML · Word"],
  [`${modKey},`, "Settings"],
  [`${modKey}\\`, "Toggle sidebar"],
];

export function NoFile() {
  return (
    <div className="no-file" data-tauri-drag-region>
      <p>Select a file from the sidebar</p>
      <dl className="shortcuts">
        {(isWeb ? WEB_SHORTCUTS : SHORTCUTS).map(([keys, label]) => (
          <div key={keys}>
            <dt>
              <kbd>{keys}</kbd>
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
