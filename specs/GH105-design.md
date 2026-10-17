# GH105 — Design : liens inter-repos (candidats, affichage des deux côtés, stockage côté source)

Spec : `specs/GH105.md`. Deux sprints : **S1 main** (agrégation, écriture côté source, IPC, MCP),
**S2 renderer** (vues, combobox, navigation, i18n, e2e, mise à jour SPEC).

## 1. État actuel (constats du code)

| Point | Code | Problème |
|---|---|---|
| Candidats | `SystemView.tsx` `candidateObjects` ← `api.requirements.list(repoPath)` + `api.tests.list(repoPath)` | repo sélectionné seulement |
| Liens affichés | `SystemView.tsx` / `SearchEditPane.tsx` / `TestPickerGrid.tsx` ← `api.requirements.linksAll(repoPath)` | `links.yaml` du repo sélectionné seulement |
| Types de lien | `SystemViewContext.tsx:353` `linkTypes = schema?.linkTypes` (schéma du repo sélectionné) | `hmi-PH2` n'a aucun type : ses objets n'affichent aucun lien, même agrégé |
| Écriture | `EditView` / `ExcelView` / `WordView` → `api.requirements.linkCreate(repoPath, …)` → `RequirementsIndexService.createLink(repoPath)` | écrit dans le repo sélectionné, pas côté source ; aucune validation (doublon) sur le chemin IPC |
| Suppression | `linkDelete(repoPath, linkId)` | ne trouve pas un lien stocké dans un autre repo |
| Couverture par exigence | `SystemView.tsx` `api.traceability.matrix(repoPath)` sans `workspaceDir` | liens des autres repos ignorés |
| Navigation | `navigateToObject` cherche le pair dans `candidateObjects` puis `navigateTo(node, type)` | ne change jamais de repo |
| MCP `create_links` | résout les objets sur le workspace mais écrit dans `container.repoPath` | à aligner (côté source) |

Déjà en place et réutilisés : `resolveWorkspaceRepoPaths` (`workspace-repos.util.ts`),
`buildObjectTable` (MCP), `validateLinkEntries` (`link-validation.util.ts`), union des types de lien
par nom dans `graph.service.ts:236`, sélection de repo `handleTargetChange(repoName, nodeId,
typeId)` (`SystemViewContext`, T72), `isRepoReadonly` = repo non racine en HEAD détaché
(`sync.status(repo).branch === ''`).

Les services du main (couverture, revalidation T172, matrice, graphe) ne relisent pas le type de lien
dans le schéma du repo qui stocke le lien : un lien d'un type défini ailleurs est déjà toléré.

## 2. Décisions techniques

### D1 — Un module d'agrégation dans le main : `workspace-links.service.ts`

```ts
interface WorkspaceObject {            // packages/types
  id: string; title: string; status: string
  objectTypeRef: string; category: 'requirement' | 'test'
  repoPath: string; repoName: string    // repoName = nom de montage (WorkspaceTree.nodes[].name)
}
interface WorkspaceLink extends ObjectLink { storedIn: string }   // repoPath du links.yaml

class WorkspaceLinksService {
  listObjects(rootRepoPath, workspaceDir?): Promise<WorkspaceObject[]>
  listLinks(rootRepoPath, workspaceDir?): Promise<WorkspaceLink[]>
  linkTypes(rootRepoPath, workspaceDir?): Promise<WorkspaceLinkType[]>  // D3
  createLink(rootRepoPath, data, workspaceDir?): Promise<WorkspaceLink>  // D4
  deleteLink(rootRepoPath, linkId, workspaceDir?): Promise<void>         // D5
}
```

- `repoPaths = resolveWorkspaceRepoPaths(workspaceTree, rootRepoPath, workspaceDir)` : sans
  `workspaceDir` (mono-repo, tests), comportement identique à aujourd'hui.
- Objets : `reqIndex.findAll` / `testsIndex.findAll` par repo (index existants, working tree :
  objets non commités inclus). Campagnes exclues (hors scope spec).
- Liens : `reqIndex.findAllLinks(p)` par repo, `storedIn = p` ; dédoublonnage par `id` (le premier
  repo de `repoPaths`, racine d'abord, l'emporte).
- `buildObjectTable` du MCP est déplacé dans ce service (`objectTable()`), le MCP l'importe.

**Rejeté** : agrégation dans le renderer par N requêtes `requirements:list` (une par repo) — N
allers-retours, invalidations dispersées, et le client web devrait connaître tous les chemins.

### D2 — Résolution des refs avec le repo (collision `root::`)

Chaque repo a un nœud `root`. Une ref d'un type de lien défini dans le repo `D` :

- `<nœud>::<type>` que **`D` déclare** lui-même → objets de `D` seulement ;
- sinon → objets des repos de `W` qui déclarent `<nœud>::<type>` (cas PH2 : `root::HMI_PH2_REQ`
  défini dans `handstickProduct`, déclaré par `hmi-PH2`) ;
- ref par catégorie (`requirement` / `test`, sans `::`) → objets de cette catégorie de tous les
  repos de `W` (comportement actuel étendu au workspace).

