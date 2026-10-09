import { useState, type FormEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { BadgeCheck, KeyRound } from "lucide-react";
import { activateLicense, deactivateLicense, type LicenseStatus } from "../lib/license";

interface LicenseProps {
  status: LicenseStatus;
  onChange: (status: LicenseStatus) => void;
}

const open = (url: string | null) => url && void openUrl(url).catch(console.error);

/** Pasting a license key to turn Mido Pro on, with where to buy one or find it. */
export function LicenseForm({ status, onChange }: LicenseProps) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await activateLicense(key));
      setKey("");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="license-form" onSubmit={submit}>
      {status.problem && <p className="license-error">{status.problem}</p>}
      <div className="license-input">
        <KeyRound size={14} />
        <input
          className="text-input"
          placeholder="MIDO-…"
          aria-label="License key"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <button className="primary-button small" type="submit" disabled={!key.trim() || busy}>
          {busy ? "Activating…" : "Activate"}
        </button>
      </div>
      {error && <p className="license-error">{error}</p>}
      <p className="license-links">
        {status.checkout && (
          <>
            <button type="button" className="link-button" onClick={() => open(status.checkout)}>
              Buy Mido Pro
            </button>
            {" · "}
          </>
        )}
        <button type="button" className="link-button" onClick={() => open(status.portal)}>
          Where's my license key?
        </button>
      </p>
    </form>
  );
}

/** Mido Pro on this computer: whose it is, and freeing this computer's place. */
export function LicenseSummary({ status, onChange }: LicenseProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deactivate = async () => {
    setBusy(true);
    setError(null);
    try {
      onChange(await deactivateLicense());
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="license-summary">
      <div className="license-active">
        <BadgeCheck size={15} />
        <span>
          Mido Pro is on{status.email ? ` · ${status.email}` : ""}
          {status.key && <code>{status.key}</code>}
        </span>
      </div>
      <div className="license-actions">
        <button className="ghost-button" onClick={() => open(status.portal)}>
          Purchases
        </button>
        <button className="ghost-button" onClick={deactivate} disabled={busy} title="Free this computer's place on the license">
          {busy ? "Deactivating…" : "Deactivate on this computer"}
        </button>
      </div>
      {error && <p className="license-error">{error}</p>}
    </div>
  );
}
