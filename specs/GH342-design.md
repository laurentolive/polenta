# GH342 — Design : multi-fenêtres sur le même projet

Spec : `specs/GH342.md` (décisions D1–D4). Trois sprints.

## Vue d'ensemble

```
main                                               renderer (une instance par fenêtre)
────                                               ─────────────────────────────────
host/app-windows.ts  (nouveau)                     api.app.openWindow(route)
  createAppWindow({ route?, bounds?, … })  ◄─────  app:open-window   (Ctrl+Shift+N, menu d'onglet)
  état par fenêtre : route, dirty          ◄─────  app:window-state  (route de l'onglet actif, dirty)
  garde de fermeture ── app:close-requested ────►  WindowCloseGuard → app:close-window(force)
  dernière fenêtre active (invitations)
  windows-state.json (userData)  ── restauration au lancement ──► index.html?__open=<route>
                                                    boot() : navigate(__open) si le projet existe
```

Le container de services reste unique : rien ne change dans les services métier, hormis la
coalescence du pull automatique (`SyncService.autoSync`, sprint 2).

Côté web, les mêmes appels `api.app.*` sont implémentés par le bridge (`renderer/web/bridge.ts`) :
`app:open-window` → `window.open(route, '_blank')`, `app:window-state` → garde `beforeunload`.
Aucun code de vue ne teste `isWeb` pour ce ticket (sauf le raccourci clavier).

## Sprint 1 — Fenêtres, ouverture sur une page, restauration

### 1.1 `main/host/app-windows.ts` (nouveau)

Sort de `main/index.ts` la création des fenêtres et y ajoute le suivi multi-fenêtres :

```ts
export interface WindowPlacement { x: number; y: number; width: number; height: number; maximized?: boolean; fullScreen?: boolean }
export interface SavedWindow extends WindowPlacement { route?: string }

export function createAppWindow(opts?: { route?: string; placement?: WindowPlacement }): BrowserWindow
export function openWindowFrom(sender: WebContents, route: string): void   // décalage +30/+30, même taille
export function lastFocusedAppWindow(): BrowserWindow | undefined
export function restoreOrCreateWindows(): void                             // au démarrage
export function setWindowState(sender: WebContents, patch: { route?: string; dirty?: boolean }): void
export function forceCloseWindow(sender: WebContents): void
```

- Registre `Map<BrowserWindow, { route?: string; dirty: boolean; forceClose: boolean }>`, et
  ordre d'activation (`focus`) pour `lastFocusedAppWindow()`.
- **Route** : `loadFile(index.html, { search: '__open=<route encodée>' })` en prod,
  `loadURL(<dev url>?__open=…)` en dev — même mécanisme que `__print` (`electron-pdf.ts`).
- `zoomFactor`, `attachContextMenu`, `attachAppZoom`, F12, `app-command`/`swipe` : repris tels quels.
- `main/index.ts` garde le verrou d'instance unique, appelle `restoreOrCreateWindows()` et passe
  `lastFocusedAppWindow()` à `receiveInvite` (la variable `mainWindow` disparaît).

### 1.2 Placement et persistance (`main/host/window-placement.ts`, pur, testé unitairement)

- `offsetPlacement(from: Rectangle, displays): Rectangle` — +30/+30, ramené dans l'aire de
  travail de l'écran de la fenêtre d'origine.
- `fitToDisplays(p: WindowPlacement, displays: { workArea: Rectangle }[], primary): WindowPlacement`
  — garde le placement si la fenêtre est **entièrement** dans l'aire de travail d'un écran ; sinon
  la recentre sur l'écran principal, taille réduite à son aire de travail si besoin (CA11).
- `parseSavedWindows(raw: unknown): SavedWindow[]` — tolérant (fichier absent, JSON invalide,
  entrées partielles → ignorées), au plus 8 fenêtres.

Fichier `userData/windows-state.json` : `{ "version": 1, "windows": SavedWindow[] }`. Fichier
distinct de `app-settings.json` : ce n'est pas une préférence affichée, et il est réécrit à chaque
fermeture.

