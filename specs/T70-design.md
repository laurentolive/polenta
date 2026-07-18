# T70-design — Arbre de structure (composants & interfaces)

## 1. Vue d'ensemble

Bonne nouvelle découverte pendant l'analyse : la quasi-totalité de la mécanique nécessaire existe déjà côté IPC/services grâce à T69 :

| Besoin | Primitive déjà existante | Nouveau ? |
|---|---|---|
| Lire/écrire le schéma d'un repo quelconque | `api.schema.get(repoPath)` / `api.schema.save(repoPath, schema)` — fonctionne pour **n'importe quel** `repoPath` absolu, pas seulement le repo courant | Non |
| Lire/écrire `polenta-repo.yaml` d'un repo quelconque | `api.polentaRepo.get/save(repoPath, manifest)` | Non |
| Cloner les dépendances manquantes + détecter diamond conflicts | `api.workspace.rebuildTree(workspaceDir)` | Non |
| Obtenir `workspaceDir` et `repoPath` du repo courant | Déjà passés en search params de `/schema` (`repoPath`, `projectId` → `decodeProjectId(projectId)` = `workspaceDir`, cf. `project.$id.tsx`) | Non |
| Initialiser un workspace plat (mono-repo pas encore workspace) | `api.workspace.detect` / `api.workspace.init` | Non |
| Résoudre un conflit diamond | `DiamondConflictModal` + `api.workspace.setMountOverride` | Non (réutilisé tel quel) |

Donc l'essentiel du travail est **côté renderer** : un nouvel onglet qui orchestre ces primitives existantes, plus **un correctif ciblé** côté `WorkspaceTreeService` (checkout de branche manquant), plus le retrait de la route `/workspace`.

Aucun nouveau canal IPC n'est nécessaire. Aucun nouveau type partagé n'est nécessaire (on réutilise `PolentaRepoDependency`, `ImplementsDeclaration`, `WorkspaceTree`, `ProjectSchema`).

---

## 2. Fichiers à modifier

### 2.1 Bugfix ciblé (prérequis à UC-2/UC-3)

#### `apps/desktop/src/main/services/workspace-tree.service.ts`
`buildTree()` ne checkout la branche/tag que si `pin` ressemble à un SHA (`/^[0-9a-f]{7,40}$/i`). Un `pin` qui est un nom de branche (cas de ce ticket : l'utilisateur saisit une branche) n'est jamais checkout après le clone — le repo reste sur la branche par défaut du remote.
**Correctif** : après clone, si `pin` n'est pas un SHA, tenter `git.checkout({ fs, dir, ref: pin })` (branche ou tag) ; si le ref n'existe pas sur le remote, remonter une erreur `parse-error` explicite plutôt que de cloner silencieusement sur la mauvaise branche.
Impacte aussi `repoExistsAtPin()` : actuellement un repo présent est considéré "à jour" dès qu'il existe et que `pin` n'est pas un SHA ("trust the user") — comportement conservé pour les repos déjà présents (pas de re-checkout forcé à chaque rebuild, pour ne pas écraser un travail local), seul le clone initial doit checkout la bonne branche.

### 2.2 Renderer — nouveau contenu de `routes/schema.tsx`

- **Supprimer** `ComposantsTab` et `ElementsTab` (et leurs helpers `ComposantRow`, `emptyNode`).
- **Ajouter** `StructureTab` (nouveau composant, potentiellement extrait dans `components/schema/StructureTab.tsx` vu sa taille) :
  - Consomme `useWorkspaceStructure(workspaceDir, repoPath)` (nouveau hook, §2.4).
  - Affiche l'arbre (repo racine + dépendances récursives +, sous chaque repo, ses `ObjectTypeDefinition` comme feuilles).
  - Actions "+ Ajouter composant", "+ Ajouter interface" par repo (menu contextuel ou boutons au survol, dans l'esprit de l'actuel "+ Ajouter ▾" de `ElementsTab`).
  - Action "+ Ajouter élément" par repo → menu requirement/test/campaign (repris de `ElementsTab.addObjType`).
  - Clic sur un élément → ouvre `ElementConfigModal` (§2.3).
- **Renommer** l'onglet `elements` en `structure` dans `TABS` ; `activeTab` par défaut devient `'structure'`.
- `EditorState` perd `nodes` en tant que source unique de vérité pour Composants/Éléments — ces deux tabs disparaissent, remplacés par les données par-repo chargées à la demande. `roles` / `implements` (tab Interfaces) restent inchangés et continuent d'opérer sur `state` local du repo courant uniquement (pas de changement fonctionnel sur cet onglet, cf. hors scope).
- Le tab Liens (`LiensTab` / `getAllRefs`) reste inchangé, mais `getAllRefs` doit désormais lister les refs `nœud::type` du repo courant **uniquement** (déjà son comportement actuel — pas de régression, cf. CA-7 : cross-repo refs restent saisies manuellement comme aujourd'hui, aucune UI de sélection cross-repo n'est ajoutée par ce ticket).

### 2.3 Nouveau composant : `components/schema/ElementConfigModal.tsx`
Popup modale reprenant **exactement** le contenu de l'actuel `ObjectTypeCard` (nom, label, préfixe, couleur, `FieldsTable`, `StatusesTable`, note d'aide catégorie `test`), mais :
- Rendu comme modale plein-champ (`fixed inset-0`, pattern de `CancelConfirmModal`/`DiamondConflictModal`) au lieu de carte dépliable inline.
- Props : `{ repoPath: string; objectType: EditableObjectType; existingPrefixes: Set<string>; onSave; onDelete; onClose }`.
- Validation à l'enregistrement : `prefix` non vide et non présent dans `existingPrefixes` (préfixes de tous les repos du workspace, calculés par le hook §2.4) sauf si c'est son propre préfixe inchangé.
- `onSave` : lit le schéma actuel du `repoPath` concerné (déjà en cache react-query), met à jour son `objectTypes[]`, appelle `api.schema.save(repoPath, updated)`, invalide la query.

