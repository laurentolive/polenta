# GH405 — Design : navigation entre onglets au clavier

Spec : `specs/GH405.md`. **Un sprint.**

## 1. État actuel (code)

- `TabsContext.tsx` : `activateTab`, `openTab`, `reopenClosedTab` naviguent sans garde. Seule la
  page de l'onglet actif est montée ; `useRegisterTabDirty` se désinscrit au démontage, donc la
  saisie d'une page modifiée (exigence, test, campagne, Schéma, `FileDiffView`) est perdue sans
  prévenir quand on change d'onglet.
- Gardes existantes : `attemptCloseTab` (Ctrl+W, croix) → `pendingCloseId` + `ConfirmCloseTabModal` ;
  `attemptHistoryNav` (GH228) → `pendingHistoryIndex` + `ConfirmLeavePageModal` (« Quitter cette
  page ? »). Les deux font d'abord `blur()` du champ éditable actif.
- `useTabShortcuts.ts` : Ctrl+T / Ctrl+W / Ctrl+Shift+N, écouteur `keydown` en phase de bouillonnement
  sur `window` (web : Alt+T / Alt+W).
- `useHistoryNavigation.ts` : `modalOpen()` local (`[role="dialog"], .fixed.inset-0` — couvre aussi
  le menu ▾ `TabListMenu` et son fond).
- `TabBar.tsx` : pas de défilement automatique vers l'onglet actif.

## 2. Décisions

### 2.1 Garde générique de départ (TabsContext)

`pendingHistoryIndex` devient une action de départ générique :

```ts
/** GH405 — action qui quitte la page de l'onglet actif, en attente de confirmation. */
export type LeaveAction =
  | { kind: 'history'; index: number }
  | { kind: 'activate'; id: string }
  | { kind: 'open'; pathname?: string; searchParams?: Record<string, string> }
  | { kind: 'reopen'; id: string }
```

- `attemptLeave(action)` (interne) : `blur()` du champ éditable actif, puis
  `dirtyTabIds.has(activeTabId)` → `setPendingLeave(action)`, sinon `runLeave(action)`.
- `runLeave` aiguille vers `goToHistoryIndex` / `activateTab` / `openTab` / `reopenClosedTab`
  (inchangés, non gardés).
