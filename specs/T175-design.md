# T175 — Design : analyse d'impact des modifications locales (vs HEAD)

Réf. : `specs/T175.md`. Travail sur `main`. **Un seul sprint.**

## 1. Vue d'ensemble

```
Renderer                                         Main
─────────────────────────────────────────────    ─────────────────────────────────────────────
useLocalImpactAnalysis()  ──(poll 5 s)──────▶    impact-analysis:local (rootRepoPath, workspaceDir)
  ├─ VersionImpactSelector : entrée en tête         TraceabilityService.computeLocalImpactAnalysis
  │  + sélection auto (ImpactAnalysisContext)         ├─ resolveWorkspaceRepoPaths
  └─ /impact-analysis : rendu lecture seule            ├─ par repo : SyncService.workdirChangesVsHead
                                                       │    → diff élément par élément (HEAD vs disque)
                                                       └─ si ≥ 1 changement : snapshot working tree
                                                            multi-repo → buildImpactTreesFromSnapshot
```

Aucune écriture disque ; un seul appel IPC renvoie l'analyse complète (ou une liste vide).

## 2. Fichiers à modifier

### 2.1 Types — `packages/types/src/impact-analysis.ts`

Réutiliser `ChangedRequirement` / `ImpactNode` (même rendu dans la page) avec des champs **optionnels**
(rétro-compatibles avec les fichiers `impact-analyses/*.yaml` existants, qui ne les ont pas) :

```ts
/** Repo d'appartenance d'un élément quand il n'est pas le repo racine de l'analyse (T175). */
export interface ElementRepoRef {
  path: string   // repoPath absolu — pour ouvrir le popup et requêter l'élément
  name: string   // label du nœud workspace (WorkspaceTreeNode.label ?? name) — affichage
}

export interface ImpactNode {
  // … inchangé …
  repo?: ElementRepoRef          // T175 — absent = repo racine
}

export interface ChangedRequirement {
  // … inchangé …
  elementType?: 'requirement' | 'test_case'   // T175 — absent = 'requirement' (analyses T46)
  repo?: ElementRepoRef                        // T175 — absent = repo racine
}

/** Analyse live des modifications locales (T175) — jamais persistée, pas de statuts. */
export interface LocalImpactAnalysis {
  rootRepoPath: string
  computedAt: string                          // ISO — affiché en sous-titre
  heads: { repoPath: string; sha: string }[]  // HEAD de chaque repo au moment du calcul
  changedRequirements: ChangedRequirement[]   // exigences ET tests (elementType), triés repo puis id
}
```

Le nom `changedRequirements` est conservé (pas `changedElements`) pour que `ChangedRequirementRow`
et `flattenAnalysis` s'appliquent tels quels aux deux types d'analyse — alternative rejetée : type
parallèle `ChangedElement` + duplication du rendu.

### 2.2 `apps/desktop/src/main/services/sync.service.ts`

Nouvelle méthode :

```ts
/** T175 — fichiers dont le working tree diffère de HEAD (staged/unstaged/non suivis confondus),
 *  limités aux préfixes donnés. statusMatrix : head 0|1, workdir 0 absent / 1 = HEAD / 2 ≠ HEAD. */
async workdirChangesVsHead(repoPath: string, prefixes: string[]):
  Promise<{ path: string; change: 'added' | 'removed' | 'modified' }[]>
```

- `git.statusMatrix({ fs, dir, filepaths: prefixes })` — filtre sur `requirements`, `tests`, `links`.
- `head=0, workdir=2` → added ; `head=1, workdir=0` → removed ; `head=1, workdir=2` → modified ;
  le reste ignoré (le stage n'a pas d'importance : on compare disque vs HEAD).