**Quand l'écrire** (une fenêtre fermée en cours de session ne doit pas être rouverte, D3) :
- `before-quit` → instantané de toutes les fenêtres ouvertes, puis plus aucune écriture
  (`quitting = true`) : couvre Cmd+Q, l'installation d'une mise à jour, `app.quit()`.
- `close` d'une fenêtre, hors `quitting` : si c'est la **dernière** fenêtre de l'application,
  instantané de toutes (elle comprise) — c'est le chemin de sortie habituel sous Windows ; sinon
  rien (la fenêtre disparaît de l'instantané suivant).
- Placement lu par `getNormalBounds()` (taille hors maximisation) + `isMaximized()` /
  `isFullScreen()`.

**Restauration** (`restoreOrCreateWindows`) : une fenêtre par entrée, placement passé par
`fitToDisplays(screen.getAllDisplays())`, `route` si présente ; maximisation / plein écran
réappliqués après création. Aucune entrée → une fenêtre comme aujourd'hui, à la taille par défaut
1280×800. Une invitation `polenta://` en attente est prise par la première fenêtre (inchangé :
`takePendingInvite` est consommé une fois).

Routes non restaurées (fenêtre ouverte sans `__open`, démarrage habituel) : `/`, `/login`, et toute
route sans `projectId`.

### 1.3 Route de la fenêtre et garde « non sauvegardé » remontées au main

`renderer/hooks/useWindowState.ts` (nouveau), monté dans `AppChrome` (`routes/__root.tsx`) :
- envoie `api.app.setWindowState({ route })` à chaque changement de l'URL de l'onglet actif
  (`pathname + searchStr`), débouncé 300 ms ;
- envoie `{ dirty }` quand `dirtyTabIds.size > 0` change.

Channel desktop-only `app:window-state` ; dans le bridge web : `route` ignoré, `dirty` pose / retire
un écouteur `beforeunload` (§7 de la spec).

### 1.4 Boot du renderer (`renderer/main.tsx`)

Nouvelle branche entre `__print` et la navigation forcée vers `/` :

```ts
const openTarget = bootParams.get('__open')        // desktop : route d'une nouvelle fenêtre
if (openTarget && await routeProjectExists(openTarget)) navigate(openTarget, replace)
else if (isWeb && location.pathname !== '/') navigate(location.pathname + location.search, replace)   // lien direct web (D4)
else navigate('/', replace)
```

- `routeProjectExists` : pas de `projectId` → faux ; sinon `api.workspace.resolve(decodeProjectId)`
  sans erreur → vrai (projet déplacé ou supprimé → démarrage habituel).
- Le quirk `file://` (T114) ne concerne que le desktop : la branche web garde l'URL d'entrée telle
  quelle, la navigation explicite suffit à forcer le bon premier match.
- Le `__open` est retiré de l'URL (comme `__print`) : la route ouverte devient la première entrée
  de l'historique de l'onglet.
- Effet de bord voulu côté web : F5 recharge la page courante au lieu de revenir à l'accueil du
  projet.

### 1.5 Ouverture d'une nouvelle fenêtre

- `api.app.openWindow(route: string)` → channel desktop-only `app:open-window` → `openWindowFrom`.
  Route validée côté main : chaîne commençant par `/`, sans `//` initial ni schéma, longueur ≤ 4096.
- Web (bridge) : `window.open(route, '_blank', 'noopener')`.
- **Raccourci** : `useTabShortcuts` gère Ctrl/Cmd+Shift+N sur le desktop seulement → route de
  l'onglet actif (`hrefOfTab(activeTab)`, nouveau helper exporté de `lib/tabHistory.ts` :
  `pathname + '?' + URLSearchParams(searchParams)`).
- **Menu d'onglet** : `TabBar` → `onContextMenu` sur un onglet ouvre `NodeContextMenu` (composant
  générique existant) avec « Ouvrir dans une nouvelle fenêtre » (`api.app.openWindow(hrefOfTab(tab))`)
  et « Fermer l'onglet » (`attemptCloseTab`). Raccourci affiché dans le libellé (desktop).
- La nouvelle fenêtre a son propre `TabsProvider` : un onglet sur la route reçue (copie, D1).

### 1.6 Fichiers sprint 1

