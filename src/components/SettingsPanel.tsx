import { useEffect, useRef, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isWeb } from "../lib/platform";
import { Check, Monitor, Moon, RotateCcw, Sun, X } from "lucide-react";
import {
  ACCENTS,
  DEFAULT_SETTINGS,
  EDITOR_FONT_SIZE,
  EDITOR_LINE_HEIGHT,
  FONT_CHOICES,
  LINE_HEIGHT,
  PRESETS,
  TEXT_SIZE,
  activeTheme,
  fontFor,
  type FontRole,
  type Settings,
} from "../lib/settings";
import ThemeSection from "./ThemeSection";

interface SettingsPanelProps {
  settings: Settings;
  /** Whether the OS is in dark mode (decides the theme shown in "Auto"). */
  systemDark: boolean;
  onChange: (patch: Partial<Settings>) => void;
  onCheckForUpdates: () => void;
  onClose: () => void;
}

const CUSTOM_KEY: Record<FontRole, "customBodyFont" | "customHeadingFont" | "customCodeFont"> = {
  body: "customBodyFont",
  heading: "customHeadingFont",
  code: "customCodeFont",
};
const FONT_KEY: Record<FontRole, "bodyFont" | "headingFont" | "codeFont"> = {
  body: "bodyFont",
  heading: "headingFont",
  code: "codeFont",
};