- Repo sans commit (`HEAD` non résolu) → tableau vide (pas d'erreur) ; `filepaths` inexistant → vide.

### 2.3 `apps/desktop/src/main/services/traceability.service.ts`

1. **Généraliser le diff par champ** : `diffRequirementFields` → `diffElementFields(a, b)` typé
   `{ status; title; fields? }` (corps inchangé) ; appelé pour exigences et tests. `steps` étant dans
   `fields`, il ressort comme un seul champ `fields.steps`. *(Sprint 1 : faux — `steps`, `preconditions`, `equipment`, `postconditions` sont à la racine du YAML d'un test ; comparés en plus, champ `steps` etc. Cf. `T175-sprint1.md`.)*

2. **`ImpactSnapshot` enrichi** : `requirements` / `tests` deviennent
   `Map<string, { title: string; repoPath: string }>`. `loadSnapshotAtRef` (T46, mono-repo) renseigne
   `repoPath` = repo de l'analyse. Nouveau :

   ```ts
   /** T175 — état courant sur disque de tous les repos (exigences, tests, links.yaml concaténés). */
   private async loadWorkingTreeSnapshot(repoPaths: string[]): Promise<ImpactSnapshot>
   ```
   via `git.listFiles` + `git.readYaml` (lecture disque, pas l'index vivant : l'index peut ne pas
   refléter une édition faite hors de l'app). Ids uniques sur le workspace (préfixes uniques,
   CLAUDE.md règle 10) → maps plates ; en cas de doublon, le repo racine gagne.

3. **`buildImpactTreesFromSnapshot(snapshot, rootId, rootType)`** :
   - `rootType === 'requirement'` : comportement T46 inchangé.
   - `rootType === 'test_case'` : `descendantTree = []` ; `ascendantTree` = exigences reliées au
     test **dans un sens ou dans l'autre**, puis leurs ascendants (`buildReqNode(…, 'ascendant')`).
   - **Liens de couverture bidirectionnels** : `testLeavesFor` accepte le test en `sourceId` **ou**
     en `targetId` (cf. CLAUDE.md « Sens d'un lien de couverture » / `matchCoverageLink`).
     Aujourd'hui seul `sourceId = test` est suivi : un test lié depuis l'éditeur de l'exigence
     n'apparaît pas dans les arbres. Corrigé dans la fonction partagée → bénéficie aussi aux
     **nouvelles** analyses T46 (les analyses déjà persistées ne sont pas recalculées). Symétriquement,
     le parcours d'exigences ignore déjà tout id qui n'est pas une exigence du snapshot, donc un lien
     test→exigence n'est jamais pris pour un lien parent/enfant.
   - `makeNode` pose `repo` quand `snapshot.*.get(id).repoPath !== rootRepoPath`.

4. **Nouvelle méthode publique** :

   ```ts
   async computeLocalImpactAnalysis(rootRepoPath: string, workspaceDir?: string): Promise<LocalImpactAnalysis>
   ```
   - `repoPaths = resolveRepoPaths(rootRepoPath, workspaceDir)` ; noms de repo depuis
     `workspaceTree.readCache(workspaceDir)` (map `repoPath → label ?? name`).
   - Par repo (en parallèle) : `heads` (`git.resolveRef HEAD`, via `SyncService`), puis
     `workdirChangesVsHead(repo, ['requirements', 'tests'])` filtré sur `*.yaml` ; pour chaque
     fichier : `readYamlRef(repo, headSha, path)` vs `readYaml(repo, path)` →
     added / removed / modified (modified retenu seulement si `diffElementFields` non vide) ;
     `elementType` d'après le préfixe du chemin.
   - Aucun changement → `changedRequirements: []` **sans charger le snapshot** (cas courant du
     polling, coût = un `statusMatrix` restreint par repo).
   - Sinon snapshot working tree + arbres (removed → pas d'arbre, comme T46). Tri : repo racine
     d'abord, puis nom de repo, puis id.

### 2.4 IPC / API client

- `apps/desktop/src/main/ipc/index.ts` :
  `ipcMain.handle('impact-analysis:local', (_e, repoPath, workspaceDir?) => c.traceability.computeLocalImpactAnalysis(repoPath, workspaceDir))`
- `packages/api-client/src/types.ts` : `impactAnalysis.local(repoPath: string, workspaceDir?: string): Promise<LocalImpactAnalysis>`
- `packages/api-client/src/ipc-client.ts` : `local: (p, w) => invoke('impact-analysis:local', p, w)`
- Vérifier s'il existe un autre client (HTTP / mcp-server container) implémentant l'interface → y
  ajouter la méthode (ou un `throw` « non supporté ») pour garder `tsc` propre.

### 2.5 Renderer

**`contexts/ImpactAnalysisContext.tsx`** : exporter `LOCAL_IMPACT_ANALYSIS_ID = '__local__'`
(sentinelle dans `activeAnalysisId`, pas de nouvel état — alternative rejetée : un second booléen
`isLocalActive` à synchroniser avec l'id).

**Nouveau hook `renderer/hooks/useLocalImpactAnalysis.ts`** :
```ts
useQuery({
  queryKey: ['impact-analysis:local', rootRepoPath, workspaceDir],
  queryFn: () => api.impactAnalysis.local(rootRepoPath, workspaceDir || undefined),
  enabled: !!rootRepoPath,
  refetchInterval: 5000,
  refetchOnWindowFocus: true,
})
```
`rootRepoPath` depuis `useSelectedRepo().rootRepoPath` (l'analyse locale couvre toujours tout le
workspace, indépendamment du repo sélectionné) ; `workspaceDir = decodeProjectId(projectId)`.
Partagé par le panneau et la page : react-query déduplique (une seule requête). Le partage de
structure par défaut de react-query évite les re-rendus quand le résultat est identique ;
`computedAt` change à chaque calcul → l'exclure du rendu conditionnel ou n'afficher que l'heure.

**`components/sidebar/version/VersionImpactSelector.tsx`** (reçoit déjà `projectId`) :
- Entrée « Modifications locales (vs HEAD) » en tête de la liste « Analyses existantes » si
  `local.changedRequirements.length > 0` : icône `FilePen` (lucide), libellé italique, compteur
  d'éléments, pas de date ni de corbeille ; surlignée comme une analyse active.
- Liste vide + entrée locale présente → ne pas afficher « Aucune analyse ».
- Sélection auto : `useRef` `autoSelectedRef` ; `useEffect` — si `!autoSelectedRef.current`,
  `activeAnalysisId === null` et changements > 0 → `setActiveAnalysisId(LOCAL)` puis ref = true.
  Une seule fois par montage du panneau (= ouverture de la vue) : un clic qui désélectionne l'entrée
  n'est pas annulé au polling suivant (CA2).
- Si `activeAnalysisId === LOCAL` et changements retombent à 0 → `setActiveAnalysisId(null)` (U11).
- Clic sur l'entrée : bascule comme `openAnalysis` (sélection / désélection).

**`routes/impact-analysis.tsx`** :
- `isLocal = activeAnalysisId === LOCAL_IMPACT_ANALYSIS_ID` ; la query `impact-analysis:get` est
  désactivée si `isLocal` ; `displayed = isLocal ? local : activeAnalysis`.
- En-tête : titre `impactAnalysisPage.localTitle`, sous-titre `localComputedAt` (heure), actions :
  bouton Rafraîchir (`RefreshCw`, `refetch()`) ; **pas** d'export, compteur ouvert/clos ni bouton
  campagne.
- Prop `readOnly` propagée `ChangedRequirementRow → ImpactTreeView → ImpactTreeNodeRow` : masque
  `ImpactNodeStatusEditor`.
- `ChangedRequirementRow` : badge `EX`/`TC` selon `changed.elementType ?? 'requirement'` ; ouverture
  → `setQuickEdit({ type, id, repoPath })` ; libellé de repo (`changed.repo?.name`) en petit badge.
- `ImpactTreeNodeRow` : même badge repo pour `node.repo`, et `repoPath` d'ouverture / de tooltip =
  `node.repo?.path ?? repoPath`.
- `quickEdit` gagne un champ `repoPath` passé aux modales (au lieu du `repoPath` de la page) — sans
  effet pour T46 (même valeur).
- Clé React de `ChangedRequirementRow` : `${elementType}-${reqId}`.
- Message vide / d'invite inchangés.

**i18n** (`locales/fr.json`, `en.json`) :
`sidebar.version.localChanges` (« Modifications locales (vs HEAD) »),
`sidebar.version.localChangesCount` (« {{count}} élément(s) modifié(s) »),
`impactAnalysisPage.localTitle`, `impactAnalysisPage.localComputedAt` (« Calculée à {{time}} »),
`impactAnalysisPage.refresh`.

## 3. Décisions et alternatives rejetées

| Décision | Alternative rejetée | Raison |
|----------|--------------------|--------|
| Un endpoint unique renvoyant l'analyse complète, sondé à 5 s | Sonder `sync:status` et ne recalculer que si la liste des fichiers change | Une 2ᵉ édition d'un fichier déjà modifié ne change pas la liste (marker toujours `M`) → analyse périmée ; le chemin « aucun changement » ne coûte qu'un `statusMatrix` restreint |
| `statusMatrix` restreint à `requirements`/`tests` | `SyncService.status()` complet | Évite de hacher tout le repo toutes les 5 s |
| Snapshot lu sur disque | Index vivant (`reqIndex`/`testsIndex`) | L'index peut ne pas refléter une modification faite hors de l'app ; cohérence avec « ce que git voit » |
| Sentinelle dans `activeAnalysisId` | Second état dans le contexte | Un seul état → pas de désynchronisation |
| Champs optionnels sur `ChangedRequirement`/`ImpactNode` | Nouveau type d'arbre | Rendu réutilisé tel quel ; YAML T46 existants restent valides |
| Liens de couverture suivis dans les deux sens dans le builder partagé | Ne corriger que pour T175 | Même contrainte métier (CLAUDE.md) ; une seule fonction |
| Analyse enracinée sur `rootRepoPath` | `selectedRepoPath` | Le périmètre validé est produit + composants, pas le repo sélectionné |

## 4. Impacts

- Analyses T46 : lecture inchangée ; les nouvelles analyses suivent en plus les liens de couverture
  créés depuis l'exigence (correction). Export / impression T46 non touchés.
- `print.impact-analysis.tsx` : non concerné (pas d'export pour l'analyse locale).
- Aucune écriture disque, aucun changement de schéma YAML projet.
- Performance : sans modification, un `statusMatrix` restreint par repo toutes les 5 s tant que la
  vue Analyse d'impact est ouverte (le hook n'est monté que dans le panneau et la page).

## 5. Découpage

Un seul sprint : types → sync → traceability → IPC/api-client → hook/contexte → panneau → page → i18n
→ `tsc` → script de service (repos git temporaires, cf. `T175-tests.md`) → vérification dans l'app →
mise à jour SPEC-TRACEABILITY §4.6 (nouveau §4.7 « Analyse des modifications locales ») et
SPEC-INDEX.
