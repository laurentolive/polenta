# GH201 — Design technique : version de composant / produit

> Spec : `specs/GH201.md` (validée 2026-11-02, points ouverts P1–P3 acceptés tels que proposés :
> tag poussé au prochain push du repo, `<projet>` = nom du repo dans le workspace, une seule
> version en cours par repo).

## 1. Découpage

| Sprint | Périmètre |
|---|---|
| 1 | Types, schéma (catégorie `version`, règles), `VersionsService` (CRUD, backlog, `base`, page, passage released), `VersionTrackingService` (contenu à un commit, hors interface), push des tags en attente, IPC / api-client / channel-policy, **graphe** (`versions`, `designVersion`, `polenta.d.ts`, manifeste — avancé du sprint 3 : le changement de `GraphObjectCategory` régénère déjà `polenta.d.ts`, un seul cran de manifeste), tests unitaires |
| 2 | Renderer : « + Version » dans l'onglet Structure, types version masqués du panneau Système, sous-panneau « Produit » du panneau Version, page d'une version, page backlog, sélecteur d'éléments, dialogue de passage released, i18n |
| 3 | Outils MCP de lecture, mises à jour SPEC |

### Ajustements du sprint 1 (revue de code)

- `create` sans `basedOn` : dernière version released du repo (pré-remplissage côté service) ; `null` = aucune.
- Une version figée (`freeze` posé : released, ou abandonnée après l'avoir été) ne revient jamais en
  cours ; statut inconnu du type refusé (`STATUS_UNKNOWN`).
- Passage released : le tag est posé sur le commit **avant** que la branche n'avance
  (`commitSingleFile(…, beforeRefUpdate)`, `noUpdateBranch`) — un échec du tag ne laisse pas de
  version released sans tag.
- Liste des tags en attente : lecture-modification-écriture sérialisée, relue après le push.
- Contrôle `COMPONENT_NOT_RELEASED` sur les dépendances du repo (même résolution que la page).
- Schéma : le type version d'un repo qui a des versions garde nom et préfixe et ne se retire pas
  (`VERSION_TYPE_INVALID`) ; suppression en cascade : `HAS_VERSIONS`.
- `RequirementsIndexService` ne se reconstruit plus sur `versions/<ID>.yaml` (seulement sur les
  instantanés `versions/<REQ>/vN.yaml`).

### Ajustements du sprint 2 (revue de code)

- Une version **abandonnée est définitive** (ne revient pas en cours) : avec une seule version en
  cours à la fois, l'ordre des ID est l'ordre des livraisons (backlog, `basedOn` par défaut, statut
  de design).
- Schéma : tant que le repo a des versions, les statuts marqués du type version (`isApproval`,
  `isTerminal`) gardent nom et marque (un statut non marqué peut s'ajouter).
- Champs d'une version écrits par `applyFieldsWrite` (comme les autres objets) ; affichés par
  `fieldValueToText`.
- `versions:release-preview` reçoit le tag saisi : `TAG_EXISTS` / `TAG_INVALID` dans les problèmes,
  le dialogue ne propose pas de confirmer un tag voué à l'échec.
- Passage released : la branche n'avance que si elle n'a pas bougé pendant la pose du tag.
- Page : changements d'une dépendance attribués seulement si la version de `basedOn` est un ancêtre
  de la version retenue (retour arrière / autre lignée : aucune ligne).
- Routes `/versions`, `/versions/backlog`, `/version/$versionId` rattachées au panneau Version
  (`isProductVersionsPath`) ; cache des widgets Suivi invalidé sur `versions/`.
- Non traité (assumé) : `versions:tree` calcule le backlog complet de chaque repo pour le compteur.

## 2. Types (`packages/types/src/product-version.ts`, exporté par `index.ts`)

```ts
export interface VersionElementRef { sha: string; version: number }
export interface VersionChange { id: string; base?: VersionElementRef }
export interface VersionFreeze { tag: string; sha: string }

/** Objet version (fichier `versions/<ID>.yaml`). */
export interface ProductVersion extends HistoryCarrier {
  id: string; projectId?: string; branchId?: string
  objectTypeRef: string; title: string; status: string; version?: number
  basedOn?: string
  components?: Record<string, string>   // nom de montage → ID de version
  changes?: VersionChange[]
  freeze?: VersionFreeze
  fields?: Record<string, unknown>
}

export type VersionState = 'in_progress' | 'released' | 'abandoned'   // lu des marques isApproval / isTerminal
export interface VersionSummary { id; title; status; state: VersionState; basedOn?; freeze? }

/** Nœud du sous-panneau Produit : un repo. */
export interface VersionComponentNode {
  name: string; label: string; repoPath: string
  readonly: boolean
  versionType: { ref: string; label: string } | null
  versions: VersionSummary[]          // du plus récent au plus ancien (ID décroissant)
  backlogCount: number
  children: VersionComponentNode[]
}

export interface VersionBacklogItem {
  id; title; category: 'requirement' | 'test'; status; objectTypeRef
  kind: 'new' | 'modified'
  base?: VersionElementRef
  outside?: { approvedSha: string | null; dirty: boolean }
  filePath: string
}

export interface VersionChangeRow {
  component: string; componentLabel: string; repoPath: string
  versionId: string; versionTitle: string
  category: 'requirement' | 'test' | 'issue' | null   // null : élément introuvable (supprimé)
  id: string; title: string
  base?: VersionElementRef
  toSha: string | null                // freeze.sha de la version porteuse ; null = disque
  filePath: string | null
  own: boolean                        // ligne de cette version (retirable si en cours)
}

export interface VersionPage {
  version: ProductVersion; state: VersionState
  component: { name: string; label: string; repoPath: string; readonly: boolean }
  typeDef: ObjectTypeDefinition
  basedOn: VersionSummary | null
  components: Array<{ name; label; repoPath; versionType: boolean; selected: VersionSummary | null; options: VersionSummary[] }>
  rows: VersionChangeRow[]
}

export interface CreateVersionDto { title: string; basedOn?: string | null; components?: Record<string, string>; fields?: Record<string, unknown> }
export interface UpdateVersionDto { title?; basedOn?: string | null; components?: Record<string, string>; fields?; status? }
export interface VersionReleasePreview { suggestedTag: string; problems: VersionProblem[] }
export type VersionErrorCode = 'NO_VERSION_TYPE' | 'IN_PROGRESS_EXISTS' | 'LABEL_TAKEN' | 'VERSION_LOCKED'
  | 'TAG_INVALID' | 'TAG_EXISTS' | 'COMPONENT_NOT_RELEASED' | 'DIRTY_CHANGES' | 'READONLY_REPO' | 'NOT_IN_PROGRESS'
export interface VersionProblem { code: VersionErrorCode; detail: string }
```

`ObjectCategory` devient `'requirement' | 'test' | 'campaign' | 'version'`. Le typecheck désigne
les `switch` / listes à compléter ; la catégorie `version` est **exclue** des listes génériques du
panneau Système, de la recherche, des vues Excel/Word et des exports (filtre explicite).

Erreurs : `VersionError extends Error { code }`, message `CODE: détail` (même convention que
`LinkWriteError`) ; le renderer traduit le code.

## 3. Schéma (`schema.service.ts`)

- `save` / `addObjectType` : `assertVersionTypes(schema)` — au plus un type `version` par repo,
  déclaré sur le nœud `root` uniquement ; sinon `SchemaValidationError('VERSION_TYPE_INVALID')`.
- Statuts et champs par défaut : posés **côté renderer** à la création du type (StructureTab →
  `ElementConfigModal` pré-rempli), comme le reste de la configuration ; le main ne les invente pas.

## 4. Services main

### 4.1 `VersionTrackingService` (`version-tracking.service.ts`)

Port de `ChangeTrackingService` @ `4e06052`, sans changeset :

- `contentKey(record)` : JSON à clés triées du YAML **hors** `history`, `needsRevalidation`,
  `projectId`, `branchId` (§4 de la spec : statut et `version` comptent).
- `readAt(repo, sha, filePath)` (cache par sha) ; `readDisk`.
- `outsideModifications(repo)` : repris tel quel (CONTENT_KEYS GH200, `approvalEntry`,
  `commitsOf` en cache par HEAD), plus de garde `trackingOn`.

### 4.2 `VersionsService` (`versions.service.ts`)

Dépendances : `GitService`, `SyncService` (commit d'un fichier, tag, HEAD, statut des fichiers),
`SchemaService`, `HistoryService`, `WorkspaceTreeService`, `WorkspaceLinksService` (lecture
seule des repos — nouvelle méthode publique `readonlyRepoPaths(root, workspaceDir)` extraite de
`context()`), `RequirementsIndexService`, `TestsIndexService`, `VersionTrackingService`.

- `list(repo)` : `versions/*.yaml` à plat (le motif historique `versions/<REQ>/vN.yaml` de
  `RequirementsIndexService` vit dans des sous-dossiers : ignoré ici, et inversement).
- `tree(root, workspaceDir)` : `logicalTree` du cache workspace (mono-repo : nœud synthétique,
  nom = dossier) → `VersionComponentNode[]` ; `backlogCount` via `backlog(repo).length`.
- `create(repo, dto, workspaceDir)` : contrôles `READONLY_REPO`, `NO_VERSION_TYPE`,
  `IN_PROGRESS_EXISTS`, `LABEL_TAKEN` ; ID `nextCounterId(prefix, 'versions')` +
  `assertNewObjectFile` ; statut initial `initialStatus(typeDef)` ; `history.stamp`.
- `update(repo, id, dto, workspaceDir)` : released → seul un passage `isTerminal` est accepté
  (sinon `VERSION_LOCKED`) ; passage vers `isApproval` refusé (`release` obligatoire) ;
  `LABEL_TAKEN` ; `history.stamp`.
- `include(repo, id, elementIds)` / `removeChanges(repo, id, ids)` : version en cours seulement
  (`NOT_IN_PROGRESS`) ; `base` calculée par `baseOf` ; élément déjà présent ignoré.
- `backlog(repo)` : algorithme §5.
- `page(repo, id, workspaceDir)` : §6.
- `releasePreview(repo, id, workspaceDir)` et `release(repo, id, tag, workspaceDir)` : §7.
- File d'écriture par `(repo, id)` (même `enqueue` que `CampaignsService`).

### 4.3 Push des tags (P1)

`SyncService` : `queueTagPush(repo, tag)` ajoute le tag à `.git/polenta-pending-tags` (fichier
local, non versionné) ; `push` et `pushBranch` appellent, après un push réussi,
`pushPendingTags(repo, remote)` (push de `refs/tags/<tag>` un par un — CLI pour un remote SSH,
isomorphic-git sinon ; un tag poussé est retiré de la liste ; un échec laisse le tag en attente
sans faire échouer le push de la branche).

## 5. Backlog (algorithme)

```
versions   = list(repo) ; enCours = la version non approuvée non terminale (≤ 1)
released   = versions isApproval, triées par ID numérique croissant
lastIncl   = Map<id, version> : pour chaque released, chaque change → lastIncl[id] = V
elements   = exigences + tests du repo (index, disque)
pour chaque élément hors enCours.changes :
  V = lastIncl[el.id]
  si !V : statut terminal → ignoré ; sinon { kind: 'new' }
  sinon : at = readAt(repo, V.freeze.sha, filePath)
          contentKey(at) ≠ contentKey(disk) → { kind: 'modified', base: { sha, version: at.version } }
hors interface : outsideModifications(repo) → drapeau `outside` sur la ligne ; ligne ajoutée
                 (kind 'modified') si l'élément n'est ni au backlog ni dans enCours.changes
tri : ID numérique
```

`baseOf(repo, id)` = `{ sha: V.freeze.sha, version }` pour `V = lastIncl[id]`, absent sinon.

## 6. Page d'une version

- `rows` = `ownRows(V)` ∪ `depRows(V)`.
- `ownRows(V)` : une ligne par `changes` ; titre / catégorie lus sur disque (introuvable :
  `category: null`, titre vide) ; `toSha = V.freeze?.sha ?? null` ; `own = true` pour la version
  de la page seulement.
- `depRows(V)` : pour chaque `dep` de `V.components` résolu dans le workspace (nom de montage →
  repo) : `stop = basedOn(V)?.components?.[dep]` ; chaîne `W = V.components[dep]` puis
  `W.basedOn` … jusqu'à `stop` exclu (ou fin de chaîne) ; pour chaque `W` : `ownRows(W)` +
  `depRows(W)` (récursif, garde anti-cycle par ID visité).
- `components` : dépendances directes du repo (enfants dans `logicalTree`) ; `options` = versions
  non abandonnées de la dépendance.

## 7. Passage released

`releasePreview` : `suggestedTag = sanitize(`${repoName}-${title}`)` (`repoName` = nom du nœud
workspace, sinon `basename(repo)` ; caractères hors `[A-Za-z0-9._/-]` → `-`) + `problems` :
`READONLY_REPO`, `NOT_IN_PROGRESS`, `COMPONENT_NOT_RELEASED` (chaque `components[dep]` lu dans
son repo), `DIRTY_CHANGES` (fichier d'un élément de `changes` ≠ HEAD : `SyncService.status`
de ce fichier). `TAG_EXISTS` / `TAG_INVALID` sont vérifiés sur le tag saisi.

`release(repo, id, tag)` : mêmes contrôles (refus `VersionError` sur le premier problème, liste
complète dans le détail) → `head = resolveHead` → objet `{ ...v, status: <isApproval>, freeze:
{ tag, sha: head } }` passé par `history.stamp` → `commitSingleFile(repo, versions/<id>.yaml,
yaml, '[version] <ID> <title> released')` → écriture disque du même contenu →
`createAnnotatedTag(repo, tag, '<title> (<ID>)', commitSha)` → `queueTagPush`. Le tag est validé
(`git check-ref-format`-like : pas d'espace, `..`, `~^:?*[\`, fin `.lock`/`/`) avant toute écriture.

## 8. IPC / api-client

Channels (tous dans `DESKTOP_ONLY_CHANNELS`, client web abandonné) : `versions:tree`,
`versions:list`, `versions:get` (page), `versions:create`, `versions:update`, `versions:include`,
`versions:remove-changes`, `versions:backlog`, `versions:release-preview`, `versions:release`.
Écritures enveloppées par `withGraphInvalidation`. `api.versions.*` dans `packages/api-client`.

## 9. Renderer (sprint 2)

- **StructureTab** : « + Version » dans le menu « + » d'un **repo** (`AddMenu`, pas
  `AddElementMenu` des nœuds locaux), masqué si le repo a déjà un type version ; type créé avec
  statuts `en_cours` / `released` (`isApproval`) / `abandonnee` (`isTerminal`) et champ
  `description` (richtext). `ElementConfigModal` : pas de section propre aux tests/campagnes.
- **Panneau Système / vues** : types `version` filtrés (ils vivent dans le panneau Version).
- **Panneau Version** : bouton d'en-tête « Produit » (icône `Package`) → route `/versions` ; tant
  que la route est `/versions*` ou `/version/*`, le corps du panneau est `ProductVersionsPanel` :
  arbre `versions:tree`, versions (pastille d'état), entrée « Backlog (n) », « Nouvelle version »
  (dialogue `NewVersionDialog` : label, `basedOn`, composants pré-remplis), case « Afficher les
  abandonnées ».
- **Routes** : `versions.tsx` (accueil : invite à choisir), `version.$versionId.tsx`
  (`?repoPath`), `versions_.backlog.tsx` (`?repoPath`).
- **Page version** (`VersionPage`) : en-tête (label éditable, statut — sélecteur des statuts non
  `isApproval` + bouton « Passer released »), `fields` via `DynamicField`, tableau Composants
  (sélecteur si en cours), tableau Changements (colonnes de la spec, « Voir les modifications »
  → `/diff?element=1&repoPath&filepath&baseSha&toSha`, « Retirer »), bouton « Ajouter » →
  `VersionElementPicker` (réintroduit depuis `ChangeElementPicker` @ `4e06052`, filtré au repo).
- **`ReleaseVersionDialog`** : tag pré-rempli, liste des problèmes de `release-preview`,
  confirmation désactivée tant qu'il y a un problème.
- **Page backlog** : tableau à cases (ID, titre, type, statut, nature, hors interface), « Inclure
  dans <ID label> », « Tout inclure », « Voir les modifications ».
- Invalidation : clé `['versions', …]` invalidée par `useLiveFileSync` (fichiers `versions/`,
  `requirements/`, `tests/`) et après chaque mutation.

## 10. Graphe / MCP (sprint 3)

- `GraphVersion { id, title, status, state, component, objectTypeRef, basedOn, components, changes,
  freeze, fields }` ; collection `versions` ; `GraphRequirement.designVersion: string | null`
  (`VersionsService.designVersions(repo)` : pour chaque released par ID croissant, exigences
  dont `version` à `freeze.sha` = `version` courante, première trouvée). Contrat inchangé
  (ajout de champs) : `polenta.d.ts` complété.
- MCP : `list_versions` (composant optionnel), `get_version` (page sans `options`),
  `get_version_backlog`. Aucune écriture.

## 11. Décisions et alternatives rejetées

- **Une version par repo** (Q4) : l'objectTypeRef est `root::<type>` ; pas de champ `component`
  dans le fichier (le repo fait foi).
- **Commit d'un seul fichier** au passage released (pas de commit global) : les autres
  modifications en cours restent en attente ; les éléments inclus doivent être commités
  (`DIRTY_CHANGES`) pour que `freeze.sha` les fige.
- **`freeze.sha` = HEAD avant le commit de la version** : un fichier ne peut pas contenir le sha
  de son propre commit ; le contenu des éléments est identique au tag.
- **Pending tags dans `.git/`** plutôt qu'un scan des tags distants à chaque push (coût réseau).
- **Backlog sans cache persistant** : lecture `readAt` en cache mémoire par sha ; le nombre de
  versions released est faible.
- Rejeté : statut `released` atteignable par `update` (le tag et le gel doivent être atomiques).
- Le dossier historique `versions/<REQ>/vN.yaml` lu par `RequirementsIndexService` n'est pas
  touché (motif distinct).

## 12. Fichiers

- `packages/types/src/schema.ts`, `product-version.ts`, `index.ts`, `graph.ts`
- `apps/desktop/src/main/services/{versions,version-tracking}.service.ts` (+ tests),
  `schema.service.ts`, `sync.service.ts`, `workspace-links.service.ts`, `graph.service.ts`
- `apps/desktop/src/main/{container.ts,ipc/index.ts}`, `web-server/channel-policy.ts`
- `packages/api-client/src/{types,ipc-client}.ts`
- `apps/desktop/src/mcp-server/{container.ts,tools/read.tools.ts}`
- Renderer : `components/schema/StructureTab.tsx`, `sidebar/VersionPanel.tsx`,
  `sidebar/version/ProductVersionsPanel.tsx`, `components/versions/*`, routes
  `versions.tsx`, `version.$versionId.tsx`, `versions_.backlog.tsx`, `i18n/locales/{fr,en}.json`
