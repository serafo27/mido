import { useState, type FormEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { BadgeCheck, FilePen, KeyRound, MessagesSquare, Sparkles, TextSelect } from "lucide-react";
import { activateLicense, deactivateLicense, type LicenseStatus } from "../lib/license";

interface LicenseProps {
  status: LicenseStatus;
  onChange: (status: LicenseStatus) => void;
}

const open = (url: string | null) => url && void openUrl(url).catch(console.error);

/** Pasting a license key to turn Mido Pro on. */
function KeyForm({ status, onChange, primary }: LicenseProps & { primary?: boolean }) {
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
        <button
          className={primary ? "primary-button small" : "ghost-button"}
          type="submit"
          disabled={!key.trim() || busy}
        >
          {busy ? "Activating…" : "Activate"}
        </button>
      </div>
      {error && <p className="license-error">{error}</p>}
    </form>
  );
}

/** In Settings: the license key to turn Mido Pro on, with where to buy one or find it. */
export function LicenseForm({ status, onChange }: LicenseProps) {
  return (
    <>
      <KeyForm status={status} onChange={onChange} primary />
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
    </>
  );
}

const FEATURES = [
  {
    icon: MessagesSquare,
    title: "Chat about your documents",
    text: "Claude reads the project, the files you have open, or every folder open in Mido.",
  },
  {
    icon: TextSelect,
    title: "Ask about a passage",
    text: "Select text and have it explained, simplified or summarized.",
  },
  {
    icon: FilePen,
    title: "Notes and changes",
    text: "It writes notes into your project, and edits documents once you've seen the change.",
  },
];

/** In the assistant's panel, without a license: what Mido Pro is, to buy it or turn it on. */
export function ProOffer({ status, onChange }: LicenseProps) {
  return (
    <div className="pro-offer">
      <div className="pro-badge" aria-hidden>
        <Sparkles size={26} strokeWidth={1.75} />
      </div>
      <h2>Mido Pro</h2>
      <p className="pro-tagline">Your documents, explained.</p>
      <ul className="pro-features">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <li key={title}>
            <Icon size={16} />
            <div>
              <b>{title}</b>
              <span>{text}</span>
            </div>
          </li>
        ))}
      </ul>
      {status.checkout && (
        <button className="primary-button pro-buy" onClick={() => open(status.checkout)}>
          Buy Mido Pro
          <span className="pro-once">one-time purchase</span>
        </button>
      )}
      <div className="pro-divider">
        <span>Already have a license?</span>
      </div>
      <KeyForm status={status} onChange={onChange} />
      <button type="button" className="link-button pro-find" onClick={() => open(status.portal)}>
        Where's my license key?
      </button>
      <p className="pro-note">Runs on Claude Code, installed on this computer and signed in to your Claude account.</p>
    </div>
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
