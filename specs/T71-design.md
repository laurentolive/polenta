# T71-design — Version d'interface implémentée dérivée du pin git

## Fichiers à modifier

### 1. `packages/types/src/schema.ts`
Retirer le champ `version: string` de `ImplementsDeclaration` (lignes 85-92). Mettre à jour le commentaire doc (mentionne aujourd'hui « Semantic version of the interface this component implements » — devient obsolète).

### 2. `packages/types/src/polenta-workspace.ts`
Retirer `version` du type inline `WorkspaceTreeNode.implements?: Array<{ interface: string; version: string; roles: string[] }>` (ligne 51) → `Array<{ interface: string; roles: string[] }>`.

### 3. `apps/desktop/src/renderer/components/schema/AddDependencyModal.tsx`
- Retirer `version: string` de `AddDependencyValues` (ligne 8) et le state `const [version, setVersion] = useState('')` (ligne 26).
- Retirer la validation `if (kind === 'interface' && !version.trim()) { ... }` (lignes 37-40).
- Retirer `version: version.trim()` de l'objet passé à `onSubmit` (ligne 42).
- Retirer le bloc de champ "Version implémentée" du formulaire (lignes 69-80) — ne garder que "Rôles joués" pour le cas `interface` (passe de `grid-cols-2` à un champ pleine largeur, ou reste en grid avec le champ Rôles seul — détail visuel laissé à l'implémentation, cohérent avec le style existant).

### 4. `apps/desktop/src/renderer/components/schema/StructureTab.tsx`
Ligne ~474 : retirer `version: values.version,` de l'objet `ImplementsDeclaration` construit avant l'appel à `addInterfaceImplementation` (le champ n'existe plus sur le type, donc TypeScript signalera l'erreur si non retiré).

### 5. `apps/desktop/src/renderer/hooks/useWorkspaceStructure.ts`
Exposer la liste plate déjà calculée en interne (`flatNodes`, ligne 58-61) dans l'objet retourné par le hook (`WorkspaceStructure`), pour permettre à d'autres consommateurs (l'onglet Interfaces) de résoudre un nom de montage vers son pin sans dupliquer la logique de récupération de l'arbre. Aucun changement de comportement pour les consommateurs existants (`StructureTab.tsx`) — c'est un ajout pur.

```ts
export interface WorkspaceStructure {
  // ... champs existants inchangés
  /** Liste plate dédupliquée de tous les repos du workspace — utile pour résoudre un nom de montage vers son pin. */
  flatNodes: WorkspaceTreeNode[]
}
```

### 6. `apps/desktop/src/renderer/routes/schema.tsx` — `InterfacesTab`
- Ajouter les props `workspaceDir: string` et `repoPath: string` à `InterfacesTab` (transmises depuis `SchemaEditorPage`, qui les calcule déjà aux lignes 338-339).
- Appeler `useWorkspaceStructure(workspaceDir, repoPath)` à l'intérieur de `InterfacesTab` (même pattern que `StructureTab.tsx`) pour obtenir `flatNodes`.
- Construire `const pinByMountName = new Map(flatNodes.map(n => [n.name, n.pin]))`.
- Dans la boucle `state.implements.map(...)` (lignes 276-311), retirer le champ éditable "Version implémentée" (lignes 288-296 : input lié à `impl.version`) et le remplacer par un affichage en lecture seule :
  - si `pinByMountName.has(impl.interface)` → afficher le pin (`<code>` monospace, tronqué comme `node.pin.slice(0,8)` dans `StructureTab.tsx` si SHA long)
  - sinon → afficher "non résolu" en italique
- `updateImpl` et `addImpl` : retirer `version: ''` de l'objet initial créé par `addImpl` (ligne 196) — l'objet initial devient `{ interface: '', roles: [] }`.

### 7. Fichiers non modifiés (vérifiés par grep, aucune référence à `version` d'interface)
- `apps/desktop/src/main/services/workspace-tree.service.ts` — lit `schema.implements` tel quel et le propage ; aucune référence explicite au champ `version`, continue de fonctionner avec le type allégé sans changement.
- `apps/desktop/src/main/services/interface-compliance.service.ts` — la logique de conformité (rôles, liens `implements-interface`, `needsRevalidation`) ne référence jamais `version` ; aucun changement.
- `apps/desktop/src/renderer/lib/workspaceActions.ts` — `addInterfaceImplementation(workspaceDir, parentRepoPath, dep, impl)` reste inchangé structurellement ; `impl` a simplement un type plus étroit (compile sans modification du fichier).

## Nouvelles interfaces / types

Aucun nouveau type introduit. Un champ retiré (`ImplementsDeclaration.version`, `WorkspaceTreeNode.implements[].version`), un champ ajouté au hook existant (`WorkspaceStructure.flatNodes`).

## Décisions techniques et alternatives rejetées

| Décision | Alternative rejetée | Pourquoi |
|---|---|---|
| Résoudre le pin côté UI, par recherche dans `flatNodes` déjà chargé par `useWorkspaceStructure` | Ajouter une `resolvedVersion` calculée côté backend dans `workspace-tree.service.ts`, injectée directement dans `WorkspaceTreeNode.implements[]` | Redondant : le pin est déjà porté par le `WorkspaceTreeNode` du mount lui-même (`node.pin`) ; la résolution nom→pin est une simple recherche dans une liste déjà en mémoire côté renderer, pas besoin de dupliquer la donnée côté IPC |
| Aucune migration des `schema.yaml` existants portant encore une clé `version:` résiduelle | Écrire un script de migration qui retire la clé de tous les `schema.yaml` du workspace | La fonctionnalité interfaces est encore en développement (T69 Sprint4 → T70), pas de données de production ; une clé YAML résiduelle inconnue est simplement ignorée à la lecture (pas de validation stricte de schéma), aucun risque de crash |
| Affichage du pin brut (SHA court / tag / branche tel que déclaré) | Résolution vers le tag le plus proche (`git describe`) si le pin est un SHA | Validé en phase Spec avec l'utilisateur — reste cohérent avec l'affichage déjà existant du pin dans l'arbre Structure (`node.pin.slice(0,8)`), pas d'appel git supplémentaire |
| Pas de modification de la logique diamond-conflict / `MountOverride` | Ajouter un mécanisme dédié de détection de rétrocompatibilité entre deux pins d'interface différents | Validé en phase Spec — le mécanisme existant (conflit signalé, résolution manuelle via `MountOverride`) couvre déjà le cas de deux composants implémentant des versions différentes de la même interface ; l'acceptation du conflit par l'utilisateur *est* l'affirmation de compatibilité, pas besoin de la recalculer |

## Découpage en sprints

Un seul sprint. Le changement est petit et contenu : un champ retiré de deux types partagés, trois fichiers UI renderer ajustés, un hook existant légèrement enrichi. Aucun changement backend/IPC, aucune migration de données.
