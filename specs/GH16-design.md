# GH16 — Design : tools MCP de gestion des liens

> Spec : `specs/GH16.md` — **1 sprint**.

## 1. Vue d'ensemble

```
mcp-server/tools/links.tools.ts          ← NOUVEAU : list_links / create_links / delete_links
        │  (résolution des objets, orchestration dryRun)
        ├─► main/services/link-validation.util.ts   ← NOUVEAU : règles 1–5, pur (pas d'I/O)
        └─► RequirementsIndexService                 ← +reloadLinks / createLinks / deleteLinks (lot, file sérialisée)
```

Même découpage que `bulk_import_*` : la validation est une fonction pure dans
`main/services/*.util.ts`, le tool MCP fait les lectures (schéma, objets, liens) puis
appelle le service pour l'écriture.

## 2. Fichiers modifiés / créés

| Fichier | Nature | Pourquoi |
|---|---|---|
| `apps/desktop/src/mcp-server/tools/links.tools.ts` | nouveau | les 3 tools, zod d'entrée, résolution des objets |
| `apps/desktop/src/main/services/link-validation.util.ts` | nouveau | validation stricte d'un lot d'entrées (règles 1–5 de la spec) |
| `apps/desktop/src/main/services/requirements-index.service.ts` | modifié | `reloadLinks`, `createLinks`, `deleteLinks`, file de sérialisation des écritures de liens |
| `apps/desktop/src/main/services/requirements.service.ts` | modifié | façades `reloadLinks`/`createLinks`/`deleteLinks` (comme `createLink`/`deleteLink` existants) |
| `apps/desktop/src/mcp-server/container.ts` | modifié | exposer `reqIndex`, `testsIndex` (invalidation sur miss, §4.2) |
| `apps/desktop/src/mcp-server/index.ts` | modifié | `registerLinkTools(server, container)` |
| `apps/desktop/src/main/services/agents-md.template.ts` | modifié | mention des 3 tools ; `AGENTS_MD_TEMPLATE_VERSION` 1 → 2 (régénération à l'ouverture, SPEC-MCP-SERVER §5.2) |
| `specs/SPEC-MCP-SERVER.md`, `specs/SPEC-INDEX.md` | modifiés | §4.4 Liens, §7, §8, mots-clés |

`createLink`/`deleteLink` (chemin IPC de l'UI) restent **inchangés** (hors scope).

## 3. Interfaces

### 3.1 `RequirementsIndexService` (ajouts)

```ts
/** Relit links/links.yaml depuis le disque et remplace idx.links (si l'index est construit ;
 *  sinon getOrBuild le lira). Retourne la liste à jour. */
async reloadLinks(repoPath: string): Promise<ObjectLink[]>

/** Ajoute un lot de liens (déjà validés) — une seule écriture de links.yaml. */
async createLinks(
  repoPath: string,
  data: Array<{ type: string; sourceId: string; targetId: string }>,
  createdBy: string,
): Promise<ObjectLink[]>

/** Supprime les liens d'ids donnés — une seule écriture. Retourne les ids réellement supprimés. */
async deleteLinks(repoPath: string, ids: string[]): Promise<string[]>
```

- `createLinks`/`deleteLinks` passent par `withLinksQueue(repoPath, fn)` (Map<repoPath,
  Promise> chaînée, même idiome que `SchemaService.withMutationQueue`) et **commencent par
  `reloadLinks`** à l'intérieur de la file : l'écriture part toujours de l'état disque
  courant (spec §4 — ne pas écraser un lien créé par l'app).
- Génération d'id : factoriser l'expression existante de `createLink` dans une fonction
  `newLinkId()` ; unicité dans un lot garantie par l'aléa + un contrôle `Set` (regénérer
  en cas de collision).
- `reloadLinks` lit via `git.readYaml<{ links: ObjectLink[] }>(repoPath, 'links/links.yaml')`
  (fichier absent ou vide → `[]`). `readYaml` lève déjà sur un YAML invalide (seul
  `ENOENT` est avalé) — l'erreur remonte, rien n'est écrit. Garde ajoutée : un contenu
  non vide dont `links` n'est pas un tableau lève aussi (sinon `createLinks` réécrirait
  le fichier à partir de `[]` et perdrait tous les liens).

### 3.2 `link-validation.util.ts`

```ts
export type LinkErrorCode =
  | 'LINK_TYPE_NOT_FOUND' | 'SELF_LINK' | 'OBJECT_NOT_FOUND'
  | 'LINK_TYPE_INCOMPATIBLE' | 'DUPLICATE_LINK'

export interface LinkEntryDto { type: string; sourceId: string; targetId: string }
export interface LinkEntryError { index: number; code: LinkErrorCode | 'LINK_NOT_FOUND'; reason: string }

/** Ce que le tool a résolu pour un ID (null = introuvable). */
export interface ResolvedLinkObject {
  id: string
  category: 'requirement' | 'test' | 'campaign'
  objectTypeRef?: string
}

export function validateLinkEntries(
  linkTypes: LinkTypeDefinition[],
  entries: LinkEntryDto[],
  resolve: (id: string) => ResolvedLinkObject | null,
  existing: ObjectLink[],
): { valid: Array<{ index: number; dto: LinkEntryDto }>; errors: LinkEntryError[] }

/** Règle `matchesRefs` de linkUtils.ts (renderer) — dupliquée côté main, voir §5. */
export function matchesRefs(obj: ResolvedLinkObject, refs: string[] | undefined): boolean
```

Ordre des règles et codes : exactement la spec §2. Doublon = clé non orientée
`type|min(a,b)|max(a,b)` ; un `Set` initialisé avec les liens existants, enrichi à chaque
entrée valide du lot.

### 3.3 `links.tools.ts`

```ts
export function registerLinkTools(server: McpServer, container: McpContainer): void
```

- `list_links { objectId?, type? }` → `reloadLinks` puis filtres → `jsonToolResult({ links })`.
  Pas de `paginate` : les liens sont petits et un agent a besoin de la liste complète pour
  éviter les doublons ; si ça devient un problème, `objectId` filtre.
- `create_links { entries, dryRun = true }` :
  1. `schema = container.schema.get(repoPath)` ; `existing = reloadLinks(repoPath)`
  2. résolution des IDs (§4) → `validateLinkEntries`
  3. dryRun → `{ dryRun: true, summary, wouldCreate, created: [], errors }`
  4. sinon → `requirements.createLinks(repoPath, valid.map(dto), 'mcp')` →
     `{ dryRun: false, summary, created: [{ index, id }], wouldCreate: [], errors }`.
     Entre l'étape 2 et l'écriture, un doublon peut apparaître (écriture concurrente de
     l'app) : risque accepté, fenêtre de quelques ms, même niveau que `bulk_import_*`.
- `delete_links { ids, dryRun = true }` : `reloadLinks` → partition trouvés / `LINK_NOT_FOUND`
  → dryRun : `wouldDelete` (objets complets) ; sinon `deleteLinks` → `deleted`.
  Un même id répété dans `ids` : la 2ᵉ occurrence → `LINK_NOT_FOUND` (déjà traité).

Entrées zod : `type`, `sourceId`, `targetId` en `z.string().min(1)` ; `entries`/`ids` en
`z.array(...)` (lot vide accepté → résultat avec `total: 0`).

## 4. Résolution des objets (point ouvert de la spec)

### 4.1 Périmètre de recherche

`repoPaths = resolveWorkspaceRepoPaths(container.workspaceTree, repoPath, workspaceDir)`
(`workspace-repos.util.ts`, déjà utilisé par `TraceabilityService`) : repo ciblé seul en
mode mono-repo, repo ciblé + repos composants du cache d'arbre de workspace sinon.

Pour chaque repo, on construit une table `id → ResolvedLinkObject` à partir de :
- `requirements.findAll(p, {})` → `category: 'requirement'`
- `tests.findAll(p)` → `category: 'test'`
- `campaigns.list(p)` → `category: 'campaign'` (`objectTypeRef` optionnel)

La table est construite **une fois par appel** de tool, puis `resolve(id)` y lit.

**Catégorie = emplacement de stockage**, pas le schéma. Un objet sous `requirements/` est
par construction d'un type `category: requirement` (c'est `RequirementsService.create`
qui choisit le dossier selon la catégorie). Avantage décisif : un objet d'un composant
submodule dont le type est `'unresolvable'` dans le schéma produit (nœud sans
`objectTypes` inlinés) a quand même une catégorie fiable, sans charger le schéma du
composant. Les refs `nœud::type` sont comparées à l'`objectTypeRef` stocké, comme l'UI.

Les liens sont toujours lus/écrits dans `links/links.yaml` du **repo ciblé** (`repoPath`),
jamais dans un composant.

### 4.2 Index périmé côté process MCP

Le process MCP n'a pas de `RepoWatcherService` : un objet créé dans l'app après la
construction de l'index MCP serait vu `OBJECT_NOT_FOUND`. Remède : si au moins un ID du lot
est introuvable, `reqIndex.invalidate(p)` + `testsIndex.invalidate(p)` sur tous les
`repoPaths`, reconstruction de la table, **un seul** nouvel essai. (Les campagnes sont
relues du disque à chaque `list`, pas de cache.) Coût d'un rebuild payé seulement en cas
de miss.

`container.ts` expose donc `reqIndex` et `testsIndex` (ajout à `McpContainer`).

## 5. Décisions et alternatives rejetées

- **Dupliquer `matchesRefs`** dans `link-validation.util.ts` plutôt que l'importer depuis
  `renderer/components/system/linkUtils.ts` : le main process n'importe pas le renderer
  (bundles séparés). Le déplacer dans `@polenta/types` serait plus propre mais touche le
  renderer — hors scope ; commentaire croisé dans les deux fichiers pour éviter la dérive.
- **Catégorie depuis le schéma** (`findObjectTypeDef`) : rejeté, échoue sur les types
  `'unresolvable'` des composants submodules (§4.1).
- **Invalider tout l'index avant chaque appel** plutôt que `reloadLinks` : rejeté, le
  rebuild parcourt l'historique git de tous les fichiers (T142) — coûteux pour un simple
  ajout de liens.
- **Normaliser le sens** du lien selon `sourceRefs` : rejeté (spec : sens conservé).
- **Validation dans `RequirementsIndexService.createLinks`** : rejeté, le service reste
  une couche de stockage (comme `createLink`) ; la validation est une garde de la surface
  MCP, comme pour `bulk_import_*` (SPEC-MCP-SERVER §7).
- **Tool unitaire `create_link`** : rejeté, le lot + `dryRun` est le modèle établi par
  `bulk_import_*` ; un lot d'une entrée couvre le cas unitaire.

## 6. Découpage

Un seul sprint : ~250 lignes de code neuf, aucun changement d'UI, aucune migration de
données.
