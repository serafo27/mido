import { useEffect, useState, type MouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Download, RotateCw } from "lucide-react";
import { Logo } from "./Welcome";
import { installUpdate, restartWhenSaved, type UpdateInfo } from "../lib/updates";

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

/** Where installing an available update has got to. */
type Install =
  | { step: "idle" }
  | { step: "downloading"; progress: number | null }
  | { step: "installed" }
  | { step: "restarting" }
  /** The installer is downloading in the browser instead (no update for this app, or installing failed). */
  | { step: "browser"; reason?: string };

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

export default function UpdateDialog(props: UpdateDialogProps) {
  const { state, onClose } = props;
  const [install, setInstall] = useState<Install>({ step: "idle" });
  const [restartError, setRestartError] = useState<string | null>(null);
  const busy = install.step === "downloading" || install.step === "restarting";

  const downloadInBrowser = (info: UpdateInfo, reason?: string) => {
    openUrl(info.downloadUrl).catch(console.error);
    setInstall({ step: "browser", reason });
  };

  const startInstall = async (info: UpdateInfo) => {
    setInstall({ step: "downloading", progress: null });
    try {
      if (await installUpdate((progress) => setInstall({ step: "downloading", progress }))) {
        setInstall({ step: "installed" });
      } else {
        downloadInBrowser(info);
      }
    } catch (e) {
      console.error(e);
      downloadInBrowser(info, "Mido couldn't install the update itself.");
    }
  };

  const restart = async () => {
    setRestartError(null);
    setInstall({ step: "restarting" });
    try {
      await restartWhenSaved();
    } catch (e) {
      setRestartError(e instanceof Error ? e.message : String(e));
      setInstall({ step: "installed" });
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  // Links in the release notes open in the browser, not inside the app.
  const openLinksExternally = (e: MouseEvent) => {
    const link = (e.target as HTMLElement).closest("a");
    if (link?.href) {
      e.preventDefault();
      openUrl(link.href).catch(console.error);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
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

            {install.step === "downloading" && (
              <div
                className="update-progress"
                role="progressbar"
                aria-valuenow={install.progress === null ? undefined : Math.round(install.progress * 100)}
              >
                <div
                  className={`update-progress-bar ${install.progress === null ? "indeterminate" : ""}`}
                  style={install.progress === null ? undefined : { width: `${install.progress * 100}%` }}
                />
              </div>
            )}
            {install.step === "installed" && (
              <p className="update-hint">
                {restartError ??
                  `Mido ${state.info.version} is installed. Restart to start using it; your edits are saved first.`}
              </p>
            )}
            {install.step === "browser" && (
              <p className="update-hint">
                {install.reason ? `${install.reason} ` : ""}The download has started in your browser. Open the{" "}
                <code>.dmg</code> and drag Mido to Applications, replacing this version, then reopen Mido.
              </p>
            )}

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
                <button className="ghost-button" onClick={onClose} disabled={busy}>
                  {install.step === "browser" ? "Done" : "Later"}
                </button>
                {install.step === "idle" && (
                  <button className="primary-button small" autoFocus onClick={() => startInstall(state.info)}>
                    <Download size={14} />
                    Install {state.info.version}
                  </button>
                )}
                {install.step === "downloading" && (
                  <button className="primary-button small" disabled>
                    {install.progress === null ? "Downloading…" : `Downloading… ${Math.round(install.progress * 100)}%`}
                  </button>
                )}
                {(install.step === "installed" || install.step === "restarting") && (
                  <button className="primary-button small" autoFocus onClick={restart} disabled={busy}>
                    <RotateCw size={14} />
                    {install.step === "restarting" ? "Restarting…" : "Restart Mido"}
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