| Fichier | Changement |
|---|---|
| `main/host/app-windows.ts` | nouveau (§1.1–1.2) |
| `main/host/window-placement.ts` (+ test) | nouveau, pur |
| `main/index.ts` | création des fenêtres déléguée ; invitations → `lastFocusedAppWindow()` |
| `main/ipc/desktop-only.handlers.ts`, `ipc/channels.ts` | `app:open-window`, `app:window-state`, `app:close-window` |
| `packages/api-client/src/{types,ipc-client}.ts` | `app.openWindow`, `app.setWindowState`, `app.closeWindow` |
| `renderer/web/bridge.ts` | implémentations web |
| `renderer/main.tsx` | branche `__open`, lien direct web |
| `renderer/hooks/useWindowState.ts`, `routes/__root.tsx` | nouveau hook |
| `renderer/hooks/useTabShortcuts.ts` | Ctrl+Shift+N |
| `renderer/components/layout/TabBar.tsx` | menu contextuel d'onglet |
| `renderer/lib/tabHistory.ts` | `hrefOfTab` |
| `renderer/i18n/*` | libellés (fr, en) |

## Sprint 2 — Événements par fenêtre, fermeture, pull automatique

### 2.1 Terminal
`TerminalService` reçoit `send(owner: number, channel, ...args)` au lieu de `broadcast` ; le desktop
l'implémente par `webContents.fromId(owner)?.send(…)`. Le filtrage par id de session côté renderer
reste (défense en profondeur).

### 2.2 Dialogues natifs
Helper `parentOf(e) = BrowserWindow.fromWebContents(e.sender) ?? undefined` ; tous les
`showOpenDialog` / `showSaveDialog` / `showMessageBox` / `showErrorBox` de
`desktop-only.handlers.ts` passent la fenêtre parente (`app:open-link` : l'émettrice, plus
`getFocusedWindow()`).

### 2.3 Invitation
`receiveInvite` cible `lastFocusedAppWindow()` et lui envoie `app:invite` (plus de diffusion).

### 2.4 Garde de fermeture (desktop)
- `win.on('close')` : si l'état de la fenêtre est `dirty`, pas `forceClose`, pas `quitting` →
  `event.preventDefault()` et `webContents.send('app:close-requested')`.
- Renderer : `WindowCloseGuard` (dans `AppChrome`) écoute `app:close-requested`, quitte le champ
  actif (`blur`, même flush que `attemptCloseTab`), puis ouvre une confirmation listant les onglets
  non sauvegardés : « Fermer quand même » → `api.app.closeWindow()` (`forceClose = true` +
  `win.close()`), « Annuler » → rien.
- Avant toute fermeture (dirty ou non), un flush des saisies en attente : `close` non forcé →
  `preventDefault`, `app:close-requested` ; le renderer blur le champ actif, attend la fin des
  écritures en cours (`flushPendingEdits()` : registre global de promesses d'autosave alimenté par
  `EditView` / `SystemView`, délai max 2 s), puis ferme ou demande confirmation. Délai de garde
  côté main : sans réponse en 5 s (renderer bloqué), fermeture forcée.
- `quitting` (`before-quit` : Cmd+Q, installation de mise à jour) : pas de garde — l'installation a
  déjà sa propre confirmation (GH302).

