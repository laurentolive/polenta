# GH343 — Design : glisser un onglet, deux projets dans deux fenêtres

Spec : `specs/GH343.md` (décisions D1–D4). Deux sprints : **S1** deux projets (§2–§3 de la spec,
CA8–CA12), **S2** glisser un onglet (§1, CA1–CA7). S1 d'abord : S2 s'appuie sur la fenêtre à
l'accueil « sans saut » (dépôt d'un onglet sur une fenêtre à l'accueil).

Chemins relatifs à `apps/desktop/src/`.

---

## Sprint 1 — Deux projets différents dans deux fenêtres

### 1.1 Saut vers le dernier projet : seulement au lancement, dans la première fenêtre

Aujourd'hui l'accueil (`routes/index.tsx`, effet `init`) redirige vers `getLastOpened()` à chaque
montage, sauf juste après « Fermer le projet » (`consumeProjectJustClosed`).

Nouveau module `renderer/lib/startupJump.ts` (état du renderer, donc par fenêtre) :

```ts
/** Lu au boot : cette fenêtre a le droit de sauter vers le dernier projet (une seule fois). */
export function initStartupJump(allowed: boolean): void
/** Vrai une seule fois, si permis : l'accueil le consomme au moment de lire getLastOpened. */
export function consumeStartupJump(): boolean
```

- **Desktop** : le main passe `__jump=1` dans l'URL d'entrée de la fenêtre qui y a droit
  (`createAppWindow({ jump: true })`) : la fenêtre par défaut d'un premier lancement (aucune
  disposition mémorisée) et la **première** fenêtre rouverte d'une disposition mémorisée (repli si
  sa page n'est plus valide). Toute autre fenêtre (Ctrl+Shift+N, menu d'onglet, fenêtres rouvertes
  suivantes, fenêtre créée par un glisser) n'a pas `__jump`.
- **Web** : un onglet du navigateur a droit au saut à son premier chargement, sauf s'il a été
  ouvert par « Nouvelle fenêtre » (`/?__home=1`, posé par le bridge).
- `main.tsx` lit `__jump` / `__home`, les retire de l'URL (comme `__open`), appelle
  `initStartupJump`.
- `routes/index.tsx` : `if (consumeProjectJustClosed() || !consumeStartupJump()) { setReady(true); return }`
  avant `getLastOpened()`. Consommé **après** le contrôle de compte : premier lancement sans compte
  → `/login` → retour à `/` → le saut a encore lieu.

Écart assumé avec la spec §3 (« sans saut si d'autres fenêtres rouvrent sur un projet ») : règle
plus simple — seule la première fenêtre rouverte peut sauter. Même effet dans le cas visé (les
fenêtres suivantes ne sautent jamais) ; spec mise à jour.

### 1.2 Fenêtres à l'accueil rouvertes à l'accueil

`window-placement.ts` : `isRestorableRoute` accepte aussi `'/'` (accueil). Une fenêtre mémorisée
sur `/` rouvre avec `__open=/` → `canOpen('/')` vrai → accueil, sans saut (pas de `__jump` sauf
première fenêtre ; et la première fenêtre sur `/` rouvre aussi sans saut : `__open` présent →
`initStartupJump(false)`). Les autres routes sans `projectId` (`/login`, `/account`…) restent non
restaurées.

`main.tsx` : `allowed = desktop ? (__jump === '1' && !openTargetSucceeded) : (!__home && pathname === '/')`.
Une première fenêtre rouverte dont la page est invalide (projet supprimé) tombe sur l'accueil avec
`__jump` → saut.

### 1.3 Ouvrir une fenêtre vide ou un autre projet

- **Ctrl+Shift+N depuis l'accueil** : déjà `api.app.openWindow('/')` (route de l'onglet actif) ;
  avec §1.1 la nouvelle fenêtre n'a pas `__jump` → reste sur l'accueil. Web : le bridge ouvre
  `'/?__home=1'` quand la route est `/`.
