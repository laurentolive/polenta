# GH26 — Design technique : mise à jour automatique de l'application

Spec : `specs/GH26.md` — Issue #26

## 1. Vue d'ensemble

```
GitHub Release vX.Y.Z  ──(latest.yml, Setup.exe, .blockmap)──┐
                                                             │ HTTPS (provider github, repo public)
main  ── AppSettingsService (userData/app-settings.json) ─┐  │
     └─ UpdateService (electron-updater) ◄────────────────┴──┘
            │ état UpdateState  ── 'update:state-changed' (push, toutes fenêtres)
            │                   ── 'update:get-state' / 'update:install' (invoke)
renderer ── useUpdateState() ── UpdateBadge (bas de l'ActivityBar) ── popover
         └─ AccountPanel › Préférences ── case « Rechercher automatiquement… »
```

Un seul sprint (périmètre modeste, fortement couplé : packaging, service main, UI).

## 2. Fichiers à modifier / créer

### 2.1 Packaging & CI

| Fichier | Modification |
|---------|--------------|
| `apps/desktop/electron-builder.yml` | `win.target: nsis` ; `win.artifactName: "Polenta-Setup-${version}.${ext}"` ; bloc `nsis: { oneClick: true, perMachine: false, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: Polenta }` ; bloc `publish: { provider: github, owner: laurentolive, repo: polenta, releaseType: release }`. Commentaire existant sur `${version}` conservé. |
| `apps/desktop/package.json` | script `package` : `electron-builder --publish never` (la présence de `publish` ferait sinon tenter à electron-builder une publication sur tag en CI ; c'est `action-gh-release` qui téléverse). `latest.yml` est généré même avec `--publish never`. |
| `.github/workflows/release.yml` | `files:` multi-ligne : `apps/desktop/dist/*.exe`, `apps/desktop/dist/*.exe.blockmap`, `apps/desktop/dist/latest.yml`. |

Aucune dépendance à ajouter : `electron-updater` 6.8.3 et `electron-builder` 24.13.3 sont
installés et compatibles (format `latest.yml` v2, `sha512` + blockmap différentiel).

### 2.2 Main process

**Nouveau — `src/main/services/app-settings.service.ts`**

Préférences *de l'application* (pas du projet), fichier `userData/app-settings.json`, même
pattern que `workspace.json` (`WorkspaceService`) : lecture synchrone tolérante (fichier absent
ou JSON invalide → défauts), écriture complète.

```ts
export interface AppSettings { autoCheckUpdates: boolean }   // défaut : true
export class AppSettingsService {
  get(): AppSettings
  set(patch: Partial<AppSettings>): AppSettings
}
```

**Nouveau — `src/main/services/update.service.ts`**

```ts
export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  availableVersion?: string     // renseigné dès 'downloading'
  releaseUrl?: string           // https://github.com/laurentolive/polenta/releases/tag/v<availableVersion>
}

export class UpdateService {
  constructor(settings: AppSettingsService)
  /** Planifie une vérification unique ~10 s après l'appel. No-op si !app.isPackaged
   *  (sauf POLENTA_FORCE_DEV_UPDATE=1, cf. §4) ou si settings.autoCheckUpdates === false. */
  scheduleStartupCheck(delayMs = 10_000): void
  getState(): UpdateState
  /** quitAndInstall(isSilent=true, isForceRunAfter=true). No-op si status !== 'ready'. */
  install(): void
}
```

Configuration `autoUpdater` (import `{ autoUpdater } from 'electron-updater'`) :
- `autoDownload = true`, `autoInstallOnAppQuit = true`, `allowPrerelease = false`,
  `allowDowngrade = false`.
- `logger` : petit adaptateur vers `console` préfixé `[update]` (pas de nouvelle dépendance
  type `electron-log`).
- Événements → transitions d'état : `checking-for-update` → checking ; `update-available` →
  downloading (+ version, releaseUrl) ; `update-not-available` → idle ; `update-downloaded` →
  ready ; `error` → error (journalisé, **jamais** remonté en UI : le badge n'affiche que
  `ready`).
- À chaque transition : `BrowserWindow.getAllWindows().forEach(w => w.webContents.send(
  'update:state-changed', state))` — plusieurs fenêtres possibles (menu « Ouvrir dans une
  nouvelle fenêtre »).
- `checkForUpdates()` encapsulé dans `try/catch` (la promesse rejette hors ligne en plus de
  l'événement `error`).
- `releaseUrl` construit à partir de la version (pas depuis `releaseNotes`, inutile ici).

**`src/main/container.ts`** — instancie `AppSettingsService` et `UpdateService`, les passe à
`registerIpcHandlers`.

**`src/main/index.ts`** — après `createAppWindow()` : `container.update.scheduleStartupCheck()`.
`createContainer()` retourne aujourd'hui `Promise<void>` : il retournera `{ update }` (seul
service nécessaire hors IPC), sans changer le reste du câblage.

**`src/main/ipc/index.ts`** — section « App » :

| Canal | Signature |
|-------|-----------|
| `app:get-settings` | `() => AppSettings` |
| `app:set-settings` | `(patch: Partial<AppSettings>) => AppSettings` |
| `update:get-state` | `() => UpdateState` |
| `update:install` | `() => void` |
| `update:state-changed` | push main → renderer, payload `UpdateState` |

### 2.3 Types & api-client

- `packages/types` : `AppSettings`, `UpdateStatus`, `UpdateState` (partagés main/renderer).
- `packages/api-client/src/types.ts` : sous `app` → `getSettings()`, `setSettings(patch)` ;
  nouveau namespace `update` → `getState()`, `install()`.
- `ipc-client.ts` : implémentations `invoke(...)` correspondantes. L'abonnement push reste
  dans le renderer via `window.polenta.on('update:state-changed', …)` (même convention que
  `useLiveFileSync` / `useMenuEvents`, l'ApiClient n'expose pas d'événements).

### 2.4 Renderer

**Nouveau — `src/renderer/hooks/useUpdateState.ts`** : `useQuery(['update-state'],
api.update.getState)` + `window.polenta.on('update:state-changed', s =>
qc.setQueryData(['update-state'], s))`. Le `get-state` initial couvre le cas où la fenêtre
monte après `update-downloaded` (nouvelle fenêtre ouverte plus tard).

**Nouveau — `src/renderer/components/layout/UpdateBadge.tsx`** :
- Rendu uniquement si `status === 'ready'`.
- Bouton 48×48 en bas de l'`ActivityBar` (`mt-auto`), icône lucide `ArrowDownCircle` + pastille
  `bg-accent` 6 px ; `title` = « Polenta vX.Y.Z est disponible ».
- Clic → popover ancré à droite (même shell visuel que `PublishPopover` : `bg-surface
  border-edge rounded-lg shadow-xl`, Escape/clic extérieur ferment) contenant :
  version actuelle → nouvelle, lien « Voir les nouveautés » (`<a target="_blank">` — à
  vérifier : si `setWindowOpenHandler` n'est pas configuré pour ouvrir le navigateur, ajouter
  un IPC `app:open-external(url)` restreint aux URL `https://github.com/laurentolive/polenta/`),
  bouton primaire « Redémarrer pour installer ».
- **Garde onglets non enregistrés** : si `useTabs().dirtyTabIds.size > 0`, le clic affiche une
  confirmation (« Des modifications non enregistrées seront perdues ») avant `api.update.install()`.
  Les onglets dirty tiennent des modifications de formulaire **en mémoire**, non écrites sur
  disque — cf. §5 divergence.

**`src/renderer/components/layout/ActivityBar.tsx`** : `<UpdateBadge />` après la liste
`PANELS`.

**`src/renderer/components/sidebar/AccountPanel.tsx`** — section « Préférences » existante
(thème, langue = préférences app-level) : ligne « Mises à jour auto. » + case à cocher liée
à `api.app.getSettings()/setSettings({ autoCheckUpdates })`, mention discrète
« effectif au prochain démarrage ».

**i18n** `fr.json` / `en.json` : clés `update.badge.title`, `update.popover.current`,
`update.popover.available`, `update.popover.releaseNotes`, `update.popover.install`,
`update.popover.dirtyWarning`, `account.panel.autoUpdate`, `account.panel.autoUpdateHint`.

### 2.5 SPEC à mettre à jour en fin de sprint

- `SPEC-TECH-stack.md` §9 : ligne « Application desktop » (NSIS par utilisateur, plus de
  portable), ligne « Mises à jour » (déclenchement différé 10 s, préférence, badge, install à la
  fermeture), mention `latest.yml`/blockmap publiés par la CI.
- `SPEC-ELECTRON-DESKTOP.md` §11 (canaux `app:get/set-settings`, `update:*`), §13 (appel
  `scheduleStartupCheck`), §19 (badge en bas de l'ActivityBar).
- `SPEC-MCP-SERVER.md` §2.4 : `process.resourcesPath` désormais sous
  `%LOCALAPPDATA%\Programs\Polenta\resources` (stable entre mises à jour).

## 3. Décisions techniques et alternatives rejetées

| Décision | Alternative rejetée | Raison |
|----------|--------------------|--------|
| NSIS one-click par utilisateur | `portable` + détection seule | Choix produit validé (auto-update complet) ; portable non supporté par electron-updater. |
| NSIS one-click par utilisateur | `perMachine: true` | Exigerait l'admin (hors scope). |
| `--publish never` + `action-gh-release` | Laisser electron-builder publier (`GH_TOKEN`) | Garde le flux de release actuel (notes générées par `release-notes.mjs`) inchangé. |
| `app-settings.json` dans `userData`, lu par main | `localStorage` (comme le thème) | Le main doit connaître la préférence **avant** que le renderer ne soit monté. |
| `app-settings.json` dédié | Ajouter le champ à `workspace.json` | `workspace.json` = liste des projets récents ; ne pas y mélanger les réglages. |
| Badge en bas de l'ActivityBar | Barre de titre native | Titre natif non stylable ; l'ActivityBar est toujours visible, même sans projet. |
| Erreurs uniquement journalisées | Badge « erreur » | Exigence spec : ne pas importuner l'utilisateur. |
| `console` comme logger | `electron-log` | Pas de nouvelle dépendance pour un besoin de diagnostic ponctuel. |

## 4. Testabilité locale

electron-updater ignore les vérifications si `!app.isPackaged`. Pour tester sans publier :
- **Mode réel** (recommandé) : installer `Polenta-Setup-0.0.7.exe` local construit, puis publier
  une release de test sur un fork / ou tester contre la vraie release suivante.
- **Mode dev** : `POLENTA_FORCE_DEV_UPDATE=1 pnpm dev` → `autoUpdater.forceDevUpdateConfig =
  true`, lit `apps/desktop/dev-app-update.yml` (provider github laurentolive/polenta) ; utile
  pour vérifier détection + badge (l'installation elle-même n'a de sens qu'en packagé).
  `dev-app-update.yml` est ajouté au repo (3 lignes) mais exclu du package (`files`).

## 5. Divergence par rapport à la spec — à valider

La spec §2.4 prévoyait « aucune confirmation, les fichiers sont déjà sur disque ». L'analyse
montre que les éditeurs (exigence, test, schéma…) gardent les saisies **en mémoire** jusqu'à
l'enregistrement et les signalent via `TabsContext.dirtyTabIds`. Le design ajoute donc une
confirmation **uniquement** lorsqu'au moins un onglet de la fenêtre courante est dirty ; sinon
le redémarrage est immédiat. Limite connue : les onglets dirty d'*autres* fenêtres ne sont pas
vus (fenêtres multiples rares) — acceptée.

L'installation silencieuse à la fermeture (`autoInstallOnAppQuit`) n'est pas concernée : la
fermeture de l'app perd déjà ces saisies aujourd'hui (aucun garde `beforeunload`).

## 6. Découpage

**Sprint unique** : §2.1 → §2.4, puis §2.5 (mises à jour SPEC, dernier sprint).