### 2.4 Nouveau hook : `hooks/useWorkspaceStructure.ts`
Centralise la logique d'orchestration pour éviter de la dupliquer dans `StructureTab` :
- `useWorkspaceStructure(workspaceDir, repoPath)` :
  - `workspaceStatus` : `api.workspace.detect(workspaceDir)` → `'workspace' | 'repo' | 'unknown'`.
  - Si `'workspace'` : `api.workspace.getTree(workspaceDir)` (lecture cache, pas de rebuild automatique pour rester rapide à l'ouverture) → liste de repos (`WorkspaceTreeNode[]`).
  - Si `'repo'` (mono-repo jamais initialisé en workspace) : liste synthétique à un seul élément (le repo courant), pas d'appel `workspace:get-tree`.
  - Pour chaque repo de la liste, une query `useProjectSchema(node.repoPath)` (déjà existant, réutilisé tel quel) → agrégées en `Map<repoPath, ProjectSchema>`.
  - Expose : `{ tree, schemasByRepoPath, allPrefixes: Set<string>, isWorkspace: boolean, refetchTree }`.
- Fonctions d'action exposées séparément (pas dans le hook, pour rester testables isolément) dans `lib/workspaceActions.ts` :
  - `addDependency(parentRepoPath, dep: PolentaRepoDependency)` : lit `polentaRepo.get(parentRepoPath)`, vérifie l'absence de conflit de nom (même `name` déjà présent dans l'arbre avec une `url` différente → throw `MountNameConflictError`), ajoute `dep` à `dependencies[]`, `polentaRepo.save(...)`, puis `workspace.rebuildTree(workspaceDir)`. Retourne le `WorkspaceOpenResult` (peut être `diamond-conflict` → `StructureTab` affiche `DiamondConflictModal`).
  - `addInterfaceImplementation(parentRepoPath, dep: PolentaRepoDependency, impl: ImplementsDeclaration)` : appelle `addDependency`, puis lit `schema.get(parentRepoPath)`, ajoute `impl` à `implements[]`, `schema.save(...)`.
  - `ensureWorkspaceInitialized(workspaceDir, repoPath)` : si `detect()` ≠ `'workspace'`, appelle `workspace.init(workspaceDir, repoPath)` avant de poursuivre (cas limite "jamais initialisé").