Implémenté dans `linkUtils.ts` (renderer) et `link-validation.util.ts` (main, règle dupliquée
comme aujourd'hui) : `matchesRefs(obj, refs, ctx)` avec
`ctx = { definingRepo: string, declaredBy: Map<string /*ref*/, Set<string /*repoPath*/>> }`. Les
appels existants sans `ctx` gardent la comparaison actuelle (compatibilité des tests).

L'écart avec `SPEC-ELECTRON-DESKTOP` §22.3 (« `<montage>::<type>` ») est documenté en S2 : les
objets et les refs écrites par l'onglet Liens utilisent le nom du nœud **dans le repo du type**
(`root` pour un repo composant).

### D3 — Types de lien du workspace

`linkTypes()` = union **par nom** des `linkTypes` des schémas de `W`, racine d'abord (même règle que
`graph.service.ts`) ; chaque entrée garde `definingRepo`. Un type de même nom dans deux repos : le
premier gagne, avertissement `console.warn` (pas d'erreur bloquante). Types invalides
(`isLinkTypeValid` faux) exclus comme aujourd'hui.

Le renderer utilise cette union dans **toutes** les vues (même quand le repo sélectionné est un
composant) : c'est ce qui permet à `HMI_PH2_REQ-0001` d'afficher `implements`.

### D4 — Création côté source

`createLink(root, { type, sourceId, targetId }, workspaceDir)` :

1. Table d'objets (D1) ; `source` / `target` introuvables → reconstruit une fois (comme MCP), sinon
   `OBJECT_NOT_FOUND`.
2. `validateLinkEntries(workspaceLinkTypes, [dto], resolve, existingOfStorage)` : type absent,
   auto-lien, incompatibilité de refs (D2), doublon dans **le repo de stockage**.
3. Sens : le renderer passe déjà `sourceId` = objet côté `sourceRefs` (`canBeSource` /
   `canBeTarget` dans les trois vues). Le main ne réoriente pas : il vérifie le sens avec D2 (si
   seul le sens inverse est valide, `LINK_TYPE_INCOMPATIBLE` — les vues n'envoient jamais ce cas).
4. Repo de stockage `S = repoPath de source`. `S` en lecture seule → erreur `READONLY_REPO`
   (message nommant le repo par son label). Lecture seule = repo non racine en HEAD détaché
   (`SyncService.status(S).branch === ''`, même règle que `isRepoReadonly`) ou nœud `readonly`.
5. Écriture `reqIndex.createLink(S, …)` — inchangée, sérialisée (`serialize-writes.util.ts`).

Erreurs typées `{ code, message }` (codes de `LinkErrorCode` + `READONLY_REPO`), traduites côté
renderer.

### D5 — Suppression

`deleteLink(root, linkId, workspaceDir)` : cherche `linkId` dans `listLinks()`, refuse
`READONLY_REPO` si `storedIn` est en lecture seule, sinon `reqIndex.deleteLink(storedIn, linkId)`.
`LINK_NOT_FOUND` si absent.

### D6 — IPC et client

| Channel | Args | Note |
|---|---|---|
| `workspace:objects` (nouveau) | `rootRepoPath, workspaceDir?` | D1 |
| `workspace:links` (nouveau) | `rootRepoPath, workspaceDir?` | D1 |
| `workspace:link-types` (nouveau) | `rootRepoPath, workspaceDir?` | D3 |
| `requirements:link-create` | `repoPath, data, workspaceDir?` | 3e arg ajouté ; sans lui, comportement actuel |
| `requirements:link-delete` | `repoPath, linkId, workspaceDir?` | idem |

- `api-client` : `api.workspace.{objects, links, linkTypes}`, `linkCreate` / `linkDelete` avec
  `workspaceDir` optionnel.
- `GRAPH_WRITE_CHANNELS` : inchangé (mêmes channels d'écriture). L'invalidation du graphe doit
  viser le repo **de stockage** : le wrapper passe `repoPath` racine → vérifier qu'il invalide le
  graphe du workspace (sinon invalider `S` en plus, dans le service).
- Client web : `channel-policy.ts` — les 3 nouveaux channels dans `WEB_EXPOSED`, `ROOT_ARGS`
  `[0, 1]` (repoPath + workspaceDir gardés), `link-create` / `link-delete` passent à `[0, 2]`.

### D7 — MCP

`create_links` / `delete_links` passent par `WorkspaceLinksService` (écriture côté source, refus
lecture seule) ; `list_links` liste les liens agrégés avec `storedIn`. Description des tools et
`AGENTS.md` (template) mis à jour : « un lien est écrit dans le repo de sa source ».

### D8 — Renderer (S2)

- `SystemViewContext` : expose `workspaceDir` (`decodeProjectId(currentProjectId)`) et
  `linkTypes` = `useQuery(['workspace-link-types', workspaceDir], …)` (D3) à la place du schéma du
  repo sélectionné ; `repoLabelByPath` (depuis `flatNodes`) pour le libellé des candidats.
- `SystemView` : `candidateObjects` ← `['workspace-objects', workspaceDir]`, `allLinks` ←
  `['workspace-links', workspaceDir]` ; `Candidate` gagne `repoPath`, `repoLabel`, `status`.
  Invalidation des deux clés : création / suppression de lien, création d'objet (requirements,
  tests), événements du watcher de repo et reconstruction de l'arbre du workspace (ajout de
  composant).
- `LinkCombobox` : libellé secondaire `repoLabel` (comme `groupLabel`) ; candidats d'un repo en
  lecture seule exclus côté **source** (D4.4 — filtrage préventif, le main reste la garde).
- Liste des liens d'un objet (Édition, colonnes `link::` Excel, Word, `SearchEditPane`) : pair
  résolu par la table d'objets du workspace (titre, statut) ; pair absent → ID + badge
  « introuvable » ; lien d'un repo en lecture seule → bouton supprimer désactivé, infobulle
  « Lien stocké dans <repo> (lecture seule) ».
- Appels `linkCreate` / `linkDelete` : + `workspaceDir` ; erreurs typées → toast traduit.
- `navigateToObject` : pair d'un autre repo → `handleTargetChange(repoName, node, type)` puis
  ouverture de l'objet ; `backHistory` mémorise `repoName` ; nouvel onglet : `/req/<id>` ou
  `/test/<id>` avec `repoPath` du pair.
- Couverture : `api.traceability.matrix(repoPath, {}, workspaceDir)`.
- `TestPickerGrid` (campagnes) : inchangé (liens du repo de la campagne, hors scope).
- i18n `fr.json` / `en.json` : `links.notFound`, `links.readonlyStorage`, erreurs `READONLY_REPO`,
  `DUPLICATE_LINK`, `LINK_TYPE_INCOMPATIBLE`, `OBJECT_NOT_FOUND`.

## 3. Fichiers

**S1 (main)**
- `packages/types/src/` : `WorkspaceObject`, `WorkspaceLink`, `WorkspaceLinkType`.
- `apps/desktop/src/main/services/workspace-links.service.ts` (nouveau) + `.test.ts`.
- `apps/desktop/src/main/services/link-validation.util.ts` : `matchesRefs` avec contexte (D2), code
  `READONLY_REPO`.
- `apps/desktop/src/main/ipc/index.ts` : 3 channels, args `workspaceDir` de `link-create/delete`,
  container.
- `apps/desktop/src/main/container` (DI) et `mcp-server/container.ts` : instance du service.
- `apps/desktop/src/mcp-server/tools/links.tools.ts` : D7.
- `apps/desktop/src/main/services/agents-md.template.ts` : phrase sur le stockage côté source.
- `apps/desktop/src/web-server/channel-policy.ts` : D6.
- `packages/api-client/src/{types,ipc-client}.ts` (+ client web s'il a son propre mapping).

**S2 (renderer)**
- `renderer/contexts/SystemViewContext.tsx`, `renderer/components/system/{SystemView,EditView,ExcelView,WordView,LinkCombobox,linkUtils}.tsx|ts`,
  `renderer/components/search/SearchEditPane.tsx`, `renderer/i18n/locales/{fr,en}.json`.
- `apps/desktop/e2e-web/gh105-cross-repo-links.spec.ts` (nouveau) + fixture workspace 2 repos.
- SPEC (dernier sprint) : `SPEC-REQ-requirements.md` §5, `SPEC-SYSTEM-VIEW.md`,
  `SPEC-ELECTRON-DESKTOP.md` §22.3, `SPEC-MCP-SERVER.md` (liens), `SPEC-WEB.md` (channels),
  `SPEC-INDEX.md` (colonne MAJ).

## 4. Découpage

| Sprint | Périmètre | Vérification |
|---|---|---|
| S1 | D1–D7 : service, résolution des refs, IPC, api-client, channel-policy, MCP, AGENTS.md | tests unitaires `workspace-links.service.test.ts`, `link-validation.util.test.ts`, `links.tools` ; `pnpm test` ; typecheck |
| S2 | D8 + i18n + e2e web + mises à jour SPEC | `pnpm test`, `pnpm --filter @polenta/desktop test:e2e:web`, test manuel PH2 (M1–M3 de `GH105-tests.md`) |

S1 seul ne change rien de visible : l'UI garde ses appels sans `workspaceDir` (compatibles).

## 5. Risques

- **Coût de l'agrégation** : `findAll` sur chaque repo à chaque invalidation. Les index sont en
  cache par repo (reconstruits sur événement watcher) ; la liste agrégée est mise en cache par
  React Query. Acceptable pour PH2 (8 repos, ~300 objets) ; mesurer en S2.
- **Unicité des IDs** : garantie par l'unicité des préfixes (règle 10). Si deux repos ont le même
  ID, la table garde le premier (racine d'abord) et `console.warn` — pas de clé `repo + id`
  (rejeté : changerait le format de `links.yaml`).
- **Graphe** : l'invalidation après écriture dans un repo composant doit être vérifiée (D6).
