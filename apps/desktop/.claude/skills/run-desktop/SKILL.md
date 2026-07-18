---
name: run-desktop
description: Build, run, and drive the Polenta Electron desktop app (apps/desktop). Use when asked to start the desktop app, take a screenshot of it, or interact with its UI to verify a change.
---

Polenta desktop is an Electron app (electron-vite, TanStack Router, React).
For agent/automated use, drive it via the Playwright `_electron` script at
`.claude/skills/run-desktop/driver.mjs`. All paths below are relative to
`apps/desktop/`.

## Prerequisites

```bash
pnpm add -D playwright-core --filter @polenta/desktop   # once per checkout/worktree
```

No xvfb needed on Windows (real desktop session). On headless Linux, prefix
the run command with `xvfb-run -a` and the driver's `DISPLAY` fallback covers
the rest — untested on Linux by this author, flag if it doesn't launch there.

## Build

```bash
pnpm --filter @polenta/desktop build   # electron-vite build -> out/main, out/renderer
```

Ignore the `Error: ENOENT ... scandir '...\src\renderer\src\renderer\routes'`
printed mid-build — it's a pre-existing TanStack router-generator quirk during
the SSR/preload build step, present on `master` too, and does not stop the
actual renderer build from completing successfully.

## Run (agent path)

The driver reads one command per line from stdin and runs them **sequentially**
(it buffers non-TTY stdin fully before executing — piping a whole script does
not race ahead of `launch`). Screenshots land in `SCREENSHOT_DIR`
(`C:/tmp/shots` if unset). Always pass `ELECTRON_USER_DATA_DIR` pointing at a
scratch folder — see Gotchas.

```bash
cd apps/desktop
SCREENSHOT_DIR="/path/to/shots" \
ELECTRON_USER_DATA_DIR="/path/to/scratch-userdata" \
node .claude/skills/run-desktop/driver.mjs < commands.txt
```

Example `commands.txt` to reach a project's main view from a cold boot:

```
launch
click-text Créer un nouveau projet
wait input[placeholder="Nom du projet"]
focus input[placeholder="Nom du projet"]
type MonProjetTest
focus input[placeholder="Dossier de destination"] 1
type C:/tmp/mon-projet-test
click-text Créer
wait h1
ss project-home
quit
```

### Commands

| command | what it does |
|---|---|
| `launch` | launch the app, wait ~4s, grab the main window |
| `ss [name]` | screenshot -> `<SCREENSHOT_DIR>/<name>.png` |
| `click <css-sel>` | click element via DOM `.click()`, not coordinates |
| `click-text <text>` | click first `button`/`a`/`[role=button]` whose text matches (exact, else substring) |
| `focus <css-sel> [index]` | focus the `index`-th (default 0) match — needed before `type` |
| `type <text>` / `press <key>` | keyboard input into whatever has focus |
| `wait <css-sel>` | wait up to 10s for selector, reports found/TIMEOUT |
| `eval <js>` | evaluate expression in the page, prints JSON |
| `text [css-sel]` | print `innerText` of selector (default: whole body) — cheap alternative to a screenshot when you just need to confirm text/state |
| `windows` | list Electron window URLs |
| `stub-dialogs <openPath> <savePath>` | monkey-patch `dialog.showOpenDialog`/`showSaveDialog` in the main process so folder pickers / save-as dialogs resolve instantly instead of popping a real OS modal |
| `sleep <ms>` | pause — use after a click that changes disabled/enabled state (see Gotchas) |
| `quit` | close the app |

### Run (human path)

```bash
pnpm --filter @polenta/desktop dev   # opens a real window with HMR
```

## Gotchas

- **`ELECTRON_RUN_AS_NODE=1` in the ambient shell breaks the launch.** This
  driver itself typically runs from inside an Electron-based host (VS Code /
  Claude Code), which sets this env var for its own embedded Node processes.
  If inherited by the launched app, `require('electron').app` is `undefined`
  and the main process crashes on `electron.app.whenReady()`. The driver
  strips it from the child env — if you write your own launcher, do the same
  (`delete env.ELECTRON_RUN_AS_NODE`, not just `env.ELECTRON_RUN_AS_NODE =
  undefined` — spreading `process.env` copies the key in first).

- **Electron's CLI arg order matters on Windows: app path first, flags after.**
  `electron.exe --no-sandbox <appDir>` fails with `bad option: --no-sandbox`
  and refuses to start (Playwright only reports the generic "Process failed
  to launch!" — the real reason only shows up running `electron.exe` directly
  outside Playwright). Use `electron.exe <appDir> --no-sandbox`.

- **Isolate `--user-data-dir`.** Without `ELECTRON_USER_DATA_DIR` set, the
  test run shares the developer's real Polenta profile: `auth.json`, recent
  projects, and (separately, see below) keytar tokens. Always point it at a
  throwaway folder.

- **`keytar` tokens are NOT scoped by `--user-data-dir`** — they live in the
  OS credential store (Windows Credential Manager / macOS Keychain), keyed
  only by the service name baked into `auth.service.ts`. If the developer has
  ever logged in for real on this machine, `hasAnyAccount()` returns `true`
  immediately and the app skips `/login` entirely on every automated run too
  — you'll land straight on the account/project chooser. Don't assume you
  need to drive the login form; check with a screenshot first.

- **Cold boot sometimes shows a stray "Not Found" in the main content pane**
  alongside a perfectly normal sidebar (ActivityBar + ProjectPanel render
  fine). This looks like a TanStack Router initial-history-entry mismatch on
  the `file://` entry URL, self-inconsistently present whether or not T77's
  changes are in the tree. One real client-side `navigate()` call fixes it —
  clicking any sidebar link (e.g. `click-text Créer un nouveau projet`, or a
  recent-project link) is enough. Don't waste time trying to select inside
  the "Not Found" pane; navigate away from it first.

- **A button existing in the DOM doesn't mean it's clickable.** The
  `ActivityBar` tabs that require a project (`requiresProject: true`) are
  always rendered, just `disabled` while no project is loaded — `wait` only
  checks *existence*, not the `disabled` attribute, so `click
  button[title="Suivi"]` can silently no-op if fired right after a project
  finishes loading. Add a `sleep 1500` (or wait for a signal that the project
  data is truly ready, e.g. `wait h1` on the project dashboard) before
  clicking a `requiresProject` tab for the first time after opening a
  project. Clicking twice with a short `sleep` in between is a cheap
  safety net.

- **Native folder-picker / save-as dialogs are invisible to Playwright.**
  Where the UI exposes a plain `<input>` for the path (as in Polenta's
  "create project" form), just `focus`+`type` into it directly — skip the
  picker button entirely. Where a native dialog is unavoidable (e.g. Export
  Excel's save-as), use `stub-dialogs` **before** triggering it.

- **`click-text` matches the first DOM match, document order.** A modal
  confirm button can have the same text as the toolbar button that opened it
  (e.g. both say "Sauvegarder"). Once the modal is open, target it with a
  scoped CSS selector via `click` instead (e.g. `div.fixed.inset-0
  button.btn-primary`), not `click-text`.

## Troubleshooting

- **"Process failed to launch!" (generic Playwright error):** run the exe
  directly, bypassing Playwright, to see the real stderr — see the arg-order
  and `ELECTRON_RUN_AS_NODE` gotchas above, both produce this same generic
  error through Playwright.
- **Every command after `launch` reports `ERROR: launch first`:** stdin was
  not fully buffered before commands ran — make sure you're using this
  driver's non-TTY path (`node driver.mjs < file`), not piping into an
  older/different readline-per-line implementation.