- **Panneau Projet** (`components/sidebar/ProjectPanel.tsx`) : action « Nouvelle fenêtre »
  (`api.app.openWindow('/')`), desktop et web.
- **Projets récents** (accueil `routes/index.tsx` et `ProjectPanel`) : clic droit →
  `NodeContextMenu` « Ouvrir dans une nouvelle fenêtre » → `markRecent(dir)` puis
  `api.app.openWindow(href)` où `href` = page d'atterrissage du projet (`projectHomeRoute` +
  config d'équipe, comme `goToProject`) sérialisée en `pathname?search`. Nouveau helper
  `lib/projectRoute.ts` → `projectLandingHref(workspaceDir, projectHome?)` partagé avec
  `goToProject`.

### 1.4 « Fermer le projet » n'affecte pas les autres fenêtres

- `workspace:clear-last-opened` prend un paramètre facultatif `workspaceDir` : n'efface le pointeur
  que s'il désigne ce dossier (`WorkspaceService.clearLastOpened(dir?)`). Sans paramètre :
  comportement actuel (menus natifs inutilisés, appel web à la suppression d'un projet).
- Nouveau channel desktop-only `app:project-shown-elsewhere(projectId) → boolean` : une autre
  fenêtre a une route de ce projet (registre `app-windows.ts`). Web (bridge) : `false`.
- `ProjectPanel.handleClose` : `if (!(await api.app.projectShownElsewhere(id))) await api.workspace.clearLastOpened(dir)`,
  puis `markProjectJustClosed()` et `navigate('/')` comme aujourd'hui.
- Les autres fenêtres ne reçoivent rien : leur route ne change pas.

### 1.5 Compte de la forge du projet (D4)

- `AuthService.currentAccount(remoteUrl?)` : avec une URL `http(s)` de remote, le compte de son
  hôte s'il a un jeton (`accountForHost` + `tokenFor`, même choix que git) ; sinon (pas de remote,
  hôte sans compte connecté) le compte par défaut comme aujourd'hui. Channel `auth:current-account`
  gagne le paramètre facultatif.
- `AuthService.logout(key?)` : avec une clé `<hôte>:<login>`, déconnecte ce compte-là ; sans clé,
  comportement actuel. `ForgeAccount` porte déjà de quoi former la clé (`keyOf`) — exposée dans
  `CurrentAccount.key`.
- `hooks/useCurrentAccount.ts` : lit le `projectId` de la route (`deriveCurrentProjectId`), relit
  `workspace.resolve(dir).remoteUrl` (requête `['workspace', projectId]` déjà en cache) et passe
  l'URL ; se recharge quand le projet change. Web : inchangé (le compte est la session).
