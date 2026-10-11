# GH56 — Design technique

Spec : `specs/GH56.md`. **Un seul sprint.**

## Fichiers

| Fichier | Action | Pourquoi |
|---|---|---|
| `apps/desktop/src/renderer/components/layout/activityBarLayout.ts` | **nouveau** | Logique pure : lecture/écriture de la préférence, application de l'ordre, déplacement, bascule de visibilité. Testable sans DOM. |
| `apps/desktop/src/renderer/components/layout/activityBarLayout.test.ts` | **nouveau** | Tests unitaires vitest de la logique pure. |
| `apps/desktop/vitest.config.ts` | modifié | Ajoute `src/renderer/**/*.test.ts` à `include` (env `node` suffit : pas de DOM). |
| `apps/desktop/src/renderer/components/layout/ActivityBar.tsx` | modifié | Drag & drop natif HTML5, menu contextuel, rendu filtré/ordonné. |
| `apps/desktop/src/renderer/components/layout/ActivityBarMenu.tsx` | **nouveau** | Menu contextuel (positionné en `fixed`, fermeture clic extérieur / Échap). |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | modifié | Clés `layout.activityBar.menu.{hide,reset}`. |
| `apps/desktop/e2e-web/gh56-activity-bar.spec.ts` | **nouveau** | Scénarios e2e (cf. `GH56-tests.md`). |
| `specs/SPEC-ELECTRON-DESKTOP.md` §19.1/§19.2 | modifié (fin de sprint) | Documenter la personnalisation. |

`AppLayout.tsx` n'est pas modifié : la préférence est une affaire interne à l'`ActivityBar`
(aucun autre composant ne la lit), l'interface `Props` reste identique.

## Modèle de la préférence

```ts
// activityBarLayout.ts
export const ACTIVITY_BAR_LAYOUT_KEY = 'polenta.activityBarLayout'

export interface ActivityBarLayout {
  order: Panel[]     // ordre enregistré (peut être partiel / contenir des ids inconnus)
  hidden: Panel[]    // panneaux masqués
}

export const UNHIDEABLE_PANELS: readonly Panel[] = ['account', 'project']

/** Lit la préférence ; JSON invalide, forme inattendue ou localStorage indisponible → null. */
export function loadLayout(): ActivityBarLayout | null
/** Écrit la préférence (try/catch — best effort, comme scrollSync.ts). */
export function saveLayout(layout: ActivityBarLayout): void
/** Supprime la clé (Réinitialiser). */
export function clearLayout(): void

/** Ordonne `defaults` selon `layout.order` : ids inconnus ignorés, ids absents ajoutés en fin
 *  dans l'ordre par défaut. layout null → defaults. Réutilise `orderItems` (ReorderableSidebarSection). */
export function applyOrder(defaults: Panel[], layout: ActivityBarLayout | null): Panel[]

/** Panneaux masqués effectifs : `layout.hidden` ∩ defaults, privé de UNHIDEABLE_PANELS. */
export function hiddenSet(defaults: Panel[], layout: ActivityBarLayout | null): Set<Panel>

/** Déplace `id` avant/après `targetId` dans `order` (ordre complet). id === targetId → inchangé. */
export function movePanel(order: Panel[], id: Panel, targetId: Panel, position: 'before' | 'after'): Panel[]

/** Bascule la visibilité ; no-op pour un panneau de UNHIDEABLE_PANELS. */
export function toggleHidden(hidden: Panel[], id: Panel): Panel[]
```

Clé : `polenta.activityBarLayout` (préfixe `polenta.` comme `polenta.sidebarWidth`).
Valeur : `{"order":[...],"hidden":[...]}`. L'ordre enregistré est **complet** (tous les
panneaux, masqués compris) : un bouton réaffiché retrouve sa position.

Validation à la lecture : objet avec `order` et `hidden` tableaux de chaînes ; sinon `null`.
Les valeurs hors de `Panel` sont filtrées par `applyOrder`/`hiddenSet`, pas rejetées.

## ActivityBar.tsx

- État : `const [layout, setLayout] = useState(loadLayout)` ; un `update(next)` fait
  `setLayout(next)` + `saveLayout(next)`. Réinitialiser → `setLayout(null)` + `clearLayout()`.
