# GH302 — Design

Spec : `specs/GH302.md`. Deux sprints : **S1 desktop**, **S2 web**.

## Types (`packages/types/src/app.ts`)

```ts
export type UpdateStatus =
  'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'installing'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  availableVersion?: string
  releaseUrl?: string
  /** 'downloading' : 0–100 (entier). */
  progress?: number
  /** Verrou DSI / forge (GH45) : information seulement, ni téléchargement ni installation. */
  managed?: boolean
  /** Web (S2) : version servie par le serveur, différente de celle chargée par la page → recharger. */
  servedVersion?: string
}

/** Préparation de la confirmation d'installation (S1). */
export interface UpdateInstallPlan { mcpServers: number; otherWindows: number }
```

`AppSettings.autoCheckUpdates` **garde sa clé** (fichier `app-settings.json` existant repris tel quel,
spec « valeur reprise ») ; seul son sens change : téléchargement automatique. Commentaires mis à
jour. Alternative rejetée : renommer la clé (migration, tests GH15/GH45, configuration DSI) pour un
gain de lisibilité seul.

## S1 — Desktop

### `UpdateService` (main)

- `scheduleStartupCheck()` : plus de garde sur `autoCheckUpdates` (D1). Gardes conservées : marque sans
  `update`, build non packagé hors `POLENTA_FORCE_DEV_UPDATE`.
- `autoUpdater.autoDownload = false` toujours : le service décide lui-même (`maybeDownload()` sur
  `update-available` : si préférence active et pas de verrou → `downloadUpdate()`). Un seul endroit
  pour la règle, et la préférence prend effet immédiatement (`onSettingsChanged()`, appelé par le
  handler `app:set-settings` : préférence cochée alors que l'état est `available` → téléchargement).
- Verrou : `AppSettingsService.get().autoCheckUpdatesLocked` → `managed: true` dans l'état.
- Événements :
  - `update-available` → `available` (+ version, releaseUrl, managed) puis `maybeDownload()` ;
  - `download-progress` → `downloading`, `progress` arrondi ; diffusion seulement si l'entier change ;
  - `update-downloaded` → `ready` ;
  - `update-not-available` → `idle` sauf si une version est déjà connue (garde l'état) ;
  - `error` → `error` si `availableVersion` connue, sinon `idle` (silencieux, journal seul).
- `checking` n'est plus diffusé quand une version est déjà connue (le bouton ne clignote pas).
- Minuterie : vérification toutes les 4 h (`setInterval`, `unref()`), sautée en `downloading`,
  `ready`, `installing`.
- `download()` (nouveau channel `update:download`, sert aussi « Réessayer ») : refusé si `managed`
  ou sans version connue ; `checkForUpdates()` puis `downloadUpdate()`.
- `prepareInstall(): UpdateInstallPlan` (nouveau channel `update:prepare-install`) : nombre de
  serveurs MCP (`findMcpServerPids`) et de fenêtres autres que l'appelante.
- `install()` : plus de boîte native (la confirmation est dans le renderer). État `installing`
  diffusé, délai court (1,2 s, pour que l'écran s'affiche), arrêt des serveurs MCP, puis
  `quitAndInstall(false, true)` — **non silencieux** : l'installeur NSIS en un clic affiche sa
  fenêtre de progression sans question ; `isForceRunAfter` relance l'app.
- `will-quit` (installation à la fermeture, GH293) inchangé.

### Renderer

- `UpdateBadge` : rendu par état (table de la spec). Composants internes : icône + infobulle,
  popover (titre, versions, notes de version, progression, action). Actions : `api.update.download`,
  ouverture de la confirmation.
- `UpdateInstallConfirm` (nouveau, modal) : appelle `api.update.prepareInstall()`, liste onglets non
  enregistrés (`dirtyTabIds`), autres fenêtres, serveurs MCP ; « Fermer et installer » →
  `api.update.install()`.
- `UpdateInstallingOverlay` (nouveau) : plein écran quand `status === 'installing'`, monté dans
  `AppLayout` (toutes les fenêtres reçoivent l'état).
- `AccountPanel` : libellé et infobulle de la préférence ; plus de « au prochain lancement ».
- i18n FR/EN : `update.*` complétés, `account.panel.autoUpdate*`.

### IPC

`update:download`, `update:prepare-install` ajoutés à `DESKTOP_ONLY_CHANNELS`, au client
(`packages/api-client` : `update.download()`, `update.prepareInstall()`) et à `UNAVAILABLE` du pont web.

## S2 — Web

### Serveur (`apps/desktop/src/web-server`)

- `release-check.ts` (nouveau) : dernière release de la marque, au démarrage puis toutes les 4 h,
  résultat en mémoire.
  - `github` : `GET https://api.github.com/repos/<owner>/<repo>/releases/latest` (`tag_name`, sans le
    `v` ; pré-releases exclues par l'API) ;
  - `generic` : `GET <url>/latest.yml`, ligne `version:` ;
  - marque sans `update` : rien (CA12). Échec : journalisé, résultat précédent conservé.
  - comparaison : `semver` n'est pas une dépendance directe → petite fonction `isNewer(a, b)`
    (X.Y.Z numérique ; une version de dev `-alpha.N` est antérieure à X.Y.Z), testée.
- Channel web-only `web:update-state` → `{ status: 'available' | 'idle', currentVersion: <version du
  serveur>, availableVersion?, releaseUrl? }`. L'information est publique (release GitHub) : le
  filtrage administrateur se fait dans le renderer (alternative rejetée : interroger le service
  d'administration depuis le serveur web pour chaque appel — couplage sans gain de sécurité).

### Pont (`renderer/web/bridge.ts`)

- Version chargée lue une fois au démarrage de la page (`app:get-version`).
- Adaptateur `update:get-state` → `rpc('web:update-state')`, puis `currentVersion` = version chargée et
  `servedVersion` = version du serveur si différente.
- Sondage toutes les 5 min et à `EVENTS_RECONNECTED` : nouvel état émis sur `update:state-changed`
  (le hook `useUpdateState` existant le reçoit sans changement).

### Renderer

- `UpdateBadge` web :
  - `servedVersion` présent → état « nouvelle version », action « Recharger la page »
    (`location.reload()`, avertissement des onglets non enregistrés) — tous les utilisateurs ;
  - sinon `available` et `useAdminMe().me` non nul → état « disponible » informatif : versions, notes
    de version (lien `<a target="_blank">`, `app:open-release-page` n'existe pas en web), marche à
    suivre (`polenta-host instance web enable <instance> --version <v>`) ;
  - sinon rien.
- `capabilities.autoUpdate` reste desktop (préférence masquée en web).

## Tests

Voir `specs/GH302-tests.md`.

## Hors périmètre

Mise à jour en un clic depuis l'administration : issue séparée (publication de l'image `polenta-web`
par la CI, job `web.update`).
