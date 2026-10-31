# GH238 — Design : terminal Git Bash dans la vue Version

Spec : `specs/GH238.md`.

## 1. Dépendances

| Paquet | Version | Licence | Où | Pourquoi |
|---|---|---|---|---|
| `node-pty` | `1.1.0` | MIT | `apps/desktop` (main) | Pseudo-terminal (ConPTY sous Windows). Livre des binaires **N-API prébuilts** (`prebuilds/win32-x64`, `win32-arm64`, `darwin-*`) : pas de node-gyp sous Windows/macOS, compatible avec `npmRebuild: false` |
| `@xterm/xterm` | `6.0.0` | MIT | renderer | Émulateur de terminal |
| `@xterm/addon-fit` | `0.11.0` | MIT | renderer | Ajuste colonnes/lignes à la taille du panneau |

Pas de dépendance GPL (cf. modèle de licences). Les mentions tierces sont régénérées par
`build:notices` (aucune action spécifique).

Packaging (`electron-builder.config.ts`) : `node-pty` est externalisé par `externalizeDepsPlugin`
(comme keytar) et déjà inclus par `node_modules/**/*` ; ajout de `**/node-pty/prebuilds/**` à
`asarUnpack` (`.node`, `conpty.dll`, `OpenConsole.exe`, `winpty-agent.exe` doivent être sur disque).
Vérification au sprint 1 sur un build `pnpm package` (le terminal démarre depuis l'installé).

## 2. Main process

### 2.1 `src/main/services/terminal-shell.util.ts` (pur, testé)

```ts
export interface ShellSpec { name: string; file: string; args: string[] }
export interface ShellProbe {                    // injecté → testable sans le vrai disque
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  exists(p: string): boolean
}
export function resolveShell(p: ShellProbe): ShellSpec | null
export function shellEnv(env: Record<string, string | undefined>, platform: NodeJS.Platform): Record<string, string>
export function cdCommand(repoPath: string, platform: NodeJS.Platform): string
```

- `resolveShell` Windows : pour chaque dossier du `PATH` contenant `git.exe`, racine = parent du
  dossier si celui-ci s'appelle `cmd`, `bin` ou `mingw64\bin` (→ deux niveaux) ; puis
  `%ProgramFiles%\Git`, `%ProgramW6432%\Git`, `%LocalAppData%\Programs\Git`. Première racine
  contenant `bin\bash.exe` → `{ name: 'Git Bash', file: <racine>\bin\bash.exe, args: ['--login', '-i'] }`.
  Aucune → `null`.
- macOS/Linux : `env.SHELL` s'il existe, sinon `/bin/bash` ; `args: ['-l']` ; nom = basename.
- `shellEnv` : copie de l'environnement sans les clés `ELECTRON_*` ni `POLENTA_*`, plus
  `TERM=xterm-256color`, `COLORTERM=truecolor` et, sous Windows, `CHERE_INVOKING=1` — sans elle le
  `/etc/profile` de Git Bash fait `cd ~` et ignore le `cwd` du processus.
- `cdCommand` : `cd '<chemin>'` + `\r`, apostrophes échappées (`'\''`). Windows :
  `C:\Dev\x` → `/c/Dev/x` (forme MSYS).

### 2.2 `src/main/services/terminal.service.ts`

Service **desktop seulement** (pas dans le `Container` partagé avec le serveur web) : instancié
dans `registerDesktopOnlyHandlers`. `node-pty` chargé par `require` paresseux au premier `start`
(un échec de chargement du module natif devient une erreur lisible, pas un crash au lancement).

```ts
type DetectResult =
  | { status: 'found'; shell: { name: string; file: string } }
  | { status: 'not-found'; winget: boolean }              // winget seulement sous Windows

class TerminalService {
  constructor(private send: (channel: string, ...args: unknown[]) => void) {}
  detect(): Promise<DetectResult>
  start(kind: 'shell' | 'install-git', cwd: string, cols: number, rows: number): Promise<{ id: string; name: string }>
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  kill(id: string): void
  killAll(): void
}
```

- Sessions dans une `Map<id, IPty>` (une seule utilisée par le renderer, la map couvre la
  transition « tuer → relancer »). Sortie poussée par `send('terminal:data', id, chunk)` ; fin par
  `send('terminal:exit', id, exitCode)` puis suppression de la map.
- `detect` : `resolveShell` + (si `null` sous Windows) `winget --version` par `execFile`, délai
  5 s, résultat mis en cache pour la durée de vie du processus (winget ne s'installe pas en
  cours de route ; Git oui, d'où la détection du shell **non** mise en cache).
- `start('install-git')` : pty sur `winget` avec les arguments de la spec §5, cwd = home.
- `kill` : `pty.kill()` ; sous Windows, en plus `taskkill /PID <pid> /T /F` (ignore les erreurs)
  pour les descendants (`git-remote-https`, `less`…) que ConPTY ne termine pas toujours.
- `killAll` branché sur `app.on('will-quit')` (main/index.ts).

### 2.3 Canaux IPC (`desktop-only.handlers.ts`, `channels.ts`)

Ajoutés à `DESKTOP_ONLY_CHANNELS` : `terminal:detect`, `terminal:start`, `terminal:write`,
`terminal:resize`, `terminal:kill`, `terminal:open-git-download` (ouvre l'URL **fixe**
`https://git-scm.com/downloads` par `shell.openExternal` — pas d'ouvreur d'URL générique).
Événements poussés : `terminal:data`, `terminal:exit` (via `electronPlatformHost.broadcast`).

`packages/api-client` : section `terminal` dans `types.ts` / `ipc-client.ts` (mêmes noms). Les
événements sont écoutés par `window.polenta.on` comme `nav:history` / `update:state-changed`.

## 3. Renderer

### 3.1 `src/renderer/components/terminal/terminalShortcut.ts` (pur, testé)

- `isTerminalToggleShortcut(e)` : `Ctrl` (pas `Meta`, `Shift`, `Alt`), pas d'auto-répétition,
  `e.key === 'ù' || e.key === '`' || e.code === 'Backquote'`. **Pas** de filtre « cible
  éditable » (contrairement à `Ctrl+B`) : le raccourci doit marcher depuis le terminal et depuis
  un champ.
- `isVersionRoute(pathname)` : `/graph`, `/diff`, `/version-diff`, `/baseline` (même liste que
  `deducePanel` ; `/versioning` redirige vers `/graph`).
- `QuietRefresh` : petite classe (`armed` par Entrée, `onOutput()` relance un minuteur de 500 ms,
  `flush` appelle le callback si armé) — testée avec les faux minuteurs de vitest.

### 3.2 `src/renderer/contexts/TerminalContext.tsx`

Monté dans `AppLayout` **à l'intérieur** de `SelectedRepoProvider` (donc sous son
`key={currentProjectId}`) : un changement de projet démonte le provider, dont le nettoyage tue la
session (spec §4).

État : `open`, `height` (défaut 260 px), `status: 'idle' | 'detecting' | 'not-found' | 'installing' | 'running' | 'exited'`,
`winget`, `shellName`, `sessionRepo`, `sessionId`. L'instance xterm (`Terminal` + `FitAddon`) vit
dans une `ref` du provider, créée à la première ouverture, détruite au démontage : masquer le
panneau ne la détruit pas.

Actions exposées : `toggle()`, `close()`, `clear()`, `kill()`, `cdToSelected()`, `install()`,
`recheck()`, `setHeight()`.

- `toggle` / première ouverture → `detect` → `found` : `start('shell', selectedRepoPath, cols, rows)` ;
  `not-found` : état `not-found`.
- `onData` xterm → `terminal.write` ; si la donnée contient `\r` → `QuietRefresh.arm()`. En état
  `exited`, `\r` relance un shell dans le repo sélectionné.
- `terminal:data` (id courant) → `term.write` + `QuietRefresh.onOutput()`.
- `terminal:exit` : shell → écrit `[processus terminé — code n] Appuyez sur Entrée pour relancer`,
  état `exited`, rafraîchissement ; install-git → `recheck()` puis démarrage du shell si trouvé,
  sinon code ≠ 0 → `openGitDownload`.
- Rafraîchissement : `queryClient.invalidateQueries({ predicate })` sur les requêtes dont la clé
  commence par `sync:` ou `git` et contient `sessionRepo` ou `selectedRepoPath` — couvre
  `sync:status`, `sync:graph`, `sync:branches`, `sync:tags`, `sync:integration-state`,
  `git-tags`, `git:head-sha`… sans liste à maintenir.
- Raccourci global : `keydown` sur `window` en **capture** (passe avant xterm et avant les
  gestionnaires des vues) ; actif seulement si `isVersionRoute(pathname)` ; `preventDefault` +
  `stopPropagation`.

### 3.3 `src/renderer/components/terminal/TerminalPanel.tsx`

Rendu dans `AppLayout`, colonne de droite, **après** `<main>` ; toujours monté dès qu'une session
a été créée, masqué par `hidden` (CSS) quand `!open || !isVersionRoute` — le DOM xterm reste
attaché, buffer et état conservés.

- Poignée haute (4 px, même style que la poignée du panneau latéral) → `setHeight` borné
  [80 px, 70 % de la hauteur de la colonne] ; `fit()` + `terminal.resize` sur `ResizeObserver`.
- En-tête : `name` + nom du repo (`title` = chemin) ; « Aller au repo sélectionné » si
  `selectedRepoPath !== sessionRepo` ; Effacer, Tuer, ×.
- Corps : div hôte de xterm (`term.open` une seule fois) ; `onKeyDown` qui `stopPropagation`
  (les raccourcis des vues — `F7`, `Ctrl+S` du diff, `Ctrl+B`… — ne voient pas les touches du
  terminal). `attachCustomKeyEventHandler` : `Ctrl+C` avec sélection → copie
  (`navigator.clipboard.writeText`) ; `Ctrl+Maj+C` → copie ; `Ctrl+V` / `Ctrl+Maj+V` → `false`
  sans `preventDefault` (le `paste` natif est traité par xterm).
- Clic droit : petit menu Copier / Coller / Effacer (le menu contextuel natif de
  `host/context-menu.ts` est neutralisé par `preventDefault` sur la zone).
- État `not-found` : message + boutons Installer Git (winget → `install()`, sinon
  `openGitDownload`) et Revérifier, à la place du terminal.
- Thème : couleurs `background` / `foreground` / `cursor` / `selectionBackground` lues depuis
  les variables CSS des tokens (`--canvas`, `--ink`…) ; `MutationObserver` sur la classe `dark`
  de `<html>` → `term.options.theme = …`. Police : pile monospace déjà utilisée par les vues
  Raw (CodeMirror). `scrollback: 5000`.

### 3.4 Points d'entrée

- `VersionPanel.tsx` : bouton icône `SquareTerminal` (lucide) dans le header, `toggle()`.
- `AppLayout.tsx` : `TerminalProvider` + `TerminalPanel`.
- i18n `fr.json` / `en.json` : clés `terminal.*`.

## 4. Décisions et alternatives rejetées

- **`invoke` par frappe** pour `terminal:write` : le preload n'expose que `invoke`/`on` ; un
  `send` dédié serait plus léger mais ajoute une surface au preload pour un gain invisible à
  l'échelle de la frappe humaine (et d'un collage, envoyé en un seul appel).
