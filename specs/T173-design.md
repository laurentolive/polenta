# T173 — Design : levée du flag `needsRevalidation` depuis l'analyse d'impact

Réf. : `specs/T173.md`.

## 1. Vue d'ensemble

- **Main** : deux méthodes ajoutées à `RevalidationService` (symétriques de `markImpactedBy`) :
  `listFlagged` (éléments marqués du workspace + leurs éléments liés) et `clear` (retire la clé).
  Deux canaux IPC `revalidation:list` / `revalidation:clear`, exposés dans `api.revalidation`.
- **Renderer** : un hook `useFlaggedElements` (query unique, workspace, enracinée sur le repo
  racine) sert à la fois l'état ⚠ live des nœuds d'analyse et la liste de repli. Un hook
  `useClearRevalidation` (mutation + invalidations). Sélection multi partagée via un petit état
  dans la page.
- **Liste de repli** : nouvelle valeur sentinelle `REVALIDATION_IMPACT_ID` dans
  `ImpactAnalysisContext`, entrée dans `VersionImpactSelector`, composant
  `RevalidationList` rendu par `/impact-analysis`.

Aucun changement de format de fichier, aucun changement de T172 (marquage), aucun changement
de `getMissingLinks` (reste la source de la matrice « liens manquants »).

## 2. Découpage

Deux sprints :

| Sprint | Contenu | Livrable testable |
|--------|---------|-------------------|
| 1 | Types, `RevalidationService.listFlagged/clear`, IPC, api-client, hooks renderer, ⚠ + « Lever le flag » + multi-sélection dans les arbres (baseline et locale), invalidations | CA1–CA4, CA6–CA8 |
| 2 | Entrée « Impact à vérifier (N) », `RevalidationList` (dépliage éléments liés, multi-sélection), i18n complète, mises à jour SPEC | CA5, CA9, CA10 |

## 3. Fichiers à modifier

### 3.1 Types — `packages/types/src/traceability.ts`

```ts
/** T173 — élément lié à un élément marqué (aide à identifier le déclencheur). */
export interface FlaggedLinkedElement {
  elementId: string
  elementType: 'requirement' | 'test_case'
  title: string
  status: string
  version: number
  linkType: string
  /** Statut courant `isApproval` dans son type ; false si type introuvable. */
  approved: boolean
  repo?: ElementRepoRef          // absent = repo racine
}

/** T173 — élément marqué `needsRevalidation`, vu depuis tout le workspace. */
export interface FlaggedElement {
  elementId: string
  elementType: 'requirement' | 'test_case'
  title: string
  status: string
  version: number
  repo?: ElementRepoRef
  linked: FlaggedLinkedElement[] // tous liens, sens indifférent, un niveau ; tri par id
}

export type ClearRevalidationFailure = 'not_found' | 'readonly' | 'error'

export interface ClearRevalidationResult {
  cleared: string[]              // ids dont la clé a été retirée
  unchanged: string[]            // ids déjà non marqués (idempotence, pas une erreur)
  failed: Array<{ id: string; reason: ClearRevalidationFailure; message?: string }>
}
```

`ElementRepoRef` est importé de `impact-analysis.ts` (déjà exporté).

### 3.2 `apps/desktop/src/main/services/revalidation.service.ts`

