# GH365 — Design

Un sprint. Tout est côté renderer (aucun changement de service, d'IPC ni de format de fichier).

## Fichiers

### `renderer/components/schema/objectTypeEditor.tsx`
- `slugifyComponentName` : décomposition NFD + suppression des diacritiques, ligatures
  (`Œ`→`OE`, `Æ`→`AE`, `ß`→`SS`) avant la mise en majuscules et le remplacement de tout
  caractère hors `A-Z0-9` par `_`.
- `typeNamingRoot(label, name)` (nouveau, exporté) : `label` si sa racine slugifiée est non vide,
  sinon `name`. Seul point où la règle « label d'abord, repli sur le nom » est écrite.
- `COMPONENT_DEFAULT_CATEGORIES` (nouveau, exporté) : ordre des cases et des types créés —
  `requirement, test, campaign, issue, version, validation` ; `REPO_ROOT_ONLY_CATEGORIES` :
  `version, validation`.
- `defaultObjectTypes(categories, root, labelOf, descriptionLabel, taken)` (nouveau, exporté) :
  un `EditableObjectType` par catégorie via `emptyObjType`, en ajoutant chaque nom/préfixe produit
  à l'ensemble `taken` pour la suivante (pas de collision entre types d'un même ajout, ni avec le
  workspace — GH97 étendu à l'ajout de composant).

### `renderer/components/schema/AddDependencyModal.tsx`
- `AddDependencyValues` : `includeRequirements/Tests/Campaigns` remplacés par
  `defaultCategories: ObjectCategory[]` (catégories cochées, déjà filtrées : sans version /
  validation si « Composant local » est coché).
- État : ensemble des catégories cochées, initialisé à toutes. Cases rendues pour
  `COMPONENT_DEFAULT_CATEGORIES`, celles de `REPO_ROOT_ONLY_CATEGORIES` masquées quand `isLocal`
  (leur état est conservé pour un décochage ultérieur).

### `renderer/components/schema/StructureTab.tsx`
- `defaultCategoriesFrom` supprimé (remplacé par `values.defaultCategories`).
- `handleAddLocalComponent` : `defaultObjectTypes(values.defaultCategories,
  typeNamingRoot(values.label, name), …, allPrefixes)`.
- `handleSubmitDependency` (repo séparé) : racine = `typeNamingRoot(label effectif, values.name)`,
  label effectif = label saisi, sinon label du nœud de l'arbre, sinon nom (même logique que GH355) ;
  `taken` = préfixes du workspace + préfixes du schéma de la dépendance.
- `handleAddElement` : racine = `typeNamingRoot(label du nœud, nom)` — pour `root`, label du nœud
  `root` du schéma du repo, repli sur le nom de montage.
- Mode édition : `defaultCategories: []`.

### i18n (`fr.json`, `en.json`)
Clés `includeIssuesLabel`, `includeVersionsLabel`, `includeValidationsLabel`.

## Décisions
- Les cases restent au pluriel (« Issues », « Versions »…) avec des clés dédiées plutôt que
  `CATEGORY_LABEL_KEY` (singulier).
- Pas de garde côté service : `assertVersionTypes` / `assertValidationTypes` refusent déjà un type
  version/validation hors `root` ; la modale ne les propose simplement pas.

## Alternatives rejetées
- Six booléens `include*` : un champ par catégorie à recâbler à chaque nouvelle catégorie.
