# GH228 — Design : navigation Précédent / Suivant

Spec : `specs/GH228.md`. Un seul sprint.

## 1. Historique par onglet (`TabsContext`)

### Modèle

`Tab` gagne `history: TabHistoryEntry[]` et `historyIndex: number`
(`TabHistoryEntry = { pathname, searchParams, title }`). L'entrée `history[historyIndex]` est
la page affichée ; `tab.pathname/searchParams/title` restent la copie « courante » existante
(utilisée par l'activation d'onglet, le menu, « Récemment fermés »).

Logique pure dans `renderer/lib/tabHistory.ts` (testée unitairement) :
- `recordLocation(state, entry, push)` : `push` → tronque après l'index, ajoute l'entrée (sauf si
  elle a la même destination que l'entrée courante → remplacement), plafonne à 50 ;
  sinon remplace l'entrée courante.
- `stepHistory(state, delta)` → nouvel index ou `null` hors bornes.
- `historyEntriesBefore/After(state, max)` pour le menu (15 au plus, plus proche d'abord).
- `historyNavDirection(event, platform, inEditable)` : décodage clavier/souris (§3).

### Distinguer ajout / remplacement

`useRouter().history.subscribe(({ location, action }))` (TanStack history 1.162) :
- `action.type === 'PUSH'` sans marqueur → `pendingPushRef = true` ;
- les navigations internes à `TabsProvider` (activation d'onglet, Précédent/Suivant, menu,
  fermeture, réouverture) passent `state: { polentaTabNav: true }` à `navigate()` et sont
  ignorées ici ;
- tout le reste (`REPLACE`, `BACK`/`FORWARD`/`GO` natifs du navigateur en client web) →
  remplacement.

L'effet existant `[pathname, search]` consomme `pendingPushRef` : un PUSH puis une redirection
REPLACE avant le rendu donnent une seule entrée, à l'URL finale (comme un navigateur).

Alternative rejetée : traiter chaque événement dans le subscriber avec `location` brute — elle
n'est pas encore normalisée par le routeur (`validateSearch`) et les redirections immédiates
créeraient des entrées intermédiaires.

### Navigation

`goHistory(delta)` / `goHistoryTo(index)` : pose `historyIndex`, puis
`navigate({ to, search, replace: true, state: { polentaTabNav: true } })`. L'effet de
synchronisation remplace alors l'entrée à ce nouvel index par l'URL normalisée.

`attemptHistoryNav(index)` = point d'entrée de l'UI : `blur()` du champ actif (comme
`attemptCloseTab`), puis si l'onglet est dirty → `pendingHistoryIndex` (popup), sinon navigation.
`confirmHistoryNav` / `cancelHistoryNav`. Popup `ConfirmLeavePageModal` (même coque que
`ConfirmCloseTabModal`) : « Rester » (Échap) / « Quitter sans enregistrer » (Entrée).

Titre : `setTabTitleOverride` et l'effet de sync mettent aussi à jour `history[historyIndex].title`.
`reopenClosedTab` restaure `history`/`historyIndex` de l'onglet fermé.
`sessionCache` contient déjà `tabs` → l'historique survit au remontage du provider.

## 2. Vue système pilotée par l'URL (`SystemViewContext`)

Nouveaux paramètres de `/product` et `/components` (ajoutés aux `validateSearch`) :
`view` (`excel` | `word` | `edit`) et `item` (objectId).

Dans le contexte :
- `storedViewMode` = `localStorage polenta:viewMode:<repo>` (déplacé depuis `SystemView`) ; écrit
  quand l'URL porte `view=excel|word`.
- `editingNodeId` devient **dérivé** : `view=edit` → nœud de l'arbre dont `objectId === item`,
  sinon `localEditingNodeId` (nœud sans objectId, cas d'un élément en cours de création).
- `viewMode` (effectif) exposé : `edit` si un nœud est en édition ou si l'item est encore en
  résolution (arbre du type pas encore chargé) ; `item` introuvable une fois l'arbre chargé →
  `storedViewMode` ; sinon `view ?? storedViewMode`.
- `showView(mode, item?)` (push) — bascule Tableau/Document, sortie d'Édition (« Retour » T92 :
  revient au mode précédent en ciblant l'élément quitté).
- `setEditingNodeId(nodeId)` (push `view=edit&item=<objectId>`) — double-clic arbre/vues ;
  nœud sans objectId → `localEditingNodeId` + push `view=edit` ; un effet complète `item` en
  REPLACE dès que l'objectId est attribué.
- `showObject(repoPath, nodeId, typeId, view, item)` (push) — navigation par lien (T37/GH105),
  remplace `navigateTo` / `navigateToRepo`.
- `requestGoto(nodeId)` : cible locale (comme aujourd'hui) **et** `item=<objectId>` en REPLACE
  si différent de l'URL (un clic dans l'arbre n'empile pas de pages). `clearGoto({ dropItem })` : `dropItem` (clic dans le vide de l'arbre)
  retire `item` en REPLACE.
- Effet URL → goto : à chaque `(rootKey, item)` nouveau hors Édition, l'item résolu devient la
  cible goto (retour arrière sur une page « ciblée » → contour et défilement).
- `navigateWith` (sélecteur Composant / Élément = PUSH ; résolutions automatiques = REPLACE)
  conserve `view`/`item` en REPLACE, les abandonne en PUSH (changement de type = nouvelle page).

Dans `SystemView` : suppression de `viewMode` local, `prevViewModeRef`, `backHistory`,
`pendingNavObjectId`, `beginLinkNavigation`, `linkNavTargetRef`, `BackEntry`, du bouton
« ← Retour » hors Édition. `navigateToObject` → `showObject`. `handleEditBack` (« Retour » T92) → Précédent si l'entrée
précédente de l'onglet est la même route, sinon `showView(storedViewMode, item)`. `SystemView`
pose le titre d'onglet (`useSetTabTitle` : « ID — titre » en Édition, sinon composant / type) pour
que le menu d'historique distingue les pages ; `useSetTabTitle` se ré-applique quand une
navigation remet le titre par défaut, et l'effet de synchronisation de `TabsProvider` est un
`useLayoutEffect` (il précède les effets des vues : le titre affiné va sur la nouvelle entrée).

**Saisie non enregistrée de la vue système** : `EditView` vide son miroir au démontage et au
changement d'objet (T159), les cellules Excel enregistrent au `blur` ; rien n'est perdu en
quittant la page → pas d'enregistrement dirty supplémentaire. Les routes déjà dirty
(`schema`, `req`, `test`, `campaign`, diff édité) déclenchent la popup.

## 3. Déclencheurs

`renderer/hooks/useHistoryNavigation.ts`, monté par `TabBar` :
- `keydown` (capture) → `historyNavDirection` :
  - Windows/Linux : `Alt+←/→` (sans Ctrl/Meta/Shift), y compris dans un champ ;
  - macOS : `Cmd+[`/`Cmd+]` (code `BracketLeft/Right`) partout ; `Cmd+←/→` et `Alt+←/→` hors champ ;
  - `BrowserBack` / `BrowserForward` partout ;
  - ignorés si `defaultPrevented` ou une modale ouverte (`[role="dialog"], .fixed.inset-0`).
  `preventDefault` (client web : retour natif).
- `mouseup` boutons 3/4 → `preventDefault` + navigation ; `mousedown` 3/4 → `preventDefault`.
- IPC `nav:history` (`'back' | 'forward'`) émis par le main : `app-command`
  `browser-backward/forward` (Windows), `swipe` `left/right` (macOS). Sous Windows, les boutons
  latéraux produisent **à la fois** l'événement DOM et l'`app-command` : déduplication — un
  déclenchement dans la même direction moins de 300 ms après un autre est ignoré.

## 4. UI

`components/layout/HistoryNavButtons.tsx`, à gauche du bouton ▾ de `TabBar` : `<` `>` (lucide
`ChevronLeft/Right`), grisés (`disabled`) sans entrée, infobulle avec le raccourci de la plateforme.
Clic droit ou appui long (500 ms) → `HistoryMenu` (liste des entrées, clic = saut via
`attemptHistoryNav`), fermeture clic extérieur / Échap.

i18n : `layout.history.{back,forward,menuEmpty}`, `layout.confirmLeavePage.{title,message,stay,leave}`.

## 5. Fichiers

| Fichier | Modification |
|---|---|
| `renderer/lib/tabHistory.ts` (+ `.test.ts`) | nouveau — logique pure |
| `renderer/contexts/TabsContext.tsx` | historique par onglet, navigation, garde dirty |
| `renderer/hooks/useHistoryNavigation.ts` | nouveau — déclencheurs |
| `renderer/components/layout/HistoryNavButtons.tsx` | nouveau — boutons + menu |
| `renderer/components/layout/ConfirmLeavePageModal.tsx` | nouveau — popup |
| `renderer/components/layout/TabBar.tsx` | intégration |
| `renderer/contexts/SystemViewContext.tsx` | `view`/`item`, `viewMode`, `showView`, `showObject`, goto |
| `renderer/components/system/SystemView.tsx` | état de vue retiré, « ← Retour » retiré |
| `renderer/components/sidebar/SystemPanel.tsx` | `clearGoto({ dropItem: true })` |
| `renderer/routes/product.tsx`, `components.tsx` | `validateSearch` |
| `main/index.ts` | `app-command`, `swipe` → `nav:history` |
| `renderer/i18n/*` | libellés |
| `e2e-web/gh228-navigation.spec.ts` | nouveau ; `gh105` (← Retour → Précédent) |

## 6. Écart par rapport à la spec

La Vue Recherche (`/search`) garde son goto en état local (`SearchContext`) : le goto d'un
résultat ne crée pas d'entrée. Mettre la recherche entière dans l'URL dépasse le ticket ; noté
en hors scope de `specs/GH228.md`.
