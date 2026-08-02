# T131 — Design

## Analyse

`LocalNodeRow` (`StructureTab.tsx:265-377`) diffère de `RepoRow` seulement par l'absence d'état
d'ouverture. Le mécanisme à répliquer existe déjà dans le même fichier — pas de nouvelle
abstraction, pas de nouveau composant : un `useState` local, un chevron, un `onClick` sur la ligne
d'en-tête, et conditionner les trois blocs de rendu existants.

Trois de la ligne (`AddElementMenu`, pencil, `ConfirmDelete`) doivent continuer à fonctionner sans
déclencher le toggle une fois la ligne cliquable :

- **`AddElementMenu`** (composant partagé, `StructureTab.tsx:203-230`) — son conteneur a déjà
  `onClick={e => e.stopPropagation()}` (ligne 212, via le pattern partagé avec `AddMenu`). Rien à
  changer.
- **Pencil (renommer)** (lignes 311-322) — bouton inline, sans `stopPropagation` aujourd'hui
  (la ligne n'étant pas cliquable). À ajouter, même pattern que `RepoRow` ligne 465.
- **`ConfirmDelete`** (lignes 323-332) — composant partagé (`objectTypeEditor.tsx:140-170+`) dont
  le bouton interne (`onClick={() => setPending(true)}`) n'appelle pas `stopPropagation` lui-même
  (il n'a jamais eu besoin de le faire dans ses autres usages, `ElementLeaf` compris — aucun de ces
  appelants n'a de ligne parente cliquable). Plutôt que modifier `ConfirmDelete` lui-même (qui a
  d'autres appelants non concernés par ce ticket), on l'enveloppe localement dans `LocalNodeRow`
  d'un conteneur `onClick={e => e.stopPropagation()}`, même idée que le wrapper de `AddMenu`/
  `AddElementMenu`.

## Changements

Uniquement `apps/desktop/src/renderer/components/schema/StructureTab.tsx`, fonction `LocalNodeRow` :

1. `const [open, setOpen] = useState(true)` en tête de fonction (à la place de rien).
2. Ligne d'en-tête (`div` ligne 291) : ajoute `onClick={() => setOpen(v => !v)}` et
   `cursor-pointer select-none` (cohérent avec les classes de `RepoRow` ligne 407), et insère
   `{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}` juste avant l'icône
   `Component` (même wrapper `<span className="text-ink-3">` que `RepoRow` ligne 411).
3. Bouton pencil (ligne 313) : `onClick={e => { e.stopPropagation(); handlers.onEditNode({...}) }}`.
4. `ConfirmDelete` (ligne 323) : enveloppé dans `<span onClick={e => e.stopPropagation()}>`.
5. Les trois blocs de contenu existants (`objectTypes.map`, `children.map`, `ownDependencies.map`,
   lignes 335-374) passent sous `{open && (<>...</>)}`.
6. Import `ChevronDown, ChevronRight` déjà présents dans les imports `lucide-react` du fichier
   (ligne 5, utilisés par `RepoRow`) — aucun nouvel import nécessaire.

Pas de changement de props/interface : `LocalNodeRow` garde exactement la même signature.
Pas de changement à `RepoRow`, `ElementLeaf`, `AddElementMenu`, `ConfirmDelete`, ni à aucun fichier
hors `StructureTab.tsx`.

## Sprints

Un seul sprint — changement localisé à une fonction d'un seul fichier, sans nouvelle interface ni
impact sur d'autres écrans.

## Alternatives rejetées

- **Lever `open` dans un état partagé/context** (pour permettre plus tard une persistance ou un
  "tout replier" global) — prématuré : hors scope de ce ticket (cf. T131.md §Hors scope), et
  `RepoRow`/`ElementTree` n'ont pas ce besoin non plus aujourd'hui. Ajouté seulement si demandé.
- **Modifier `ConfirmDelete` pour qu'il stoppe lui-même la propagation** — toucherait tous ses
  appelants (`ElementLeaf`, `RepoRow` n'en a pas mais d'autres écrans en ont potentiellement)
  sans bénéfice pour eux ; le wrapper local dans `LocalNodeRow` suffit et limite le blast radius.
