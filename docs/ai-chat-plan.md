# Chat con l'AI (Pro) — piano

Un pannello laterale, come quello dei commenti, con una chat verso un'AI
installata sul Mac (per cominciare Claude Code). Serve a farsi spiegare i
documenti, fare domande su un pezzo selezionato e generare file `.md`
(risposte, riassunti) dentro il progetto. Solo per utenti Pro.

## Idea di fondo

Mido non diventa un client AI: avvia la CLI `claude` già installata, in
modalità non interattiva, e legge il suo output strutturato riga per riga.

```
claude -p --input-format stream-json --output-format stream-json --verbose \
       --include-partial-messages \
       --resume <session_id> \
       --add-dir <altri progetti> \
       --allowedTools Read Grep Glob Write Edit \
       --disallowedTools Bash WebFetch \
       --append-system-prompt "<contesto Mido>"
```

- **Nessuna chiave API**: usa login e abbonamento dell'utente (e il repo resta
  senza chiavi).
- **Sessioni gestite da Claude Code**: Mido tiene solo il `session_id` per
  progetto e riprende con `--resume`.
- **Lettura, ricerca e scrittura dei file** le fa già Claude Code: nessun tool
  da scrivere.

## Cosa si riusa

| Serve | C'è già |
|---|---|
| Processo figlio con output in streaming verso la webview | `src-tauri/src/terminal.rs` (Channel, PATH dalla shell di login) |
| Pannello laterale + pulsante | `Comments.tsx`, `commentsOpen` in `App.tsx` |
| Pulsante sulla selezione | `SelectionMenu.tsx`, ramo `preview` (oggi solo "Comment") |
| Citazione e posizione della selezione | `lib/comments.ts` (`Range`, `plainQuote`) |
| Markdown delle risposte | `Preview` / `blockRenderer` |
| File creati dall'AI subito visibili | il watcher della cartella (`lib.rs`, `watch`) |
| Rivedere le modifiche dell'AI | Source Control / diff |
| Escludere web ed embed | `DesktopOnly.tsx` |

## Passi

### 1. Backend: `src-tauri/src/ai.rs`

Sul modello di `terminal.rs`, circa 300 righe.

- `ai_detect`: trova `claude` tramite la shell di login
  (`$SHELL -lc 'command -v claude'`). Un'app aperta dal Finder non ha il PATH
  dell'utente, come per il terminale.
- `ai_send(window, prompt, scope, session_id, channel)`: avvia il processo con
  `cwd` = la cartella della finestra, scrive il messaggio su stdin, legge stdout
  riga per riga e inoltra gli eventi (`assistant`, `tool_use`, `result` con
  `session_id`) sul Channel.
- `ai_stop`: termina il processo.
- Un processo per finestra, chiuso quando la finestra si chiude (come i
  terminali).

### 2. Ambito del contesto

Un selettore in cima al pannello:

- **File aperti**: il contenuto delle tab va nel prompt; Read/Grep/Glob
  disattivati. Prevedibile ed economico.
- **Progetto attuale**: `cwd` = cartella aperta, Read/Grep/Glob attivi.
- **Tutti i progetti aperti**: in più `--add-dir` per la cartella di ogni altra
  finestra. Il backend le conosce già (`Workspaces` in `lib.rs`): basta una
  funzione che le elenchi.

### 3. Pannello: `AiChat.tsx`

- Pulsante nella toolbar (✨, ⌘⇧L). Il pannello sta a destra sotto la barra
  dell'app, come i commenti, ridimensionabile: resta aperto anche senza
  documento e durante i diff.
- Risposte rese come markdown mentre arrivano; chiamate ai tool compresse in
  righe come "📄 Letto docs/api.md".
- Stop, Nuova chat, cronologia. La lista delle sessioni per progetto sta nello
  storage dell'app, **non in `.mido/`**: le chat sono personali, `.mido/`
  finisce in git.

### 4. "Discutine con l'AI" sulla selezione

- Secondo pulsante in `SelectionMenu.tsx` accanto a "Comment" (e
  eventualmente nel menu dell'editor).
- Apre il pannello con un riquadro che cita la selezione, con percorso e righe
  ricavati come per i commenti. L'utente scrive la domanda; prima dell'invio
  si offrono azioni rapide ("Spiega", "Semplifica").
- Una scorciatoia sul modello di quella dei commenti (⌥⌘M).

### 5. Creare file `.md` e riassunti

- `Write` ed `Edit` attivi ma limitati da regole sui permessi
  (`Write(**/*.md)`, `Edit(**/*.md)`) dentro la cartella del progetto; Bash
  disattivato. Il prompt di sistema aggiunto dice dove salvare (es. `docs/ai/`,
  o una cartella scelta nelle impostazioni).
- Il watcher aggiorna l'albero; Mido apre il file appena creato quando arriva
  il `tool_use` Write.
- Le modifiche compaiono in Source Control: l'utente le rivede e le annulla con
  git. Nulla di automatico su git.
- "Salva come .md" su ogni risposta (fatto da Mido, senza l'AI) ed "Esporta
  chat".
- Modifiche agli altri file: Claude chiede il permesso (`--permission-prompt-tool
  stdio`, un `control_request` sul suo output); il pannello mostra il diff con
  Allow / Decline / Allow all in this chat, e la risposta torna sul suo input.
  Il backend accetta solo richieste davvero in attesa, con l'input originale, e
  solo per file nelle cartelle aperte.

### 6. Solo per utenti Pro

Oggi non c'è infrastruttura di licenza: è il blocco più grosso e serve a tutte
le future funzioni Pro.

- Vendita tramite Lemon Squeezy, Paddle o Keygen.
- Verifica **offline in Rust**: la licenza è un JSON firmato Ed25519 (email,
  piano, scadenza); la chiave pubblica sta nell'app, come per l'updater. La
  chiave privata vive solo nel servizio che emette le licenze, mai nel repo.
- I comandi `ai_*` controllano la licenza nel backend, non solo
  nell'interfaccia.
- Il sorgente è visibile: chi compila da sé può togliere il controllo. Con la
  licenza proprietaria è un problema legale, non tecnico; niente
  offuscamento.
- Senza licenza il pulsante resta visibile con un lucchetto e porta a "Passa a
  Pro".

### 7. Rifiniture

- `claude` non trovato: il pannello spiega come installarlo, con un pulsante
  "Riprova". Non autenticato: suggerisce `claude login` nel terminale di Mido.
- Analytics (aperto, messaggio inviato, file creato) **senza contenuti**.
- Sito e changelog.

## Ordine

1. Passi 1 e 3 con il solo ambito "progetto attuale": una chat che funziona,
   per validare il flusso dei dati (la parte più rischiosa).
2. Passo 4: il pulsante sulla selezione.
3. Passo 2: gli altri due ambiti.
4. Passo 5: scrittura dei file.
5. Passo 6: licenze, prima del rilascio. Si può fare in parallelo; intanto un
   flag nascosto nelle impostazioni.

## Decisioni aperte

1. **Solo Claude Code o più AI?** Strutturare il codice a "provider" fin da
   subito, per aggiungere poi Codex o Gemini CLI. Alternativa: l'Agent Client
   Protocol di Zed, standard per più agenti ma con un adattatore Node in più.
   Proposta: partire solo con Claude Code.
2. ~~**Scrittura**~~: deciso. File nuovi liberi nella cartella note, modifiche
   agli altri file con conferma e diff.
3. **Servizio di vendita delle licenze**: quale?
