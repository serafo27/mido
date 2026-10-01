import { useEffect } from "react";
import { Download } from "lucide-react";
import { DOWNLOAD_URL } from "../lib/platform";
import { Logo } from "./Welcome";

/** Shown in the web version in place of anything that would change files. */
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
        <p className="update-lede">
          Mido for the web only reads your files. Download Mido for Mac to edit, create and organize your Markdown
          documents. It's free.
        </p>
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