- **Panneau masqué par CSS** plutôt que démonté + `term.open` sur un nouvel hôte : xterm ne
  supporte pas proprement le ré-attachement à un autre élément.
- **Service hors `Container`** : le conteneur est partagé avec le serveur web ; `node-pty` ne
  doit pas y être chargé.
- `@lydell/node-pty` (fork prébuilt, aussi Linux) : seulement en bêta ; `node-pty` 1.1.0 officiel
  suffit pour Windows/macOS. Linux non packagé à ce jour (compilation node-gyp si besoin).

## 5. Découpage

- **Sprint 1** — main : dépendance `node-pty`, `terminal-shell.util.ts` (+ tests),
  `terminal.service.ts`, canaux, api-client, `killAll` à la sortie, packaging (`asarUnpack`) et
  vérification sur build packagé.
- **Sprint 2** — renderer : xterm, `terminalShortcut.ts` (+ tests), `TerminalContext`,
  `TerminalPanel`, bouton, i18n, e2e desktop `e2e-desktop/gh238-terminal.spec.ts`, mises à jour
  SPEC.

## 6. Écarts constatés en cours de développement

- **Un seul sprint** : main et renderer livrés ensemble (le service seul n'était pas testable de
  bout en bout).
- **ConPTY de Windows** (`useConptyDll: false`), pas celui livré par node-pty : avec ce dernier, une
  frappe rapide arrivait parfois au shell dans le désordre (`techo` pour `echo`), reproduit en
  e2e et absent avec le ConPTY de Windows (8/8). Regrouper les écritures (comme VS Code) ne
  corrigeait pas.
- **Canal `terminal:cd`** ajouté : la mise en forme du chemin (MSYS) reste dans
  `terminal-shell.util.ts` (main, testée) au lieu d'être dupliquée dans le renderer.
- **Sessions liées à leur webContents** : tuées à une nouvelle page principale (`did-start-navigation`,
  cadre principal, autre document — pas `did-start-loading`, émis aussi par les iframes de la
  visionneuse draw.io) et à sa destruction, le nettoyage React n'ayant pas lieu au rechargement.
- **`taskkill /T`** seulement si le shell vit encore une seconde après `pty.kill()` (PID
  réattribuable sinon).
- **`QuietRefresh`** : reste armé après un rafraîchissement jusqu'à la frappe suivante (une commande
  qui marque une pause est rafraîchie aussi à sa vraie fin) ; `onInput(data)` remplace `arm()`.
- « Aller au repo sélectionné » met à jour le repo affiché dans l'en-tête (repo du shell supposé).