- `refreshTeamConfig` reste lié au compte par défaut (config d'équipe commune, D4) ; après
  déconnexion du compte d'un projet qui n'est pas le compte par défaut, rien d'autre ne change.

### 1.6 `repo:file-changed` filtré par projet

`hooks/useLiveFileSync.ts` : avant toute invalidation, ignore l'événement si la fenêtre affiche un
projet et que `repoPath` n'en fait pas partie. Appartenance : `repoPath` dans le dossier du
workspace (`decodeProjectId(projectId)`) ou parmi les repos de l'arbre du workspace déjà en cache
(`localParent` peut placer un repo ailleurs) ; comparaison de chemins normalisée (`/`, casse sous
Windows) via un helper pur `lib/pathScope.ts` (+ test). Sans projet affiché (accueil) : tout passe.

### 1.7 Fichiers sprint 1

| Fichier | Changement |
|---|---|
| `renderer/lib/startupJump.ts` (+ test) | nouveau |
| `renderer/main.tsx` | `__jump` / `__home`, `initStartupJump` |
| `renderer/routes/index.tsx` | saut conditionné ; menu « Ouvrir dans une nouvelle fenêtre » sur les récents |
| `renderer/lib/projectRoute.ts` | `projectLandingHref` |
| `renderer/components/sidebar/ProjectPanel.tsx` | « Nouvelle fenêtre », récents, fermeture conditionnelle |
| `main/host/app-windows.ts` | option `jump`, `projectShownElsewhere` |
| `main/host/window-placement.ts` (+ test) | `/` restaurable |
| `main/ipc/channels.ts`, `desktop-only.handlers.ts`, `ipc/index.ts` | `app:project-shown-elsewhere`, paramètres de `clear-last-opened`, `current-account`, `logout` |
| `main/services/workspace.service.ts` (+ test) | `clearLastOpened(dir?)` |
| `main/services/auth.service.ts` (+ test) | `currentAccount(remoteUrl?)`, `logout(key?)` |
| `packages/api-client` | signatures |
| `renderer/web/bridge.ts` | `__home`, `project-shown-elsewhere` |
| `renderer/hooks/useCurrentAccount.ts` | compte du projet |
| `renderer/hooks/useLiveFileSync.ts`, `renderer/lib/pathScope.ts` (+ test) | filtre |
| `renderer/i18n/*` | libellés |

---

## Sprint 2 — Glisser un onglet

### 2.1 Principe

Glisser-déposer HTML5 natif (comme le reste de l'application) pour le geste ; **le contenu de
l'onglet ne voyage pas dans le `dataTransfer`** mais par le main, qui tient le glisser en cours :

```
fenêtre source                     main (app-windows / tab-drag.ts)          fenêtre cible
──────────────                     ────────────────────────────────          ─────────────
dragstart ── app:tab-drag-start ─►  drag = { id, source, projectId,
             (payload)               payload, ready }
  flush des saisies auto ─ ready ─►
                                                                   ◄─ app:tab-drag-info (dragenter)
                                                                       → { projectId } : accepter/refuser
                                    take(id) ◄──────────────────────── drop ─ app:tab-drag-take(id)
  ◄─ app:tab-moved(id) ───────────  (après ready ≤ 2,5 s)             ──► payload → adoptTab
  retire l'onglet (ferme la fenêtre
  si c'était le dernier)
dragend (dropEffect none) ─ app:tab-drag-end(id) ─► curseur hors de toute fenêtre ?
                                    oui → createAppWindow({ adopt: id, placement au curseur })
                                          nouvelle fenêtre : boot → take(id) → app:tab-moved à la source
                                    non → glisser abandonné
```

Le geste reste un glisser HTML5 : entre deux `BrowserWindow` de la même application, Chromium
transporte le glisser (type MIME propre `application/x-polenta-tab`, valeur = id du glisser). Le
`dataTransfer` ne sert qu'à reconnaître le glisser ; `dragover` ne peut pas lire sa valeur, d'où
`app:tab-drag-info` au `dragenter` (réponse mise en cache par la cible pour ses `dragover`).

### 2.2 Main : `main/host/tab-drag.ts` (nouveau)

```ts
export interface TabDragPayload {
  tab: { pathname: string; searchParams: Record<string, string>; title: string; history: TabHistoryEntry[]; historyIndex: number }
  dirty: boolean
  draft?: { key: string; state: unknown }   // §2.5 — JSON, ≤ 5 Mo
}
export function startTabDrag(sender: WebContents, projectId: string | null, payload: TabDragPayload): string  // id
export function markTabDragReady(sender: WebContents, id: string): void
export function tabDragInfo(id: string): { projectId: string | null; sameWindow: boolean } | null
export async function takeTabDrag(taker: WebContents, id: string): Promise<TabDragPayload | null>
export function endTabDrag(sender: WebContents, id: string): void   // dragend sans dépôt accepté
```

- Un seul glisser à la fois (le nouveau remplace l'ancien) ; expiration 60 s.
- `takeTabDrag` : refuse si le preneur est la source, si le glisser n'existe plus, ou si le preneur
  affiche un autre projet (contrôle refait côté main, D2) ; attend `ready` (≤ 2,5 s, au-delà on
  transfère quand même : les saisies non sauvegardées voyagent dans le payload, seules les
  écritures automatiques en vol sont en jeu) ; puis envoie `app:tab-moved(id)` à la source et
  supprime le glisser. Source détruite entre-temps : transfert quand même (rien à retirer).
- `endTabDrag` : si le glisser n'a pas été pris, et que `screen.getCursorScreenPoint()` n'est dans
  aucune fenêtre de l'application, et que la source a plus d'un onglet (`payload` porte
  `tabCount`) → `createAppWindow({ adopt: id, placement })` : taille de la fenêtre source,
  coin haut-gauche à `curseur − (40, 12)`, passé par `fitToDisplays`. Sinon glisser abandonné.
  Le glisser est conservé jusqu'au `take` de la nouvelle fenêtre (ou expiration : la source garde
  l'onglet, la fenêtre s'ouvre sur l'accueil).
- `createAppWindow({ adopt })` passe `__adopt=<id>` (comme `__open`).
- Channels desktop-only : `app:tab-drag-start`, `app:tab-drag-ready`, `app:tab-drag-info`,
  `app:tab-drag-take`, `app:tab-drag-end` ; événement `app:tab-moved`. Web : non exposés.

### 2.3 Renderer : `TabsContext`

Nouvelles actions :
- `moveTab(id, toIndex)` — réordonnancement dans la barre.
- `detachTab(id)` — retire l'onglet **sans** garde ni « Récemment fermés » (il continue ailleurs) ;
  dernier onglet → `api.app.closeWindow('close')` (fermeture sans garde : plus rien à garder).
- `adoptTab(tab, index?)` — insère un onglet reçu (nouvel id, historique conservé), l'active,
  navigue vers `history[historyIndex]`. Fenêtre à l'accueil (aucun projet affiché) : l'onglet
  **remplace** l'onglet d'accueil, et `lastNonNullProjectId` prend le projet reçu avant la
  navigation (sinon l'effet de changement de projet réinitialiserait les onglets).
- `snapshotTab(id)` — payload du §2.2 (`dirty` = `dirtyTabIds.has(id)`, draft de l'onglet actif
  seulement : seule la page active est montée, un onglet inactif ne peut pas être modifié).
- Boot avec `__adopt` : `main.tsx` prend le payload (`app.takeTabDrag`) **avant** de monter le
  routeur, navigue vers l'entrée courante de l'historique, et le passe à `TabsProvider` par un
  module `lib/bootTab.ts` (état initial : cet onglet avec son historique). Payload absent → boot
  habituel sans saut.

### 2.4 `TabBar`

- Onglets `draggable` ; `dragstart` : `dataTransfer.setData('application/x-polenta-tab', id)`,
  `effectAllowed = 'move'`, quitte le champ actif (`blur`), `flushPendingEdits()` puis
  `app:tab-drag-ready` ; payload envoyé à `app:tab-drag-start` (desktop).
- `dragover` sur la barre : glisser local → indicateur d'insertion entre deux onglets
  (`data-testid="tab-drop-indicator"`) ; glisser d'une autre fenêtre → idem si accepté (même projet
  ou fenêtre sans projet, réponse de `tab-drag-info`), sinon `dropEffect = 'none'`.
- `drop` : local → `moveTab` ; autre fenêtre → `takeTabDrag` puis `adoptTab(payload, index)` et
  `api.app.focusWindow()` (fenêtre cible au premier plan : elle l'est déjà sous le curseur ; appel
  pour macOS).
- `dragend` (source) : `dropEffect === 'none'` → `app:tab-drag-end`. Réception de `app:tab-moved`
  → `detachTab`.
- Web : réordonnancement seulement (`capabilities.multiWindow` faux → pas d'appels `tab-drag`).

### 2.5 Saisies transférées (D1) : `renderer/lib/tabDraft.ts` (nouveau)

```ts
/** Un éditeur déclare sa saisie transférable : `key` identifie éditeur + objet (ex. `req:<repo>::<id>`). */
export function useTabDraft<T>(key: string | null, snapshot: () => T | null, restore: (state: T) => void): void
export function captureActiveDraft(): { key: string; state: unknown } | undefined   // snapshotTab
export function stageIncomingDraft(d: { key: string; state: unknown }): void          // adoptTab / boot
```

- Un seul éditeur enregistré à la fois (la page active). `snapshot` renvoie `null` quand il n'y a
  rien à transférer.
- À l'arrivée, le draft est mis en attente ; l'éditeur dont la `key` correspond le reprend à son
  premier rendu prêt (`restore`), une seule fois ; attente jetée à la navigation suivante.
- Éditeurs :
  - **exigence / test** (`useDraftForm`) : état `{ base, draft }` ; `restore` réinjecte `base` et
    `draft` puis `adoptExternal` contre l'instantané serveur relu → bandeau « modifié ailleurs »
    si besoin (GH342). Ajout à `useDraftForm` : `exportState()` / `importState()`.
  - **Schéma** (`routes/schema.tsx`) : `{ repoPath, state, savedState }`, restauré si le repo
    édité est le même.
  - **Campagne** (`routes/campaign.$campaignId.tsx`) : `editingFields`.
  - **Diff** (`components/diff/FileDiffView.tsx`) : `draft` (`text`, `baseline`) pour
    `(repoPath, filepath)`.
- Le point « modifié » revient de lui-même : chaque éditeur recalcule son `dirty` à partir de l'état
  restauré (`useRegisterTabDirty` inchangé).

### 2.6 Fichiers sprint 2

`main/host/tab-drag.ts` (+ test de la logique pure : expiration, refus projet, source = preneur),
`main/host/app-windows.ts` (`adopt`, placement au curseur, `focusWindow`), `main/ipc/channels.ts`,
`desktop-only.handlers.ts`, `packages/api-client`, `renderer/main.tsx`, `renderer/lib/bootTab.ts`,
`renderer/lib/tabDraft.ts` (+ test), `renderer/lib/draftSync.ts`, `renderer/contexts/TabsContext.tsx`,
`renderer/components/layout/TabBar.tsx`, `routes/req.$reqId.tsx`, `routes/test.$testId.tsx`,
`routes/schema.tsx`, `routes/campaign.$campaignId.tsx`, `components/diff/FileDiffView.tsx`,
`renderer/web/bridge.ts`, i18n.

---

## Décisions techniques et alternatives rejetées

- **Payload dans le `dataTransfer`** : rejeté — illisible pendant `dragover` (refus D2 impossible
  à afficher), taille et fiabilité inconnues entre fenêtres, et rien ne garantit la suppression
  côté source seulement après réception.
- **Glisser simulé à la souris** (capture du pointeur, suivi par `getCursorScreenPoint`) : rejeté —
  ré-implémente ce que Chromium fait déjà entre fenêtres, sans curseur système.
- **Pointeur « dernier projet » par fenêtre** : rejeté par D3.
- **Restaurer tous les onglets** : hors périmètre (spec).

## Mises à jour SPEC prévues (dernier sprint)

`SPEC-PROJECT-MANAGEMENT.md` §1 (dernier projet ouvert), §5 (glisser, fenêtre vide, deux projets,
disposition avec l'accueil), §6 (fermeture conditionnelle) ; `SPEC-ELECTRON-DESKTOP.md` §16 (saut
au lancement seulement), §19.1 (glisser / réordonner) ; `SPEC-WEB.md` (`__home`, réordonner) ;
`SPEC-ACCOUNTS-AUTH.md` (compte affiché par projet, `logout(key)`).

## Risques

- **Glisser entre fenêtres Electron** : à valider dès le début du S2 par un essai manuel (Windows)
  — repli si Chromium ne livre pas le `drop` à l'autre fenêtre : la cible est déterminée par le
  main au `dragend` (fenêtre sous le curseur, index d'insertion demandé à cette fenêtre).
- **e2e** : le glisser entre fenêtres n'est pas automatisable de façon fiable (Playwright ne
  produit pas de glisser OS entre deux `BrowserWindow`) → e2e desktop sur le protocole (appels
  `tab-drag-*` pilotés par `evaluate`) + réordonnancement par glisser dans une fenêtre ; le geste
  complet est un test manuel.