export default function SettingsPanel(props: SettingsPanelProps) {
  const { settings, systemDark, onChange, onClose } = props;
  const panelRef = useRef<HTMLDivElement>(null);
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion, () => {});
  }, []);
  const theme = activeTheme(settings, systemDark);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!panelRef.current?.contains(target) && !target.closest("[data-settings-toggle]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

  return (
    <div className="settings-panel" ref={panelRef} role="dialog" aria-label="Settings">
      <header className="settings-header">
        <h2>Settings</h2>
        <button className="icon-button" onClick={onClose} title="Close (Esc)">
          <X size={15} />
        </button>
      </header>

      <div className="settings-body">
        <Section title="Reading style">
          <div className="preset-grid">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                className={`preset-card preset-${p.id} ${settings.style === p.id ? "selected" : ""}`}
                onClick={() => onChange({ style: p.id, ...p.fonts })}
              >
                <span
                  className="preset-sample"
                  style={{ fontFamily: fontFor({ ...settings, ...p.fonts, style: p.id }, "heading") }}
                >
                  Aa
                </span>
                <span className="preset-label">{p.label}</span>
                <span className="preset-desc">{p.description}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Fonts">
          <FontPicker role="body" label="Body" settings={settings} onChange={onChange} />
          <FontPicker role="heading" label="Headings" settings={settings} onChange={onChange} />
          <FontPicker role="code" label="Code & editor" settings={settings} onChange={onChange} />
        </Section>

        <Section title="Layout">
          <Slider
            label="Text size"
            value={settings.fontSize}
            min={TEXT_SIZE.min}
            max={TEXT_SIZE.max}
            step={0.5}
            format={(v) => `${v}px`}
            onChange={(fontSize) => onChange({ fontSize })}
          />
          <Slider
            label="Line height"
            value={settings.lineHeight}
            min={LINE_HEIGHT.min}
            max={LINE_HEIGHT.max}
            step={0.02}
            format={(v) => v.toFixed(2)}
            onChange={(lineHeight) => onChange({ lineHeight })}
          />
          <Slider
            label="Page width"
            value={settings.contentWidth || 1400}
            min={560}
            max={1400}
            step={20}
            format={(v) => (v >= 1400 ? "Full" : `${v}px`)}
            onChange={(v) => onChange({ contentWidth: v >= 1400 ? 0 : v })}
          />
          <Toggle label="Justify text" checked={settings.justify} onChange={(justify) => onChange({ justify })} />
          <Toggle
            label="Show frontmatter"
            checked={settings.showFrontmatter}
            onChange={(showFrontmatter) => onChange({ showFrontmatter })}
          />
          <Toggle label="Wrap long lines" checked={settings.wrap} onChange={(wrap) => onChange({ wrap })} />
          <Toggle
            label="File path bar"
            checked={settings.showPathBar}
            onChange={(showPathBar) => onChange({ showPathBar })}
          />
          <Toggle
            label="Minimap instead of scrollbar"
            checked={settings.minimap}
            onChange={(minimap) => onChange({ minimap })}
          />
          <Row label="Images from the web">
            <div className="segmented small" title="An image loaded from a server tells it the document was opened">
              {(
                [
                  ["all", "All"],
                  ["secure", "HTTPS only"],
                  ["none", "None"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={settings.remoteImages === id ? "selected" : ""}
                  onClick={() => onChange({ remoteImages: id })}
                >
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </Row>
        </Section>

        {!isWeb && (
          <Section title="Editor">
            <Slider
              label="Font size"
              value={settings.editorFontSize}
              min={EDITOR_FONT_SIZE.min}
              max={EDITOR_FONT_SIZE.max}
              step={0.5}
              format={(v) => `${v}px`}
              onChange={(editorFontSize) => onChange({ editorFontSize })}
            />
            <Slider
              label="Line height"
              value={settings.editorLineHeight}
              min={EDITOR_LINE_HEIGHT.min}
              max={EDITOR_LINE_HEIGHT.max}
              step={0.05}
              format={(v) => v.toFixed(2)}
              onChange={(editorLineHeight) => onChange({ editorLineHeight })}
            />
            <Toggle label="Autosave" checked={settings.autosave} onChange={(autosave) => onChange({ autosave })} />
            <Toggle
              label="Formatting toolbar in Edit mode"
              checked={settings.formatBar}
              onChange={(formatBar) => onChange({ formatBar })}
            />
          </Section>
        )}

        {!isWeb && settings.experimentalGit && (
          <Section title="Source Control">
            <Toggle
              label="Show all files, not only Markdown"
              checked={settings.gitShowAllFiles}
              onChange={(gitShowAllFiles) => onChange({ gitShowAllFiles })}
            />
          </Section>
        )}

        <Section title="Appearance">
          <Row label="Mode">
            <div className="segmented small">
              {(
                [
                  ["system", <Monitor size={13} key="m" />, "Auto"],
                  ["light", <Sun size={13} key="s" />, "Light"],
                  ["dark", <Moon size={13} key="d" />, "Dark"],
                ] as const
              ).map(([id, icon, label]) => (
                <button
                  key={id}
                  className={settings.theme === id ? "selected" : ""}
                  onClick={() => onChange({ theme: id })}
                >
                  {icon}
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </Row>
          <Row label="Tabs">
            <div className="segmented small">
              {(
                [
                  ["classic", "Classic"],
                  ["rounded", "Rounded"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={settings.tabStyle === id ? "selected" : ""}
                  onClick={() => onChange({ tabStyle: id })}
                >
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </Row>
          <Row label="Accent">
            <div className="swatches">
              {[
                { id: "theme" as const, label: `Theme default (${theme.name})`, color: theme.palette.accent },
                ...ACCENTS.map((a) => ({ id: a.id, label: a.label, color: a[theme.kind] })),
              ].map((a) => (
                <button
                  key={a.id}
                  className={`swatch ${a.id === "theme" ? "theme-swatch" : ""} ${settings.accent === a.id ? "selected" : ""}`}
                  style={{ background: a.color }}
                  title={a.label}
                  aria-label={a.label}
                  onClick={() => onChange({ accent: a.id })}
                >
                  {settings.accent === a.id && <Check size={12} strokeWidth={3} />}
                </button>
              ))}
            </div>
          </Row>
        </Section>

        <Section title="Themes">
          <ThemeSection settings={settings} systemDark={systemDark} onChange={onChange} />
        </Section>

        {!isWeb && (
          <Section title="Updates">
            <Toggle
              label="Check for updates automatically"
              checked={settings.checkForUpdates}
              onChange={(checkForUpdates) => onChange({ checkForUpdates })}
            />
            <div className="settings-row">
              <span className="settings-label muted">{version ? `Mido ${version}` : "Mido"}</span>
              <button className="ghost-button" onClick={props.onCheckForUpdates}>
                Check Now
              </button>
            </div>
          </Section>
        )}

        <Section title="Experimental">
          <p className="settings-note">Features still being worked on. They may change, or not always work.</p>
          <Toggle
            label="Terminal"
            checked={settings.experimentalTerminal}
            onChange={(experimentalTerminal) => onChange({ experimentalTerminal })}
          />
          <Toggle
            label="Source control (git)"
            checked={settings.experimentalGit}
            onChange={(experimentalGit) => onChange({ experimentalGit })}
          />
        </Section>

        {/* Custom themes are user content, not a setting: keep them. */}
        <button
          className="reset-button"
          onClick={() => onChange({ ...DEFAULT_SETTINGS, customThemes: settings.customThemes })}
        >
          <RotateCcw size={13} />
          Reset to defaults
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <span className="settings-label">{label}</span>
      {children}
    </div>
  );
}

function FontPicker(props: {
  role: FontRole;
  label: string;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const { role, settings, onChange } = props;
  const current = settings[FONT_KEY[role]];
  const custom = settings[CUSTOM_KEY[role]];

  return (
    <div className="font-picker">
      <span className="settings-label">{props.label}</span>
      <div className="font-grid">
        {FONT_CHOICES[role].map((f) => (
          <button
            key={f.id}
            className={`font-card ${current === f.id ? "selected" : ""}`}
            onClick={() => onChange({ [FONT_KEY[role]]: f.id })}
            title={f.label}
          >
            <span className="font-sample" style={{ fontFamily: f.css }}>
              {role === "code" ? "{ }" : "Ag"}
            </span>
            <span className="font-name">{f.label}</span>
          </button>
        ))}
        <button
          className={`font-card ${current === "custom" ? "selected" : ""}`}
          onClick={() => onChange({ [FONT_KEY[role]]: "custom" })}
          title="Any font installed on this computer"
        >
          <span className="font-sample custom" style={custom ? { fontFamily: `"${custom}"` } : undefined}>
            {custom ? "Ag" : "+"}
          </span>
          <span className="font-name">{custom || "Custom"}</span>
        </button>
      </div>
      {current === "custom" && (
        <input
          className="text-input"
          placeholder="Installed font name, e.g. Avenir Next"
          value={custom}
          spellCheck={false}
          autoFocus
          onChange={(e) => onChange({ [CUSTOM_KEY[role]]: e.target.value })}
        />
      )}
    </div>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const pct = ((props.value - props.min) / (props.max - props.min)) * 100;
  return (
    <label className="settings-slider">
      <span className="settings-label">{props.label}</span>
      <span className="slider-value">{props.format(props.value)}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        style={{ "--fill": `${pct}%` } as React.CSSProperties}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="settings-toggle">
      <span className="settings-label">{props.label}</span>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="switch" aria-hidden />
    </label>
  );
}