- `ordered = applyOrder(PANELS ids, layout)` ; rendu = `ordered` filtré par `hiddenSet`.
- **Boutons grisés** : `disabled` natif remplacé par `aria-disabled` + garde dans `onClick`
  (Chromium ne délivre ni `dragstart` ni `contextmenu` à un `<button disabled>` — or la spec
  exige qu'un bouton grisé reste déplaçable). Les classes `w-12 h-12` et l'attribut `title`
  sont conservés : le helper e2e `activityBar(page)` s'appuie dessus.
- **Drag & drop** : même mécanique que `ReorderableSidebarSection` (HTML5 natif,
  `draggingId`, `dropTarget {id, position}` calculé sur la moitié verticale, trait
  `h-0.5 bg-status-info-solid` avant/après, `opacity-40` sur l'élément saisi). Le calcul se fait
  sur la liste **visible** ; `movePanel` est appliqué à l'ordre **complet**, les masqués
  gardent donc leur place relative. `dragover` sur le conteneur (zone vide sous les boutons)
  n'est pas une cible : dépôt hors bouton = no-op.
- Pas de dataTransfer exploitable hors de la barre : `setData('text/plain', id)` est
  conservé pour que Chromium démarre le drag, mais aucune autre zone de l'app n'accepte de
  dépôt `text/plain` d'un id de panneau (vérifié : les zones de dépôt existantes filtrent sur
  leur propre état de drag).
- **Clic droit** : `onContextMenu` sur le conteneur racine (`e.preventDefault()`), cible
  déduite de `(e.target as HTMLElement).closest('[data-panel]')` → `menu = {x, y, panel | null}`.
  `UpdateBadge` est exclu sans toucher `UpdateBadge.tsx` : il est rendu dans un wrapper
  `<div ref={badgeRef}>` ; si `badgeRef.current.contains(e.target)`, aucun menu.

## ActivityBarMenu.tsx

Calqué sur `BgContextMenu` d'`ElementTree.tsx` (même style `fixed z-50 bg-surface border
border-edge rounded-lg shadow-xl py-1 text-xs`, fermeture sur `mousedown` extérieur), plus :
fermeture sur `Escape` (`keydown` sur window). Props :

```ts
{ x, y, target: Panel | null, panels: {id, label}[] /* ordre courant */, hidden: Set<Panel>,
  onToggle(id), onReset(), onClose() }
```

Entrées : « Masquer « label » » si `target` masquable → séparateur → une ligne par panneau
(icône `Check` 12 px si visible, espace réservé sinon ; `aria-disabled` + `text-ink-3` pour
Compte/Projet) → séparateur → « Réinitialiser la disposition ». `role="menu"` /
`role="menuitemcheckbox"` + `aria-checked` (utile aussi aux sélecteurs e2e).
La barre étant à gauche, `x` est le point de clic ; `y` est borné pour que le menu ne
déborde pas en bas (`Math.min(y, innerHeight - hauteurEstimée)`).

## i18n

```json
"activityBar": { ..., "menu": { "hide": "Masquer « {{label}} »", "reset": "Réinitialiser la disposition" } }
"activityBar": { ..., "menu": { "hide": "Hide \"{{label}}\"", "reset": "Reset layout" } }
```

## Décisions et alternatives rejetées

- **HTML5 natif plutôt qu'une lib (dnd-kit)** : aucune lib DnD dans le projet, quatre
  composants utilisent déjà le natif ; dix éléments en liste verticale ne justifient pas une
  dépendance.
- **État local à `ActivityBar` plutôt qu'un contexte** : seul consommateur. Conséquence
  acceptée : deux fenêtres Electron ouvertes ne se synchronisent pas en direct ; la
  modification est vue par l'autre fenêtre au prochain rechargement. (Un listener `storage`
  serait trivial à ajouter si le besoin se manifeste — hors scope.)
- **Pas de factorisation du menu contextuel avec `ElementTree`** : les deux menus
  d'ElementTree sont privés et sans coches ; extraire un composant générique dépasse le ticket.
- **Préférence par poste (localStorage)** : décision de spec.

## Impact SPEC

`SPEC-ELECTRON-DESKTOP.md` §19.1 (ligne « Activity bar ») et §19.2 (règles) : ajout de la
personnalisation (ordre, masquage, persistance, Compte/Projet non masquables, badge fixe).