- API publique ajoutée : `attemptActivateTab(id)`, `attemptOpenTab(pathname?, searchParams?)`,
  `attemptReopenClosedTab(id)` ; `attemptHistoryNav(index)` conservé (devient
  `attemptLeave({ kind: 'history', index })`, mêmes no-op qu'avant).
- `pendingHistoryIndex` / `confirmHistoryNav` / `cancelHistoryNav` remplacés par
  `pendingLeave` / `confirmLeave` / `cancelLeave` (seul consommateur : `ConfirmLeavePageModal`).
- `attemptActivateTab(activeTabId)` et un id inconnu : no-op, sans popup.
- `activateTab` / `openTab` / `reopenClosedTab` restent exposés **non gardés** pour les appels
  programmatiques (ouverture de `/merge-resolve` sous `flushSync` — GH37 —, liens Ctrl+clic,
  Vue Recherche, constellation, `useOpenRowTarget`).

**Alternative rejetée** : garder `openTab` lui-même. Les appels sous `flushSync` attendent un
changement d'onglet synchrone ; une popup intercalée casserait ce contrat. Les ouvertures
programmatiques en nouvel onglet depuis une page modifiée (Ctrl+clic sur un lien d'élément) restent
hors spec → issue séparée (§5).

**Alternative rejetée** : un second modal dédié au changement d'onglet. Même texte, mêmes boutons
que « Quitter cette page ? » : une seule popup, une seule file d'attente.

### 2.2 Points d'entrée gardés

| Fichier | Avant | Après |
|---|---|---|
| `TabBar.tsx` clic onglet | `activateTab` | `attemptActivateTab` |
| `TabBar.tsx` bouton `+` | `openTab()` | `attemptOpenTab()` |
| `TabListMenu.tsx` onglet ouvert | `activateTab` | `attemptActivateTab` |
| `TabListMenu.tsx` récemment fermé | `reopenClosedTab` | `attemptReopenClosedTab` |
| `useTabShortcuts.ts` Ctrl+T | `openTab()` | `attemptOpenTab()` |
| `useTabShortcuts.ts` Ctrl+Tab… | — | `attemptActivateTab(cible)` |

`TabListMenu` se ferme (`onClose`) avant que la popup ne s'affiche : comportement identique au clic.

### 2.3 Raccourcis (pur + hook)

Nouveau `lib/tabCycle.ts` (pur, testé en unitaire) :

```ts
/** +1 suivant, -1 précédent, null : pas un raccourci de changement d'onglet. Ctrl seul (+ Maj pour Tab). */
export function tabCycleDirection(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): 1 | -1 | null
/** Id de l'onglet voisin dans l'ordre visuel, avec bouclage ; null s'il y a moins de 2 onglets. */
export function cycleTabId(tabs: readonly { id: string }[], activeId: string, delta: 1 | -1): string | null
```

- `Ctrl+Tab` → +1, `Ctrl+Shift+Tab` → -1, `Ctrl+PageDown` → +1, `Ctrl+PageUp` → -1.
- `null` si `metaKey` ou `altKey`, ou `Ctrl+Shift+PageUp/PageDown` (réservé au déplacement
  d'onglet, hors scope).

`useTabShortcuts.ts` : second écouteur `keydown` sur `window` **en phase de capture**, desktop
seulement (`!isWeb`), enregistré une fois (état lu par ref pour suivre une répétition rapide) :

1. `dir = tabCycleDirection(e)` ; `null` → laisse passer.
2. `pendingCloseId`, `pendingLeave` ou `modalOpen()` → laisse passer (aucune action).
3. `e.preventDefault()` + `e.stopPropagation()` : la phase capture sur `window` passe avant les
   écouteurs du champ cible (ProseMirror, CodeMirror, `DataGrid`, textarea de xterm), qui ne voient
   jamais la touche.
4. `cible = cycleTabId(tabs, activeTabId, dir)` ; non nulle → `attemptActivateTab(cible)`.

`modalOpen()` est extrait de `useHistoryNavigation.ts` vers `lib/modalOpen.ts` et partagé.

**xterm** : son `attachCustomKeyEventHandler` n'est pas nécessaire — la capture sur `window`
précède l'écouteur du textarea de xterm. Vérifié par l'e2e desktop (E4).

### 2.4 Onglet actif visible

`TabBar.tsx` : `useLayoutEffect` sur `activeTabId` → `scrollIntoView({ block: 'nearest',
inline: 'nearest' })` du bouton de l'onglet actif (`data-tab-id`). Vaut pour toutes les
activations (raccourci, menu ▾, ouverture).

## 3. Fichiers

| Fichier | Modification |
|---|---|
| `renderer/lib/tabCycle.ts` (+ `.test.ts`) | nouveau, pur |
| `renderer/lib/modalOpen.ts` | nouveau, extrait de `useHistoryNavigation.ts` |
| `renderer/contexts/TabsContext.tsx` | `LeaveAction`, `pendingLeave`, `attempt*` |
| `renderer/components/layout/ConfirmLeavePageModal.tsx` | `pendingLeave` / `confirmLeave` / `cancelLeave` |
| `renderer/components/layout/TabBar.tsx` | clic / `+` gardés, `data-tab-id`, défilement |
| `renderer/components/layout/TabListMenu.tsx` | entrées gardées |
| `renderer/hooks/useTabShortcuts.ts` | Ctrl+T gardé, écouteur capture Ctrl+Tab / PageUp / PageDown |
| `renderer/hooks/useHistoryNavigation.ts` | import de `modalOpen` |
| `e2e-desktop/gh405-tabs.spec.ts` | nouveau (raccourcis) |
| `e2e-web/gh405-tab-guard.spec.ts` | nouveau (garde au clic, menu, `+`, Récemment fermés ; pas de raccourci web) |
| `specs/SPEC-ELECTRON-DESKTOP.md` §19.1, `specs/SPEC-INDEX.md` | sprint final |

Aucun changement de format de fichier, d'IPC ni du main.

## 4. Vérification

Niveau 1 : typecheck, lint, `vitest` sur `tabCycle.test.ts`. Niveau 2 : `pnpm test`,
`e2e-web/gh405-` + `e2e-web/gh228-` (garde partagée), `pnpm test:e2e:desktop -g GH405`.
Niveau 3 au merge (renderer touché).

## 5. Hors périmètre découvert

Ouverture programmatique d'un nouvel onglet depuis une page modifiée (Ctrl+clic sur un lien
d'élément, « Ouvrir dans un nouvel onglet »), bouton « Résoudre les conflits » de
`ModificationControl`, onglet adopté d'une autre fenêtre par glisser : même perte de saisie, non
couverte par la spec → #407.

## 6. Écart en cours de sprint

`modalOpen()` ne reconnaissait que `role="dialog"` et `.fixed.inset-0` : un menu contextuel sans fond
(clic droit sur un onglet, arbre, grille, terminal), les popovers de liens et le menu du compte
n'étaient pas vus (critère 8). Ajout de `role="menu"` et d'un marqueur `data-floating-menu` sur ces
menus (`NodeContextMenu`, `ColumnFreezeMenu`, `ParamPicker`, menus de `ElementTree`, `ExcelView`,
`WordView`, `TerminalPanel`, `AccountMenu`, confirmation d'abandon de `MergeResolvePage`). Vaut aussi
pour Précédent / Suivant (même fonction). La popup d'aperçu au survol (`ElementPreviewPopup`) n'est
pas marquée : passive, elle ne doit pas bloquer les raccourcis.
