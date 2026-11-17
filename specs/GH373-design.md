# GH373 — Design

Spec : `specs/GH373.md`. Un seul sprint (renderer uniquement, aucun changement main / IPC / types).

## Fichiers modifiés

| Fichier | Changement |
|---------|------------|
| `apps/desktop/src/renderer/components/schema/defaultLinkTypes.ts` (nouveau) | Logique pure : liens proposés selon les cases, noms, refs, types de liens à écrire |
| `apps/desktop/src/renderer/components/schema/objectTypeEditor.tsx` | Export de `slugifyComponentName` (racine commune aux types d'objets et de liens) |
| `apps/desktop/src/renderer/components/schema/AddDependencyModal.tsx` | Section « Types de liens créés par défaut », prop `parentHasRequirementTypes`, valeur `defaultLinks` |
| `apps/desktop/src/renderer/components/schema/StructureTab.tsx` | Calcul de la prop ; écriture des types de liens dans `handleAddLocalComponent` et la branche repo séparé de `handleSubmitDependency` |
| `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` | Titre de section, libellés des cases, infobulle, libellés des types de liens |

## `defaultLinkTypes.ts`

```ts
export type DefaultLinkKind = 'verification' | 'implementation' | 'implementation-parent'
/** Ordre d'affichage et de création. */
export const DEFAULT_LINK_KINDS: readonly DefaultLinkKind[]

/** Liens proposés : extrémités cochées (verification : test + requirement ; implementation :
 *  requirement ; implementation-parent : requirement + parentHasRequirementTypes). */
export function offeredDefaultLinks(categories: readonly ObjectCategory[], parentHasRequirementTypes: boolean): DefaultLinkKind[]

/** `issue-impact` affiché (case grisée) : issue + requirement cochés. */
export function showsIssueImpact(categories: readonly ObjectCategory[]): boolean

/** Racine des noms de types de liens : slugifyComponentName(root) en minuscules, `_` → `-`. */
export function linkTypeNamingRoot(root: string): string

export interface DefaultLinkTypesInput {
  kinds: readonly DefaultLinkKind[]
  root: string                       // racine GH365 (typeNamingRoot)
  node: string                       // nœud des refs du composant : nom local, ou 'root' (repo séparé)
  objectTypes: readonly ObjectTypeDefinition[] // types créés pour le composant
  parentRefs: readonly string[]      // `<nœud parent>::<type>` des types exigence du parent
  labels: (kind: DefaultLinkKind) => { labelSourceToTarget: string; labelTargetToSource: string }
  taken: Iterable<string>            // noms de types de liens du workspace
}
/** `own` : à écrire dans le schéma du composant ; `parent` : dans le schéma du parent
 *  (pour un composant local, les deux vont dans le même schéma). Un lien dont une extrémité
 *  n'existe pas (type non créé, parent sans exigence) est omis. Noms : `<racine>-<kind>`,
 *  premier suffixe libre `-2`, `-3`… ; chaque nom produit est ajouté aux noms pris. */
export function defaultLinkTypes(input: DefaultLinkTypesInput): { own: LinkTypeDefinition[]; parent: LinkTypeDefinition[] }
```

Refs : `verification` `[node::TEST]` → `[node::REQ]`, `defaultVisible: true` ; `implementation`
`[node::REQ]` → `[node::REQ]` ; `implementation-parent` `parentRefs` → `[node::REQ]`. Le type REQ /
TEST est le premier type de la catégorie dans `objectTypes` (un seul par catégorie à l'amorçage).
Forme identique à `editableToSchema` de l'onglet Liens (`defaultVisible` écrit seulement s'il est vrai).

## Fenêtre

- État `checkedLinks: Set<DefaultLinkKind>` initialisé à tous les liens ; affichées : `offeredDefaultLinks(
  catégories cochées et proposées, parentHasRequirementTypes)`. Une case masquée garde son état.
- Case `issue-impact` : `checked disabled`, `title` = infobulle, si `showsIssueImpact`.
- Section rendue seulement si `canBeLocal` et au moins une case affichée.
- `onSubmit` : `defaultLinks = offered ∩ checked` (vide hors ajout de composant).

## `StructureTab`

- **Parent** : `pendingDependency.repoPath`, nœud `pendingDependency.parentName ?? 'root'`.
  `parentRequirementRefs(schema, nodeName)` = types `requirement` de ce nœud → `<nœud>::<type>`.
  Prop `parentHasRequirementTypes` = liste non vide.
- **Noms pris** : `linkTypes` de tous les schémas de `schemasByRepoPath`.
- **Composant local** : après `defaultObjectTypes`, `defaultLinkTypes({ node: name, … })` ;
  `own` et `parent` ajoutés à `schema.linkTypes`, un seul `saveSchema`.
- **Repo séparé** (seulement si le `root` a été amorcé) : `own` ajouté à `nextSchema.linkTypes`
  avant le `saveSchema(newRepoPath)` existant ; puis, si `parent` non vide, `api.schema.get(
  parentRepoPath)` relu (frais), `linkTypes` complété, `saveSchema(parentRepoPath)`. Même bloc
  best-effort (erreur journalisée) que l'amorçage existant.

## Décisions et alternatives rejetées

- **Côté renderer, pas de nouvel IPC** : les types d'objets par défaut y sont déjà construits ; le
  même `schema:save` que l'onglet Liens garantit l'équivalence avec une création à la main (critère 9).
- **Un type par composant** (spec) plutôt que réutilisation par nom : évite le masquage de
  `unionLinkTypes`.
- **Pas de case pour `issue-impact` dans `defaultLinks`** : le main l'ajoute déjà.
