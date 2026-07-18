## Vue d'ensemble technique

Périmètre découpé en 3 sprints indépendamment livrables et testables. Chaque sprint touche un sous-ensemble disjoint de fichiers, dans l'ordre où la donnée est produite (le catalogue avant ses consommateurs).

- **Sprint 1** — catalogue de rôles + rôles joués par le parent, dans la popup d'édition de **n'importe quel** nœud dépendance (édition uniquement — pas au moment de l'ajout).
- **Sprint 2** — section « Interfaces implémentées » dans la popup d'édition de **n'importe quel** nœud dépendance (édition uniquement).
- **Sprint 3** — champ `roles` d'exigence sourcé depuis le catalogue (`EditView`), suppression de l'onglet Interfaces, mise à jour des SPEC.

**Note de conception (correction apportée pendant l'écriture des tests) :** gater ces deux sections sur `kind === 'interface'` / `kind === 'component'` créerait un problème d'œuf et de poule — `kind` est dérivé de `node.isInterface`, lui-même dérivé de `schema.roles` non vide ; un repo qui n'a jamais eu de rôles resterait donc perpétuellement en mode « composant » et ne pourrait jamais afficher la section catalogue pour le devenir. Les deux sections sont donc visibles pour **tout** nœud en mode édition, indépendamment de `kind` (qui ne sert plus que pour le libellé cosmétique du titre de la popup, ex. "Modifier l'interface" vs "Modifier le composant").

---

## Sprint 1 — Catalogue de rôles (popup d'édition, tout nœud)

### Fichiers modifiés

- `apps/desktop/src/renderer/components/schema/AddDependencyModal.tsx`
- `apps/desktop/src/renderer/components/schema/StructureTab.tsx`

### Décisions techniques

- **Édition du catalogue réservée au mode édition** (`isEdit`), pas au mode ajout — même règle que le label/description du composant/interface (déjà édit-only, `StructureTab.tsx:677-681`). Ajouter une dépendance reste un flux en une étape (mount only) ; le catalogue se saisit en rouvrant l'édition juste après. Évite d'écrire dans le schema d'un repo tout juste cloné avant que `addDependency` n'ait confirmé le clone.
- **Sections visibles pour tout nœud en édition, pas seulement `kind === 'interface'`** (cf. note de conception ci-dessus) — `kind` ne sert plus qu'au libellé du titre de la popup.
- **« Rôles joués » masqué seulement si rien à afficher** : visible si `catalogRoles.length > 0` (checkboxes) **ou** `parentRoles.length > 0` (legacy hors catalogue) ; masqué seulement quand les deux sont vides.
- **Pas de fetch séparé pour les « rôles joués » du parent** : comme le catalogue est édité dans la même popup, les cases à cocher de « rôles joués » se calculent en local à partir de l'état `catalogRoles` en cours d'édition (pas de round-trip réseau).
- **Rôle hérité hors catalogue** (legacy, ou catalogue vide) : affiché séparément en lecture seule avec un badge « hors catalogue » et sa propre case à cocher de suppression, reste inclus dans la sauvegarde tel quel tant que l'utilisateur ne le décoche pas explicitement (pas de purge silencieuse de données).
- **Écriture conditionnelle côté parent** : ne pas créer une entrée `implements` vide pour chaque nœud édité — cf. `StructureTab.tsx` ci-dessous, la mise à jour du parent n'a lieu que si `catalogRoles.length > 0 || parentRoles.length > 0` (il y a quelque chose de significatif à écrire ou à préserver).

### `AddDependencyModal.tsx`

```ts
export interface AddDependencyValues {
  url: string
  name: string
  branch: string
  /** Edit mode only — catalogue de rôles exposés par ce repo (le marque comme interface si non vide). */
  catalogRoles: RoleDefinition[]
  /** Edit mode only — rôles joués par le parent parmi catalogRoles (+ rôles hérités hors catalogue, préservés tels quels). */
  parentRoles: string[]
  label: string
  description: string
}
```

- `roles: string` (CSV, réservé à `kind === 'interface'`) est remplacé par `catalogRoles: RoleDefinition[]` + `parentRoles: string[]`, disponibles quel que soit `kind`. `AddDependencyValues.roles` disparaît — tous les appelants (`StructureTab.tsx`) sont mis à jour dans ce même sprint.
- Nouvelle section JSX « Rôles exposés par ce repo » (visible si `isEdit`, peu importe `kind`), au-dessus de la section « Rôles joués » existante :
  - Tableau éditable `catalogRoles` (colonnes `name`, `label`, bouton suppression), réutilise le même pattern de tableau que l'ancien `InterfacesTab` (`schema.tsx:243-277`) — nom + label, `+ Ajouter un rôle`.
- Section « Rôles joués » existante (visible si `isEdit && (catalogRoles.length > 0 || parentRoles.length > 0)`) : remplace l'`<input>` texte libre par des cases à cocher, une par `catalogRoles[i].name`, plus — si présents — les éléments de `parentRoles` absents de `catalogRoles` affichés séparément en lecture seule avec badge « hors catalogue » et une case à cocher pour les retirer explicitement.
- `handleSubmit` : valide et transmet `catalogRoles` et `parentRoles` bruts (pas de trim CSV à faire, ce sont déjà des tableaux).

### `StructureTab.tsx`

- `handleOpenEditDependency` (ligne 670-693) :
  - `roles` pré-rempli comme aujourd'hui depuis `parentSchema.implements.find(...).roles` → devient `parentRoles`, pour tout nœud (plus de branche conditionnelle sur `node.isInterface`).
  - Nouveau : `catalogRoles` pré-rempli depuis `childSchema?.roles ?? []` (le `childSchema` est déjà chargé juste après pour label/description, ligne 679), pour tout nœud.
- `handleSubmitEditDependency` (ligne 695-776) :
  - Le bloc existant qui écrit `label`/`description` dans le child schema (ligne 757-767) est étendu : inclure aussi `roles: values.catalogRoles` dans `nextChildSchema`, pour tout nœud (plus de condition sur `editingDependency.kind`).
  - L'appel existant `updateInterfaceRoles(editingDependency.parentRepoPath, values.name, ...)` (ligne 746-752) : condition remplacée — `if (values.catalogRoles.length > 0 || values.parentRoles.length > 0)` au lieu de `if (editingDependency.kind === 'interface')` — reçoit `values.parentRoles` (déjà un tableau, plus besoin du `.split(',')`).

### `workspaceActions.ts`

- `updateInterfaceRoles` : signature inchangée (prend déjà `roles: string[]`) — aucun changement nécessaire, l'appelant transmet directement `parentRoles`.

---

## Sprint 2 — Interfaces implémentées (popup d'édition, tout nœud)

### Fichiers modifiés

- `apps/desktop/src/renderer/components/schema/AddDependencyModal.tsx`
- `apps/desktop/src/renderer/components/schema/StructureTab.tsx`
- `apps/desktop/src/renderer/lib/workspaceActions.ts`

### Décisions techniques

- **Résolution du catalogue par ligne** : chaque ligne de la table « Interfaces implémentées » référence une interface par son nom de montage (texte libre, cf. Hors scope de `T110.md` — pas forcément déjà montée). La résolution du catalogue de rôles pour l'auto-complétion des cases à cocher se fait via un résolveur passé en prop depuis `StructureTab` (qui a déjà `flatNodes` + accès aux schemas via `useWorkspaceStructure`/`schemasByRepoPath`), pas par un fetch direct dans la modal — la modal reste un composant de présentation.
- **Fallback texte libre** si le nom saisi ne résout à aucun repo connu localement (interface non montée) — comportement de l'ancien onglet Interfaces conservé pour ce cas (`schema.tsx:328-336`, champ « Version implémentée » `non résolu`).

### `AddDependencyModal.tsx`

```ts
export interface AddDependencyValues {
  // ...Sprint 1 fields...
  /** Edit mode only. */
  implementsList: ImplementsDeclaration[]
}

interface Props {
  // ...existing...
  /** Résout le nom de montage d'une interface vers son catalogue de rôles, ou null si non résolvable. */
  resolveInterfaceRoles?: (mountName: string) => RoleDefinition[] | null
}
```

- Nouvelle section (visible si `isEdit`, peu importe `kind` — un repo interface peut lui-même implémenter une autre interface) : reprise du tableau « Implémentations » de l'ancien `InterfacesTab` (`schema.tsx:302-344`) — une ligne par entrée `{ interface, roles }`, plus « Version implémentée » en lecture seule affichée via `resolveInterfaceRoles` (réutilisé pour le pin — voir note ci-dessous) ou une prop dédiée si la résolution du pin reste séparée de celle des rôles.
  - Le champ rôles de chaque ligne : si `resolveInterfaceRoles(row.interface)` retourne une liste non vide → cases à cocher ; sinon → `<input>` texte libre (comportement actuel inchangé pour ce cas).

### `StructureTab.tsx`

- `handleOpenEditDependency` : pré-remplir `implementsList` depuis `childSchema?.implements ?? []` (déjà chargé à cet endroit) pour tout nœud, plus de condition sur `node.isInterface`.
- Fournit `resolveInterfaceRoles` à `AddDependencyModal` : implémentation `(mountName) => { const repoPath = flatNodes.find(n => n.name === mountName)?.repoPath; return repoPath ? schemasByRepoPath.get(repoPath)?.roles ?? [] : null }`.
- `handleSubmitEditDependency` : écrit `implements: values.implementsList` dans le child schema pour tout nœud (même bloc que label/description/roles, ligne 757-767), plus de condition sur `editingDependency.kind`.

### `workspaceActions.ts`

- Pas de nouvelle fonction nécessaire — l'écriture `implements` du composant se fait directement dans `StructureTab.handleSubmitEditDependency` comme le label/description, en cohérence avec le pattern déjà en place pour ce bloc (pas besoin d'une fonction dédiée type `updateInterfaceRoles` pour un cas déjà groupé avec label/description dans le même repo).

---

## Sprint 3 — Champ `roles` d'exigence + suppression de l'onglet

### Fichiers modifiés

- `apps/desktop/src/renderer/components/system/EditView.tsx`
- `apps/desktop/src/renderer/routes/schema.tsx`
- `specs/SPEC-TEMPLATES.md`
- `specs/SPEC-REQ-requirements.md`
- `specs/SPEC-INDEX.md` (colonne `MAJ`)

### Décisions techniques

- **Résolution du catalogue dans `EditView`** : `EditView` reçoit déjà `repoPath` (`EditViewProps`, ligne 339). Ajout d'une requête react-query `useQuery(['schema', repoPath], () => api.schema.get(repoPath), { enabled: !!repoPath })` au niveau `EditView` (pas `FieldControl`, pour ne fetcher qu'une fois par montage de vue, pas par champ). Le résultat (`schema?.roles`) est passé en prop à `FieldRow`/`FieldControl` uniquement pour le champ concerné.
- **Spécialisation par nom de champ, pas par nouveau type** : `field.type === 'multi_enum' && field.name === 'roles'` → options = `interfaceRoles?.length ? interfaceRoles.map(r => r.name) : field.values ?? []`. Choix déjà validé dans `T110.md` (pas de nouveau `SchemaFieldType`).
- Ce même hook `useQuery(['schema', repoPath])` est probablement déjà utilisé ailleurs dans l'arbre de composants (ex. `StructureTab`) — réutilise la clé de cache react-query existante (`['schema', repoPath]`, cf. `qc.invalidateQueries({ queryKey: ['schema', ...] })` déjà présent dans `StructureTab.tsx`), donc pas de fetch réseau dupliqué si un ancêtre a déjà chargé ce schema.

