# GH123 — Design : panneau latéral masquable

Spec : `specs/GH123.md`. **Un seul sprint** (périmètre renderer, ~4 fichiers + tests).

## Fichiers

| Fichier | Modification |
|---------|--------------|
| `apps/desktop/src/renderer/components/layout/sidebarCollapse.ts` *(nouveau)* | Logique pure : lecture/écriture de la préférence, détection du raccourci |
| `apps/desktop/src/renderer/components/layout/sidebarCollapse.test.ts` *(nouveau)* | Tests unitaires vitest de ce module |
| `apps/desktop/src/renderer/components/layout/AppLayout.tsx` | État `sidebarCollapsed`, bascule dans `handleSelectPanel`, écoute `Ctrl+B`, rendu |
| `apps/desktop/src/renderer/components/layout/Sidebar.tsx` | Prop `collapsed` → masquage CSS (pas de démontage) |
| `apps/desktop/src/renderer/components/layout/ActivityBar.tsx` | Prop `sidebarCollapsed` → `aria-expanded` sur le bouton actif |
| `apps/desktop/e2e-web/support/session.ts` | `openView` idempotent vis-à-vis du repli (voir § e2e) |
| `apps/desktop/e2e-web/gh123-sidebar-collapse.spec.ts` *(nouveau)* | Scénarios de `GH123-tests.md` |
| `specs/SPEC-ELECTRON-DESKTOP.md` §19.2, `specs/SPEC-INDEX.md` | Mise à jour en fin de sprint |

## Module `sidebarCollapse.ts`

Même découpage que `activityBarLayout.ts` (GH56) : logique pure testable hors React.

```ts
export const SIDEBAR_COLLAPSED_KEY = 'polenta.sidebarCollapsed'

/** true si la préférence vaut "1" ; absente, illisible ou localStorage indisponible → false. */
export function loadSidebarCollapsed(): boolean
export function saveSidebarCollapsed(collapsed: boolean): void   // "1" ou removeItem ; try/catch

/** Ctrl+B / Cmd+B sans Shift ni Alt, hors champ éditable, non déjà traité (defaultPrevented). */
export function isSidebarToggleShortcut(e: Pick<KeyboardEvent,
  'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'defaultPrevented' | 'target'>): boolean

/** input / textarea / select / isContentEditable (ou descendant d'un contenteditable). */
export function isEditableTarget(target: EventTarget | null): boolean
```

- `key` comparé en minuscules (`'b'`), pour couvrir Caps Lock.
- `isEditableTarget` par duck-typing (`tagName`, `isContentEditable`, `closest?.('[contenteditable]')`),
  testable en environnement node avec des objets factices.
- `saveSidebarCollapsed(false)` supprime la clé plutôt que d'écrire `"0"` : l'absence = défaut.

## `AppLayout.tsx`

```ts
const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(loadSidebarCollapsed)
useEffect(() => saveSidebarCollapsed(sidebarCollapsed), [sidebarCollapsed])
```

**`handleSelectPanel(p)`** — en tête de fonction, avant la logique existante :

```ts
if (p === activePanel) {
  setSidebarCollapsed(c => {
    // Compte actif replié : la surcharge tombe, le prochain dépli montre le panneau de la route.
    if (!c && sidebarOverride) setSidebarOverride(null)
    return !c
  })
  return
}
setSidebarCollapsed(false)
// … logique existante inchangée (SIDEBAR_ONLY_PANELS, switch de navigation)
```

(Implémentation : sortir le `setSidebarOverride` de l'updater — calculer `next = !sidebarCollapsed`
puis appeler les deux setters ; l'updater ci-dessus n'est qu'indicatif.)

Conséquences :
- Le re-navigate du panneau actif disparaît (spec). Le cas `SIDEBAR_ONLY_PANELS` « recliquer Compte
  = retirer la surcharge » est absorbé par la branche `p === activePanel`.
- Le bouton grisé n'appelle jamais `onSelect` (inchangé) → aucun effet.

**Raccourci** — `useEffect` monté une fois, écouteur `keydown` sur `window` (phase bulle, pour que
l'éditeur richtext ait déjà traité et/ou que `isEditableTarget` l'écarte) :

```ts
if (!isSidebarToggleShortcut(e)) return
e.preventDefault()          // Firefox (client web) : Ctrl+B ouvre la barre des marque-pages
setSidebarCollapsed(c => !c)
```

Pas d'interaction avec `sidebarOverride` au clavier : replier Compte au clavier puis redéplier
remontre Compte. (La spec n'impose la chute de la surcharge que pour le clic.)

`menu.ts` n'a aucun accélérateur sur `CmdOrCtrl+B` → pas de conflit côté Electron.

**Rendu** :

```tsx
<ActivityBar … sidebarCollapsed={sidebarCollapsed} />
<Sidebar … collapsed={sidebarCollapsed} />
{!sidebarCollapsed && <div /* poignée de redimensionnement */ />}
```

## `Sidebar.tsx` — masquer, ne pas démonter

Prop `collapsed?: boolean` → classe `hidden` (display: none) sur le conteneur racine, plus
`data-testid="sidebar"` pour les e2e.

**Pourquoi pas un démontage** (`{!collapsed && <Sidebar/>}`, plus simple) : plusieurs panneaux
gardent un état local non remonté dans un contexte — message de commit en cours de frappe
(`VersionRepoFolder`, `useState`), dossiers dépliés, défilement des arbres. Les perdre à chaque
repli serait une régression invisible. Le coût est nul : aujourd'hui le panneau est de toute façon
monté en permanence.

## `ActivityBar.tsx`

Nouvelle prop `sidebarCollapsed: boolean`. Sur le bouton du panneau actif uniquement :
`aria-expanded={!sidebarCollapsed}` (attribut absent sur les autres). Pas de changement visuel :
le surlignage du panneau actif est conservé, replié ou non (comme VS Code).

## e2e — impact sur l'existant

`session.openView(title)` est appelé ~35 fois dans 19 specs. Si un test l'appelle pour une vue déjà
active, le clic replierait désormais le panneau. `openView` devient :

1. Escape (inchangé) ;
2. si le bouton porte déjà `aria-expanded="true"` → ne rien faire (vue active, panneau déplié) ;
3. sinon clic ; si après clic le bouton porte `aria-expanded="false"` → second clic (dépli).

Risque résiduel : un test qui comptait sur « recliquer = revenir à la route par défaut » (ex.
réinitialiser nœud/type dans Exigences). À repérer en lançant toute la suite e2e ; correction au cas
par cas dans le test (navigation explicite via `projectUrl`), pas de retour de l'ancien comportement.

## Alternatives écartées

- **Icône dédiée** en haut de l'ActivityBar : écartée par l'utilisateur au profit du style VS Code.
- **Largeur 0** au lieu de `display:none` : la bordure et le contenu débordant resteraient visibles,
  et la largeur mémorisée serait écrasée.
- **Contexte React** `SidebarContext` : seul `AppLayout` lit/écrit l'état ; des props suffisent.
- **Accélérateur de menu Electron** : n'existerait pas dans le client web ; hors scope (spec).