### 2.5 Pull automatique une fois par projet
Coalescence dans `SyncService.autoSync` (main, donc aussi pour plusieurs onglets web d'un même
utilisateur) : par `repoPath + branche`, un appel en cours est partagé, et un résultat de moins de
30 s est renvoyé tel quel (l'intervalle minimal est 1 min). Les fenêtres gardent leur minuterie ;
seul le réseau est dédoublonné. Alternative rejetée : élire une fenêtre « maîtresse » côté
renderer — plus de code, fragile à la fermeture de la fenêtre élue.

### 2.6 Fichiers sprint 2
`main/services/terminal.service.ts`, `main/index.ts`, `main/ipc/desktop-only.handlers.ts`,
`main/host/app-windows.ts`, `main/services/sync.service.ts` (+ test), `renderer/components/layout/WindowCloseGuard.tsx`
(nouveau), `renderer/lib/pendingEdits.ts` (nouveau), `renderer/components/system/{EditView,SystemView}.tsx`
(enregistrement des écritures en cours), `routes/__root.tsx`, i18n.

## Sprint 3 — Même élément édité dans deux fenêtres (D2)

### 3.1 Utilitaire pur `renderer/lib/draftSync.ts` (+ test)

Modèle commun : un formulaire est une table `clé → texte` (titre, champs, …).

```ts
/** Clés modifiées ailleurs (server ≠ base) alors que le brouillon diverge aussi (draft ≠ base et ≠ server). */
export function externalConflicts(base, draft, server): string[]
/** Adopte les changements extérieurs sans conflit : retourne { draft, base } à jour. */
export function adoptExternal(base, draft, server): { draft; base; conflicts: string[] }
export function changedKeys(base, draft): string[]
```

### 3.2 Pages exigence et test (`routes/req.$reqId.tsx`, `routes/test.$testId.tsx`)

Hook `useDraftForm(serverSnapshot)` (dans `lib/draftSync.ts`) : garde `base` (dernier état serveur
réconcilié) et `draft` ; à chaque nouvel instantané serveur, `adoptExternal` ; expose `conflicts`,
`reload(keys)` (draft[k] = base[k] = server[k]), `keep(keys)` (base[k] = server[k] : la saisie sera
envoyée), `changed`.
- `hasChanges` = `changedKeys(base, draft).length > 0` (au lieu de comparer à l'objet serveur
  courant, qui faisait apparaître / disparaître le point « modifié » au gré des écritures d'ailleurs).
- Enregistrement : seulement les clés modifiées — `title` si modifié, `fields` réduits aux champs
  modifiés (le service fusionne déjà `{ ...existing.fields, ...dto.fields }`) ; test : `status`,
  `objectTypeRef`, `preconditions`, `postconditions`, `steps` (clé unique, JSON) seulement si
  modifiés.
- Clés : `title`, `field:<nom>` ; test en plus `type`, `status`, `preconditions`,
  `postconditions`, `steps`.

### 3.3 Vue Édition (`components/system/EditView.tsx`)

Dans la branche « même objet, refetch » de l'effet `[objectData]`, `externalConflicts(prevServer,
mirror, objectData)` → état `conflicts`. Les champs sans conflit sont déjà adoptés (code actuel).
- « Recharger » : `mirror[k] = objectData[k]`, remontage du `FieldControl` concerné (clé
  `field.name + reloadGen`) pour remplacer son tampon d'affichage.
- « Garder ma saisie » : ferme le bandeau ; le flush suivant envoie la saisie (le miroir diffère du
  nouvel instantané serveur).
- Un enregistrement réussi du champ retire sa clé des conflits.

### 3.4 Bandeau `components/ExternalChangeBanner.tsx` (nouveau)
Libellés des champs (titre / libellé du schéma), boutons « Recharger » / « Garder ma saisie ».
`data-testid="external-change-banner"`. Mêmes classes que les bandeaux d'avertissement existants.

## Hors design (spec § Hors périmètre)
Cellules Tableau / Document, éditeur d'étapes inline, arbre (`tree:save` écrit le fichier entier),
préférences `localStorage` communes.

## Mises à jour SPEC prévues (dernier sprint)
`SPEC-PROJECT-MANAGEMENT.md` §1/§5/§7 (réécriture), `SPEC-ELECTRON-DESKTOP.md` §16 (boot `__open`,
lien direct web), §19.1 (menu d'onglet, Ctrl+Shift+N, garde de fermeture), §19.13 (terminal par
fenêtre), `SPEC-FORKS-BRANCHES-BASELINES.md` §2.5 (coalescence), `SPEC-WEB.md` (nouvel onglet,
lien direct, `beforeunload`).

## Risques
- **Tests desktop existants** relançant l'app sur le même profil : la restauration rouvre désormais
  la dernière page au lieu de l'accueil du projet. Vérifier les specs `e2e-desktop` concernées.
- Électron : `getNormalBounds()` sur une fenêtre maximisée renvoie la taille restaurée — voulu.