### 2.5 `routes/compliance.tsx`
Le bouton retour (`onClick={() => navigate({ to: '/workspace', search: { dir } })}`) devient un lien vers l'onglet Structure du projet courant. `compliance.tsx` ne reçoit aujourd'hui que `dir` (workspaceDir) en search param, pas de `repoPath`/`projectId` — il faut lui ajouter ces deux params (propagés depuis `StructureTab` lors de la navigation vers `/compliance`) pour permettre le retour.

### 2.6 Suppression
- `routes/workspace.tsx` (route entière retirée).
- `RepoNode`, `FlatNodeList` de `workspace.tsx` : la logique de rendu d'arbre est reprise (pas copiée telle quelle) dans `StructureTab`, adaptée pour inclure les feuilles "éléments".

---

## 3. Nouvelles interfaces / types

Aucun nouveau type partagé dans `@polenta/types` — réutilisation intégrale de l'existant (`PolentaRepoDependency`, `PolentaRepoManifest`, `ImplementsDeclaration`, `WorkspaceTree`, `WorkspaceTreeNode`, `ProjectSchema`, `ObjectTypeDefinition`).

Types purement renderer (non partagés) :

```typescript
// hooks/useWorkspaceStructure.ts
interface WorkspaceStructure {
  isWorkspace: boolean
  tree: WorkspaceTreeNode[]        // liste plate ; racine = premier élément si !isWorkspace
  schemasByRepoPath: Map<string, ProjectSchema>
  allPrefixes: Set<string>
  refetchTree: () => Promise<void>
}

// lib/workspaceActions.ts
class MountNameConflictError extends Error {
  constructor(public readonly mountName: string, public readonly existingUrl: string, public readonly newUrl: string) { ... }
}
```

---

## 4. Décisions techniques et alternatives rejetées

