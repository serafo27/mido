import { FolderOpen } from "lucide-react";
import { basename } from "../lib/paths";
import { altKey, modKey } from "../lib/platform";

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

export function Welcome(props: { recents: string[]; onOpen: (path?: string) => void }) {
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

const SHORTCUTS: [string, string][] = [
  [`${modKey}1 / 2 / 3`, "Read · Split · Edit"],
  [`${altKey}Z`, "Toggle line wrap"],
  [`${modKey}S`, "Save"],
  [`${modKey}P`, "Filter files"],
  [`${modKey}W`, "Close tab"],
  [`${modKey}⇧[ / ]`, "Previous · next tab"],
  [`${modKey}⇧O`, "Outline"],
  [`${modKey},`, "Settings"],
  [`${modKey}\\`, "Toggle sidebar"],
  [`${modKey}B / I / K`, "Bold · Italic · Link"],
];

export function NoFile() {
  return (
    <div className="no-file" data-tauri-drag-region>
      <p>Select a file from the sidebar</p>
      <dl className="shortcuts">
        {SHORTCUTS.map(([keys, label]) => (
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
