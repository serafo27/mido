# Mido

Markdown viewer & editor per desktop — Rust + Tauri v2 + React.

## Requisiti

- Rust ≥ 1.90 (`rustup update stable`)
- Node ≥ 22.12 (`nvm use` — vedi `.nvmrc`) e pnpm

## Sviluppo

```sh
pnpm install
pnpm tauri dev      # avvia l'app con hot reload
pnpm tauri build    # bundle di produzione (.app / .dmg / .msi / .deb …)
```

Apri la cartella `examples/` per provare tutte le funzioni di rendering.

## Funzionalità

- **Sidebar** con albero della cartella (solo file Markdown), filtro (`⌘P`), crea / rinomina / cestina dal menu contestuale, aggiornamento automatico quando i file cambiano su disco.
- **Tab**: un click su un file lo apre in una tab di anteprima (in corsivo) che viene sostituita dal prossimo file aperto con un click; doppio click sul file (o sulla tab) la fissa, e modificare il file la fissa automaticamente. Le tab sono riordinabili col drag, click centrale per chiudere, `⌘W` chiude, `⌘⇧[` / `⌘⇧]` o `Ctrl+Tab` per cambiare. Ogni tab conserva undo, selezione e scroll; le tab vengono ripristinate al riavvio. Nella barra del titolo il percorso `cartella › … › file` del file corrente; si può disattivare dalle impostazioni, e allora le tab salgono nella barra del titolo.
- **Indice (outline)** (icona accanto al wrap o `⌘⇧O`): pannello a destra con i titoli del documento; click per saltare alla sezione, evidenzia la sezione che stai leggendo. Funziona in lettura (scorre l'anteprima), split ed edit (porta il cursore sul titolo).
- **Temi**: modalità Auto / Chiaro / Scuro con un tema preferito per ciascuna. Inclusi: Mido Light/Dark, VS Code Light+/Dark+, IntelliJ Light/Darcula, Relax, Relax Night, Solarized Light, Nord, Dracula. Temi personalizzati: "New from current" duplica il tema attivo e lo rende modificabile con i color picker; "Import JSON" / "Copy JSON" per condividerli (vedi sotto).
- **Impostazioni** (ingranaggio in alto a destra o `⌘,`): colore d'accento (quello del tema o uno a scelta), stile di rendering (Mido, GitHub, Academic, Minimal), font di testo / titoli / codice (inclusi, di sistema o qualsiasi font installato), dimensione testo, interlinea, larghezza pagina, giustificazione, frontmatter, dimensione font editor.
- **Tre modalità**: Lettura (`⌘1`), Split con scroll sincronizzato e divisore trascinabile (`⌘2`), Modifica (`⌘3`).
- **Wrap / no-wrap** (`⌥Z`): con wrap tutto sta nella finestra; senza wrap codice e tabelle mantengono le righe intere e il contenuto scorre orizzontalmente. Vale anche per l'editor.
- **Rendering**: GFM (tabelle, task list, footnote, strikethrough), alert stile GitHub, math KaTeX, syntax highlighting, frontmatter come scheda, HTML sanitizzato, immagini relative, link `.md` relativi aperti in-app.
- **Editor** CodeMirror 6 con evidenziazione Markdown e dei blocchi di codice, `⌘B` / `⌘I` / `⌘K`, ricerca `⌘F`.
- Autosave (disattivabile), `⌘S`.

## Formato dei temi

```json
{
  "name": "My theme",
  "kind": "dark",
  "colors": {
    "bg": "#1b1d22", "sidebar": "#22252b", "elevated": "#2a2d34", "border": "#353942",
    "text": "#d9dce3", "muted": "#9aa0ab", "faint": "#636977", "heading": "#f2f4f8",
    "accent": "#ff8a65", "warm": "#f0b36b", "codeBg": "#22252b", "codeFg": "#f29db4",
    "keyword": "#c792ea", "string": "#c3e88d", "number": "#f78c6c", "comment": "#676e7b",
    "function": "#82aaff", "type": "#89ddff", "attr": "#ffcb6b"
  }
}
```

Tutti i colori sono opzionali: quelli mancanti vengono presi da Mido Light o Mido Dark in base a `kind`. Sono accettati tutti i formati colore CSS.

## Struttura

```
src-tauri/src/lib.rs    comandi Rust: albero, lettura/scrittura, file ops, watcher
src/App.tsx             stato dell'app, scorciatoie, layout, scroll sync
src/components/         Sidebar, Toolbar, TabBar, Editor, Preview, Outline, SettingsPanel, StatusBar, Welcome
src/lib/settings.ts     modello impostazioni, catalogo font, preset di stile
src/lib/themes.ts       temi inclusi, derivazione delle variabili CSS, import/export JSON
src/lib/outline.ts      estrazione dei titoli per l'indice
src/lib/markdown.ts     plugin remark/rehype, schema di sanitizzazione, frontmatter
src/styles/             app.css (UI + token tema), markdown.css (rendering)
```