### 4.1 Pas de nouveau canal IPC
**Décision** : toute l'orchestration (ajout dépendance, ajout implements, validation préfixe) se fait côté renderer en composant les canaux IPC existants (`polentaRepo.get/save`, `schema.get/save`, `workspace.rebuildTree`).
**Alternative rejetée** : un canal `workspace:add-dependency` dédié côté main. Rejeté — aurait dupliqué une logique déjà exprimable avec les primitives existantes, pour un projet desktop mono-utilisateur où la race condition entre lecture et écriture du manifeste est non pertinente (pas d'accès concurrent).

### 4.2 Validation du préfixe : agrégation client-side, pas de nouveau calcul serveur
**Décision** : `allPrefixes` est calculé dans le hook à partir des `ProjectSchema` déjà chargés (un par repo affiché dans l'arbre). Pas de nouvelle méthode `SchemaService`.
**Rationale** : l'arbre affiche déjà tous les repos et donc leurs schémas sont déjà en mémoire (react-query) pour construire les feuilles "éléments" — l'agrégation est gratuite.

### 4.3 Correctif checkout de branche isolé du reste
**Décision** : le bugfix de `WorkspaceTreeService.buildTree` (checkout du pin même quand ce n'est pas un SHA) est fait en Sprint 2, juste avant l'implémentation de l'ajout de dépendance, pour être testé dans le même sprint.
**Alternative rejetée** : le traiter comme ticket bug séparé. Rejeté — il est invisible/inoffensif tant qu'aucune UI ne permet de saisir une branche comme pin (ce que ce ticket introduit), donc il n'a pas de sens de le sortir de ce ticket.

### 4.4 `StructureTab` extrait dans son propre fichier
**Décision** : contrairement à `ComposantsTab`/`ElementsTab` qui vivaient dans `schema.tsx`, `StructureTab` est extrait dans `components/schema/StructureTab.tsx` vu son volume attendu (arbre + 3 formulaires d'ajout + intégration modale).
**Rationale** : `schema.tsx` fait déjà 1000+ lignes ; ajouter l'arbre + les formulaires sans extraction le rendrait difficile à maintenir.

### 4.5 Anciens projets avec `SystemNode` locaux multiples sans repo

> **Spec caduque (constatée T113) :** la décision ci-dessous traitait tout `SystemNode` non-root
> comme un cas hérité à corriger (badge d'avertissement, aucune création possible depuis l'UI).
> T113 en fait un pattern de premier ordre — voir `SPEC-TEMPLATES.md` §3 ("Plusieurs `SystemNode`
> locaux par repo"). Le badge et le traitement "affichage de compatibilité" décrits ici ont été
> retirés ; cette section reste comme repère historique de l'intention T70.

**Décision** : un `SystemNode` du repo courant qui n'a pas de correspondance dans l'arbre workspace (cas : ancien `node.name` créé avant T70, jamais associé à un vrai repo cloné) est affiché en tête d'arbre à plat, sous un badge "⚠ non associé à un repo", avec ses éléments visibles et éditables (le `schema.yaml` du repo courant contient toujours ce nœud), mais sans possibilité de le transformer automatiquement en dépendance. C'est un affichage de compatibilité, pas une nouvelle fonctionnalité de migration.

---

## 5. Impact sur les services existants

| Service | Impact |
|---|---|
| `WorkspaceTreeService` | Correctif checkout de branche (§2.1) — aucun changement de signature |
| `SchemaService` | Aucun changement — déjà générique sur `repoPath` |
| `PolentaRepoService` | Aucun changement — déjà générique sur `repoPath` |
| IPC (`ipc/index.ts`) | Aucun nouveau canal |
| `ComplianceMatrix` / `interface-compliance.service.ts` | Aucun changement fonctionnel, seul le point d'entrée de navigation change (§2.5) |

---

## 6. Arbre de fichiers créés / modifiés

```
apps/desktop/src/main/services/
  workspace-tree.service.ts        modifié  (checkout de branche/tag après clone initial)

apps/desktop/src/renderer/
  routes/schema.tsx                 modifié  (StructureTab remplace ComposantsTab+ElementsTab)
  routes/compliance.tsx             modifié  (navigation retour vers l'onglet Structure)
  routes/workspace.tsx              SUPPRIMÉ
  components/schema/StructureTab.tsx        NOUVEAU
  components/schema/ElementConfigModal.tsx  NOUVEAU
  hooks/useWorkspaceStructure.ts             NOUVEAU
  lib/workspaceActions.ts                    NOUVEAU

specs/SPEC-INDEX.md                 modifié (dernier sprint) — ligne T69 §Structure → T70
```

---

## 7. Découpage en sprints

### Sprint 1 — Lecture de l'arbre + édition d'un élément existant (CA-1, CA-4 partiel, CA-5, CA-7)

**Périmètre** :
- `useWorkspaceStructure` (lecture seule : `detect` + `getTree` + agrégation des schémas).
- `StructureTab` en lecture/édition seule : affichage arbre (repos + éléments), pas encore d'ajout de composant/interface/élément.
- `ElementConfigModal` : édition d'un élément existant (clic dans l'arbre), avec validation préfixe cross-repo.
- Remplacement effectif de `ComposantsTab`/`ElementsTab` par `StructureTab` dans `schema.tsx`.
- Aucune régression sur les onglets Liens/Interfaces.

**Critères de validation Sprint 1** : CA-1, CA-5, CA-7, CA-4 (édition, hors création).

### Sprint 2 — Ajout de dépendances (UC-2, UC-3, CA-2, CA-3, CA-4 complet)

**Périmètre** :
- Correctif checkout de branche dans `WorkspaceTreeService` (§2.1).
- `lib/workspaceActions.ts` : `addDependency`, `addInterfaceImplementation`, `ensureWorkspaceInitialized`.
- Formulaires "+ Ajouter composant" / "+ Ajouter interface" / "+ Ajouter élément" dans `StructureTab`.
- Gestion diamond conflict (réutilisation de `DiamondConflictModal`) déclenchée par un ajout.
- Cas limite : projet mono-repo jamais initialisé en workspace → proposition d'initialisation avant ajout.

**Critères de validation Sprint 2** : CA-2, CA-3, CA-4 complet, cas limite "jamais initialisé", cas limite "conflit de nom de montage".

### Sprint 3 — Retrait de `/workspace` et nettoyage (CA-6, CA-7 final)

**Périmètre** :
- Suppression de `routes/workspace.tsx`.
- `routes/compliance.tsx` : navigation retour vers l'onglet Structure (ajout `repoPath`/`projectId` en search params).
- Affichage de compatibilité pour les anciens `SystemNode` sans repo associé (§4.5).
- Mise à jour de `SPEC-INDEX.md`.
- Passe de régression complète sur les 4 onglets de `/schema`.

**Critères de validation Sprint 3** : CA-6, CA-7, cas limite "ancien projet avec nœuds locaux multiples".