Mettre à jour le commentaire de classe (« la levée n'est pas exposée ici » → exposée, T173).

**`listFlagged(repoPath, workspaceDir?): Promise<FlaggedElement[]>`**
1. `repoPaths = resolveWorkspaceRepoPaths(...)` ; `rootRepoPath = repoPaths[0]` (même convention
   que l'analyse locale — à vérifier dans `resolveWorkspaceRepoPaths`, sinon passer le repo
   racine explicitement depuis le renderer).
2. Charger en parallèle exigences, tests et liens de chaque repo (`reqIndex.findAll`,
   `testsIndex.findAll`, `reqIndex.findAllLinks`). Construire `byId: Map<id, {el, category,
   repoPath}>` — doublon d'id : le premier repo (racine) gagne, comme l'analyse locale.
3. Éléments marqués = `needsRevalidation` vrai. Pour chacun, `linked` = pairs via les liens
   (sens indifférent, dédupliqués par id ; si plusieurs liens, garder le premier `linkType`),
   pairs introuvables ignorés.
4. `approved` : `findObjectTypeDef(schemaDuRepo, objectTypeRef)` → `statuses[].isApproval` du
   statut courant. Schémas lus une fois par repo (cache local à l'appel).
5. `repo` : `undefined` si repo racine, sinon `{ path, name }` — nom via
   `workspaceTree.readCache(workspaceDir)` (nœud dont `repoPath` correspond), repli
   `path.basename`. Mettre la résolution de nom dans un helper partagé si
   `traceability.service` en a déjà un équivalent (`repoNames` du snapshot local) — sinon
   dupliquer les 5 lignes, ne pas refactorer T175.
6. Tri : exigences puis tests, puis id.

**`clear(repoPath, elementIds: string[], workspaceDir?): Promise<ClearRevalidationResult>`**
- Dédupliquer `elementIds`. Construire le même `MarkContext` que `markImpactedBy` (repos,
  schéma ouvert, `readonlyRepoPaths`) — extraire sa construction dans un helper privé
  `buildContext(repoPath, workspaceDir)` utilisé par les deux méthodes.
- Par id, séquentiellement (best-effort, `try/catch` → `failed: error`) :
  - trouver le repo (`reqIndex.findById` puis `testsIndex.findById` sur chaque repo) ; absent →
    `not_found` ;
  - repo dans `readonlyRepoPaths`, ou élément du repo ouvert dont le nœud est `readonly`
    (`isRefInReadonlyNode`) → `readonly` ;
  - sous `withKeyLock(\`${p}::${dir}/${id}\`)` : relire, si `!existing.needsRevalidation` →
    `unchanged` ; sinon `const { needsRevalidation: _, ...rest } = existing`, écrire
    `omitAuditFields(rest)` dans `resolveComponentRepoPath(...) ?? p`, `upsert` dans l'index
    avec `rest` → `cleared`.
- **Pas** de filtre sur le statut terminal (contrairement au marquage) : lever un flag reste
  permis sur un élément devenu `obsolete` après marquage.
- Factoriser la recherche d'élément (`markOne`) en `locate(id, repoPaths)` renvoyant
  `{ p, category } | null`, réutilisé par `markOne` et `clear`.

Vérifier que `reqIndex.upsert` / `testsIndex.upsertTestCase` **remplacent** l'objet (et ne le
fusionnent pas) — sinon le flag survivrait dans l'index.

### 3.3 IPC — `apps/desktop/src/main/ipc/index.ts`

Nouvelle section « Revalidation (T173) » :
```ts
ipcMain.handle('revalidation:list', (_e, repoPath: string, workspaceDir?: string) =>
  c.revalidation.listFlagged(repoPath, workspaceDir))
ipcMain.handle('revalidation:clear', (_e, repoPath: string, ids: unknown, workspaceDir?: string) =>
  c.revalidation.clear(repoPath, z.array(z.string()).parse(ids), workspaceDir))
```
Exposer `revalidation` dans l'objet retourné par `container.ts` (il ne l'est pas aujourd'hui : seulement injecté dans les services). Suivre
la convention de validation des autres handlers (zod-schemas si c'est l'usage, sinon cast).

### 3.4 API client — `packages/api-client/src/types.ts`, `ipc-client.ts`

```ts
revalidation: {
  /** T173 — éléments marqués `needsRevalidation` du workspace, avec leurs éléments liés. */
  list(repoPath: string, workspaceDir?: string): Promise<FlaggedElement[]>
  /** T173 — lève le flag (retire la clé du YAML) ; best-effort par élément. */
  clear(repoPath: string, ids: string[], workspaceDir?: string): Promise<ClearRevalidationResult>
}
```

### 3.5 Renderer — hooks

**`renderer/hooks/useFlaggedElements.ts`** (calqué sur `useLocalImpactAnalysis`) :
- `queryKey: ['revalidation:flagged', rootRepoPath, workspaceDir]`, `refetchOnWindowFocus: true`.
- Renvoie aussi `flaggedIds: Set<string>` (mémoïsé).

**`renderer/hooks/useClearRevalidation.ts`** : `useMutation` sur `api.revalidation.clear(rootRepoPath, ids, workspaceDir)` ;
`onSettled` → invalidations (§3.8) ; `onSuccess` → si `failed.length`, bandeau d'erreur (fermable) en tête de la page Analyse d'impact listant
`id (motif)` (l'app n'a pas de système de toast : bandeau local à la page, état porté par la page — pas de
nouveau système de notification global).

**`useLiveFileSync.ts`** : ajouter `['revalidation:flagged']` aux invalidations du bloc T175
(même condition : `requirements/`, `tests/`, `links/` ou `'*'`).

### 3.6 Renderer — arbres d'analyse (`routes/impact-analysis.tsx`)

- `ImpactAnalysisPage` appelle `useFlaggedElements` et `useClearRevalidation`, et possède
  `selected: Set<string>` (ids), vidé au changement de `activeAnalysisId` (même `useEffect` que
  `campaignDraft`). Après une levée, retirer de `selected` les ids levés.
- Passer via props à `ChangedRequirementRow` → `ImpactTreeView` → `ImpactTreeNodeRow` un objet
  `revalidation: { flaggedIds, selected, toggle(id), clear(ids) , pending }` (un seul prop pour
  ne pas alourdir les signatures ; ou un petit contexte React local à la page si le prop drilling
  devient gênant — au choix du dev, contexte préféré).
- `ImpactTreeNodeRow` : si `flaggedIds.has(node.elementId)` :
  - case à cocher avant le badge EX/TC (`checked = selected.has(id)`) ;
  - `<RevalidationFlag show />` après l'id ;
  - bouton `btn-secondary-sm` « Lever le flag » avant `ImpactNodeStatusEditor` (ou en fin de
    ligne en analyse locale), `disabled` pendant `pending`, `onClick` → `clear([id])` sans
    confirmation.
  - Rendu pour les deux modes (`readOnly` local compris) : le `readOnly` T175 ne concerne que le
    statut d'impact.
- Actions de la `ViewHeader` : si `selected.size > 0`, bouton « Lever le flag de la sélection
  (N) » → confirmation (`window.confirm` n'est pas utilisé dans l'app : réutiliser le motif de
  modale de `VersionImpactSelector` deleteConfirm ou un `ConfirmDialog` existant) → `clear([...selected])`.
- Si l'analyse active a au moins un nœud marqué, afficher en sous-titre/compteur « N impacts à
  vérifier » (optionnel, nice-to-have — ne pas bloquer le sprint).
- L'`ImpactNodeStatusEditor` et `updateStatusMutation` ne sont pas touchés (CA8).
- `ChangedRequirementRow` (l'élément changé lui-même) : pas de case ni de bouton — l'élément
  modifié n'est normalement pas marqué ; s'il l'est (ex. T171 `includeSelf`), afficher seulement
  l'icône ⚠. Décision : pas de levée sur la ligne d'élément changé, il reste dans la liste de repli.

Export XLSX/PDF de l'analyse : inchangé (le flag live n'est pas exporté).

### 3.7 Renderer — liste de repli (sprint 2)

- `ImpactAnalysisContext.tsx` : `export const REVALIDATION_IMPACT_ID = '__revalidation__'`.
- `VersionImpactSelector.tsx` : via `useFlaggedElements`, entrée « Impact à vérifier (N) » au-dessus
  de « Modifications locales » quand N > 0, même style que l'entrée locale, toggle
  `setActiveAnalysisId(REVALIDATION_IMPACT_ID | null)`. **Pas** d'auto-sélection. Si l'entrée est
  active et N devient 0 → `setActiveAnalysisId(null)` (même motif que l'entrée locale).
- `routes/impact-analysis.tsx` : `isRevalidation = activeAnalysisId === REVALIDATION_IMPACT_ID` ;
  titre « Impact à vérifier », action Rafraîchir (refetch), contenu = `<RevalidationList>` ;
  désactiver la query `impact-analysis:get` dans ce cas (comme `isLocal`).
- **`components/impact/RevalidationList.tsx`** :
  - en-tête : « Tout sélectionner » + bouton « Lever le flag de la sélection (N) » (même
    confirmation que §3.6) ;
  - une ligne par `FlaggedElement` : chevron, case, badge EX/TC, id cliquable (ouvre
    `RequirementEditModal`/`TestCaseEditModal` dans `repo?.path ?? rootRepoPath`), titre, statut,
    `RepoBadge`, bouton « Lever le flag » ;
  - dépliée (repliée par défaut) : sous-lignes `linked` — badge, id cliquable, titre, statut,
    `v{version}`, `linkType`, `RepoBadge` ; `approved === false` → statut en
    `text-status-warning` + libellé « non approuvé » (candidat déclencheur) ;
  - état vide : ne devrait pas s'afficher (entrée masquée), message générique par sécurité.
- Extraire `RepoBadge` de `impact-analysis.tsx` vers `components/impact/RepoBadge.tsx` pour le
  réutiliser.

### 3.8 Invalidations après levée

Clés invalidées (`useClearRevalidation.onSettled`), par préfixe pour couvrir tous les repos :
`['revalidation:flagged']`, `['objects']`, `['object']`, `['requirement']`, `['test']`,
`['requirements-all']`, `['tests-all']`, `['traceability-matrix']`, `['impact-analysis:local']`,
plus les clés de maturité/couverture si elles sont distinctes (à relever dans `SystemView` /
`ExcelView` — même liste que `invalidateImpactedObjects` de T172, étendue à tous les repos).
Le watcher (`repo:file-changed`) couvre aussi ces fichiers, avec 300 ms de latence ;
l'invalidation explicite évite l'attente.

### 3.9 i18n — `fr.json` / `en.json`

Sous `impactAnalysisPage.revalidation` : `clear` (« Lever le flag »), `clearSelection`
(« Lever le flag de la sélection ({{count}}) »), `confirmTitle`, `confirmBody`
(« Lever le flag de {{count}} éléments ? »), `failed` (« Flag non levé : {{ids}} »),
`reason.not_found|readonly|error`, `listTitle` (« Impact à vérifier »), `selectAll`,
`linked` (« Éléments liés »), `notApproved` (« non approuvé »), `empty`.
Sous `sidebar.version` : `revalidationEntry` (« Impact à vérifier »), `revalidationCount`.

## 4. Décisions techniques et alternatives rejetées

- **Nouveau service/IPC plutôt que `getMissingLinks.revalidationItems`** : il faut le repo et
  les éléments liés ; élargir `getMissingLinks` alourdirait un appel utilisé par la matrice.
  `revalidationItems` reste tel quel.
- **Une seule query pour les arbres et la liste de repli** : le coût de `linked` est un parcours
  des liens déjà en mémoire (index) ; évite deux sources de vérité sur « est marqué ».
- **Clé de query enracinée sur le repo racine, pas le repo sélectionné** : le flag est un état
  workspace (même choix que T175).
- **Identification par id seul** dans les arbres : les ids sont uniques sur le projet (préfixes
  uniques, CLAUDE.md règle 10) ; le service retrouve le repo.
- **Pas de filtre terminal à la levée** : l'exclusion terminale du marquage vise à ne pas créer
  de bruit ; lever un flag existant n'en crée pas.
- **Levée non proposée sur la ligne « élément changé »** : cas rare (T171 `includeSelf`), traité
  par la liste de repli ; évite d'ajouter des contrôles à une ligne déjà dense.
- Rejeté : écrire `needsRevalidation: false` (contredit T172 CA8) ; enregistrer un
  acquittement (hors scope, décision Spec) ; lever automatiquement quand le statut d'impact passe
  à « clos » (couplage refusé, CA8).

## 5. Impacts

- Aucun changement de format YAML, aucune migration.
- `RevalidationService` : refactor léger (`buildContext`, `locate`) — `markImpactedBy` doit
  rester strictement équivalent (re-jouer les scénarios T172 S concernés).
- Sécurité des écritures concurrentes : même verrou par fichier que `update`/`openDraft`.
  `RequirementsService.update` et `TestsService.update` ne fusionnent que `title`/`fields`
  (vérifié pour les exigences) sur `...existing` : un autosave ne réintroduit pas un flag levé,
  à condition que `existing` soit relu dans le verrou (c'est le cas).

## 6. Mises à jour SPEC prévues (sprint 2)

- `SPEC-TRACEABILITY.md` §3.3 : levée depuis l'analyse d'impact (renvoi §4.8) ; nouvelle §4.8
  « Levée du flag `needsRevalidation` (T173) » : dans les arbres §4.6/§4.7, liste de repli,
  règle d'écriture, pas de trace hors git.
- `SPEC-REQ-requirements.md` §5.3 : « levé par l'analyse d'impact (T173) » → description
  effective + renvoi §4.8.
- `SPEC-AUDIT.md` §3 : note « levée implémentée (T173) ».
- `SPEC-INDEX.md` : ligne SPEC-TRACEABILITY §3+ — mots-clés `lever, levée, flag, impact à
  vérifier`, ticket T173.
- `agents-md.template.ts` : « le flag se lève depuis la vue Analyse d'impact (bouton Lever le
  flag), jamais à la main dans le YAML ».
- `CLAUDE.md` règle 6 : inchangée (reste vraie).
