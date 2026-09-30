import { useState } from "react";
import { Check, Copy, Download, Pencil, Plus, Trash } from "lucide-react";
import { activeTheme, type Settings } from "../lib/settings";
import {
  BUILTIN_THEMES,
  DEFAULT_THEME,
  PALETTE_FIELDS,
  parseThemeJson,
  themeToJson,
  type Palette,
  type Theme,
  type ThemeKind,
} from "../lib/themes";

interface ThemeSectionProps {
  settings: Settings;
  systemDark: boolean;
  onChange: (patch: Partial<Settings>) => void;
}

const newId = () => `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export default function ThemeSection({ settings, systemDark, onChange }: ThemeSectionProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [importText, setImportText] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const shown = activeTheme(settings, systemDark);
  const custom = settings.customThemes;
  const editing = custom.find((t) => t.id === editingId) ?? null;

  /** Makes `t` the preferred theme for its kind and shows it. */
  const select = (t: Theme) => {
    const patch: Partial<Settings> = t.kind === "light" ? { lightTheme: t.id } : { darkTheme: t.id };
    const shownKind = settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;
    if (shownKind !== t.kind) patch.theme = t.kind;
    onChange(patch);
  };

  const addCustom = (t: Theme) => {
    onChange({
      customThemes: [...custom, t],
      ...(t.kind === "light" ? { lightTheme: t.id } : { darkTheme: t.id }),
      ...(settings.theme !== "system" && settings.theme !== t.kind ? { theme: t.kind } : {}),
    });
  };

  const duplicate = () => {
    const copy: Theme = {
      id: newId(),
      name: `${shown.name} (custom)`,
      kind: shown.kind,
      palette: { ...shown.palette },
      custom: true,
    };
    addCustom(copy);
    setEditingId(copy.id);
  };

  const updateCustom = (id: string, patch: Partial<Theme>) => {
    const next = custom.map((t) => (t.id === id ? { ...t, ...patch } : t));
    const updated = next.find((t) => t.id === id)!;
    const extra: Partial<Settings> = {};
    // Changing a theme's kind moves it to the other slot so it stays visible.
    if (patch.kind) {
      if (patch.kind === "light") {
        extra.lightTheme = id;
        if (settings.darkTheme === id) extra.darkTheme = DEFAULT_THEME.dark;
      } else {
        extra.darkTheme = id;
        if (settings.lightTheme === id) extra.lightTheme = DEFAULT_THEME.light;
      }
      if (settings.theme !== "system") extra.theme = updated.kind;
    }
    onChange({ customThemes: next, ...extra });
  };

  const remove = (id: string) => {
    onChange({
      customThemes: custom.filter((t) => t.id !== id),
      ...(settings.lightTheme === id ? { lightTheme: DEFAULT_THEME.light } : {}),
      ...(settings.darkTheme === id ? { darkTheme: DEFAULT_THEME.dark } : {}),
    });
    setEditingId(null);
  };

  const doImport = () => {
    try {
      const t = { ...parseThemeJson(importText ?? ""), id: newId() };
      addCustom(t);
      setImportText(null);
      setImportError(null);
    } catch {
      setImportError("That doesn't look like a theme JSON.");
    }
  };

  if (editing) {
    return (
      <ThemeEditor
        theme={editing}
        onChange={(patch) => updateCustom(editing.id, patch)}
        onDelete={() => remove(editing.id)}
        onDone={() => setEditingId(null)}
      />
    );
  }

  const card = (t: Theme) => {
    const preferred = t.kind === "light" ? settings.lightTheme === t.id : settings.darkTheme === t.id;
    return (
      <div key={t.id} className="theme-card-wrap">
        <button
          className={`theme-card ${preferred ? "preferred" : ""} ${shown.id === t.id ? "shown" : ""}`}
          onClick={() => select(t)}
          title={preferred && shown.id !== t.id ? `${t.name} — used in ${t.kind} mode` : t.name}
        >
          <ThemePreview palette={t.palette} />
          <span className="theme-name">
            {preferred && <Check size={11} strokeWidth={3} />}
            {t.name}
          </span>
        </button>
        {t.custom && (
          <button className="theme-edit" title="Edit theme" onClick={() => setEditingId(t.id)}>
            <Pencil size={11} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="theme-section">
      {(["light", "dark"] as ThemeKind[]).map((kind) => (
        <div key={kind}>
          <div className="theme-group-label">{kind === "light" ? "Light themes" : "Dark themes"}</div>
          <div className="theme-grid">{BUILTIN_THEMES.filter((t) => t.kind === kind).map(card)}</div>
        </div>
      ))}

      <div className="theme-group-label">Custom themes</div>
      {custom.length > 0 && <div className="theme-grid">{custom.map(card)}</div>}
      <div className="theme-actions">
        <button className="ghost-button" onClick={duplicate} title={`Start from ${shown.name}`}>
          <Plus size={13} />
          New from current
        </button>
        <button className="ghost-button" onClick={() => setImportText(importText === null ? "" : null)}>
          <Download size={13} />
          Import JSON
        </button>
      </div>
      {importText !== null && (
        <div className="theme-import">
          <textarea
            className="text-input"
            rows={6}
            spellCheck={false}
            placeholder={'{\n  "name": "My theme",\n  "kind": "dark",\n  "colors": { "bg": "#1b1d22", "accent": "#ff8a65" }\n}'}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          {importError && <div className="form-error">{importError}</div>}
          <button className="primary-button small" onClick={doImport} disabled={!importText.trim()}>
            Add theme
          </button>
        </div>
      )}
    </div>
  );
}

export function ThemePreview({ palette: p }: { palette: Palette }) {
  return (
    <span className="theme-preview" style={{ background: p.bg, borderColor: p.border }}>
      <span className="tp-sidebar" style={{ background: p.sidebar }}>
        <span style={{ background: p.accent }} />
        <span style={{ background: p.faint }} />
        <span style={{ background: p.faint }} />
      </span>
      <span className="tp-body">
        <span className="tp-heading" style={{ background: p.heading }} />
        <span className="tp-line" style={{ background: p.muted }} />
        <span className="tp-line short" style={{ background: p.muted }} />
        <span className="tp-code" style={{ background: p.codeBg }}>
          <span style={{ background: p.keyword }} />
          <span style={{ background: p.string }} />
          <span style={{ background: p.function }} />
        </span>
      </span>
    </span>
  );
}

function ThemeEditor(props: {
  theme: Theme;
  onChange: (patch: Partial<Theme>) => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  const { theme, onChange } = props;
  const [copied, setCopied] = useState(false);
  const setColor = (key: keyof Palette, value: string) => onChange({ palette: { ...theme.palette, [key]: value } });

  const exportJson = async () => {
    await navigator.clipboard.writeText(themeToJson(theme));
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="theme-editor">
      <div className="theme-editor-head">
        <ThemePreview palette={theme.palette} />
        <div className="theme-editor-meta">
          <input
            className="text-input"
            value={theme.name}
            spellCheck={false}
            onChange={(e) => onChange({ name: e.target.value })}
            aria-label="Theme name"
          />
          <div className="segmented small">
            {(["light", "dark"] as ThemeKind[]).map((k) => (
              <button key={k} className={theme.kind === k ? "selected" : ""} onClick={() => onChange({ kind: k })}>
                <span>{k === "light" ? "Light" : "Dark"}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {(["Interface", "Text", "Code"] as const).map((group) => (
        <div key={group} className="color-group">
          <div className="theme-group-label">{group}</div>
          {PALETTE_FIELDS.filter((f) => f.group === group).map((f) => {
            const value = theme.palette[f.key];
            const isHex = /^#[0-9a-f]{6}$/i.test(value);
            return (
              <label key={f.key} className="color-row">
                <span className="settings-label">{f.label}</span>
                <span className="color-input">
                  <input
                    type="color"
                    value={isHex ? value : "#000000"}
                    onChange={(e) => setColor(f.key, e.target.value)}
                  />
                  <input
                    className="text-input"
                    value={value}
                    spellCheck={false}
                    onChange={(e) => setColor(f.key, e.target.value)}
                  />
                </span>
              </label>
            );
          })}
        </div>
      ))}

      <div className="theme-actions">
        <button className="primary-button small" onClick={props.onDone}>
          Done
        </button>
        <button className="ghost-button" onClick={exportJson}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy JSON"}
        </button>
        <button className="ghost-button danger" onClick={props.onDelete}>
          <Trash size={13} />
          Delete
        </button>
      </div>
    </div>
  );
}
