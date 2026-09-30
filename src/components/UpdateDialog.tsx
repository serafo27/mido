import { useEffect, useState, type MouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Download } from "lucide-react";
import { Logo } from "./Welcome";
import type { UpdateInfo } from "../lib/updates";

export type UpdateState =
  | { kind: "checking" }
  | { kind: "up-to-date"; currentVersion: string }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "error"; message: string };

interface UpdateDialogProps {
  state: UpdateState;
  /** Whether automatic update checks (and their notifications) are on. */
  notificationsEnabled: boolean;
  onNotificationsChange: (enabled: boolean) => void;
  onRetry: () => void;
  onClose: () => void;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en", { year: "numeric", month: "long", day: "numeric" });

export default function UpdateDialog(props: UpdateDialogProps) {
  const { state, onClose } = props;
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Links in the release notes open in the browser, not inside the app.
  const openLinksExternally = (e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest("a");
    if (link?.href) {
      e.preventDefault();
      openUrl(link.href).catch(console.error);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-title">
        <Logo size={52} />

        {state.kind === "checking" && (
          <>
            <h2 id="update-title">Checking for updates…</h2>
            <div className="update-spinner" aria-hidden />
          </>
        )}

        {state.kind === "up-to-date" && (
          <>
            <h2 id="update-title">You're up to date</h2>
            <p className="update-lede">Mido {state.currentVersion} is the latest version.</p>
            <div className="modal-actions">
              <button className="primary-button small" onClick={onClose} autoFocus>
                OK
              </button>
            </div>
          </>
        )}

        {state.kind === "error" && (
          <>
            <h2 id="update-title">Couldn't check for updates</h2>
            <p className="update-lede">{state.message} Check your connection and try again.</p>
            <div className="modal-actions">
              <button className="ghost-button" onClick={onClose}>
                Close
              </button>
              <button className="primary-button small" onClick={props.onRetry} autoFocus>
                Try Again
              </button>
            </div>
          </>
        )}

        {state.kind === "available" && (
          <>
            <h2 id="update-title">A new version of Mido is available</h2>
            <p className="update-lede">
              Mido {state.info.version} was released on {formatDate(state.info.publishedAt)} — you have{" "}
              {state.info.currentVersion}.
            </p>

            <div className="update-notes" onClick={openLinksExternally}>
              <div className="update-notes-title">What's new in {state.info.version}</div>
              <div dangerouslySetInnerHTML={{ __html: state.info.notesHtml }} />
            </div>

            {downloaded ? (
              <p className="update-hint">
                The download has started in your browser. Open the <code>.dmg</code> and drag Mido to Applications,
                replacing this version, then reopen Mido.
              </p>
            ) : null}

            <div className="modal-actions spread">
              <label className="update-optout">
                <input
                  type="checkbox"
                  checked={!props.notificationsEnabled}
                  onChange={(e) => props.onNotificationsChange(!e.target.checked)}
                />
                Don't show update notifications
              </label>
              <div className="modal-buttons">
                <button className="ghost-button" onClick={onClose}>
                  {downloaded ? "Done" : "Later"}
                </button>
                {!downloaded && (
                  <button
                    className="primary-button small"
                    autoFocus
                    onClick={() => {
                      openUrl(state.info.downloadUrl).catch(console.error);
                      setDownloaded(true);
                    }}
                  >
                    <Download size={14} />
                    Download {state.info.version}
                    {state.info.downloadSize ? ` (${(state.info.downloadSize / 1e6).toFixed(1)} MB)` : ""}
                  </button>
                )}
              </div>
            </div>
            <button className="update-changelog" onClick={() => openUrl(state.info.changelogUrl).catch(console.error)}>
              View the full changelog
            </button>
          </>
        )}
      </div>
    </div>
  );
}
