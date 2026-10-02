import { useEffect } from "react";
import { Download } from "lucide-react";
import { DOWNLOAD_URL } from "../lib/platform";
import { Logo } from "./Welcome";

const DEFAULT_DESCRIPTION =
  "Mido for the web only reads your files. Download Mido for Mac to edit, create and organize your Markdown documents. It's free.";

/** What the desktop app does that the web version can't, for features that aren't about editing. */
const DESCRIPTIONS: Record<string, string> = {
  "The terminal":
    "Mido for the web can't run programs on your computer. Download Mido for Mac for a terminal in the folder you're working in, next to your documents. It's free.",
  "Source control":
    "Mido for the web can't use git. Download Mido for Mac to see your changes, commit, push and pull, and switch branches without leaving your documents. It's free.",
};

/** Shown in the web version in place of anything it can't do. */
export default function DesktopOnly({ feature, onClose }: { feature: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal desktop-only" role="dialog" aria-modal="true" aria-labelledby="desktop-only-title">
        <Logo size={52} />
        <h2 id="desktop-only-title">{feature} needs the desktop app</h2>
        <p className="update-lede">{DESCRIPTIONS[feature] ?? DEFAULT_DESCRIPTION}</p>
        <div className="modal-actions">
          <button className="ghost-button" onClick={onClose}>
            Not Now
          </button>
          <a className="primary-button small" href={DOWNLOAD_URL} target="_blank" rel="noopener" autoFocus>
            <Download size={15} />
            Download Mido for Mac
          </a>
        </div>
      </div>
    </div>
  );
}