### `EditView.tsx`

- `FieldControl` : nouvelle prop `interfaceRoles?: string[]`. Case `'multi_enum'` (ligne 96-123) :
  ```ts
  const opts = (field.name === 'roles' && interfaceRoles?.length) ? interfaceRoles : (field.values ?? [])
  ```
- `FieldRow` et `EditView` (composant racine) : plombent `interfaceRoles` depuis la requête schema jusqu'à `FieldControl`.

### `schema.tsx`

- Suppression de `InterfacesTab` (lignes 195-360) et de l'entrée `{ key: 'interfaces', label: 'Interfaces' }` dans `TABS` (ligne 438-442).
- `activeTab === 'interfaces'` (ligne 504-506) supprimé.
- `EditorState.roles` / `EditorState.implements` et `editableToSchema` (lignes 70-89) : **conservés inchangés** — toujours nécessaires comme représentation en mémoire de `ProjectSchema.roles`/`implements`, désormais alimentés uniquement par `StructureTab` (Sprints 1-2) au lieu de `InterfacesTab`.

### SPEC à jour (dernier sprint, cf. `## Refs SPEC` de `T110.md`)

- `SPEC-TEMPLATES.md` §3a/3b : documenter la source unique (catalogue édité dans Structure) et la disparition de l'onglet Interfaces.
- `SPEC-REQ-requirements.md` §3 : documenter le comportement spécial du champ `multi_enum` nommé `roles` dans un repo interface.
- `SPEC-INDEX.md` : mettre à jour la colonne `MAJ` → `T110` pour ces sections.

---

## Alternatives rejetées

- **Nouveau `SchemaFieldType: 'interface_roles'`** dédié pour le champ (3) plutôt qu'une spécialisation par nom `roles` : rejeté — ajoute un type au modèle de données pour un besoin qui se résout entièrement par convention de nommage, sans migration de projets existants (un champ `multi_enum` nommé `roles` continue de fonctionner tel quel, avec ou sans catalogue).
- **Validation stricte croisée** (bloquer la sauvegarde d'un rôle hors catalogue) : rejeté — cf. `T110.md` Hors scope, risque de bloquer un flux de migration ou un cas où le catalogue est renseigné après coup.
- **Fetch du catalogue par ligne dans `AddDependencyModal` directement** (au lieu du résolveur fourni par `StructureTab`) : rejeté — la modal resterait un composant de présentation pure, testable sans dépendance à `api`/react-query ; `StructureTab` a déjà toutes les données nécessaires en mémoire (`flatNodes`, `schemasByRepoPath`).
