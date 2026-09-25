# T172 — Design : marquage automatique `needsRevalidation` des éléments impactés

Réf. : `specs/T172.md`. Travail directement sur `main`.

## 1. Vue d'ensemble

```
openDraft / transition / tests.update(status)        (X quitte un statut isApproval)
        │  (verrou de X relâché)
        ▼
RevalidationService.markImpactedBy(repoPath, X.id, workspaceDir)
        │  liens de tous les repos (resolveRepoPaths) touchant X, sens indifférent
        ▼
pour chaque pair P ≠ X : exclusions (terminal, readonly, introuvable, déjà marqué)
        ▼
écrit `needsRevalidation: true` dans le YAML de P (sous le verrou de P) + upsert index
```

Lecture : tous les consommateurs de `ObjectLink.needsRevalidation` lisent désormais
`Requirement.needsRevalidation` / `TestCase.needsRevalidation`.
Affichage : composant `RevalidationFlag` (⚠ + infobulle) à côté du statut.

## 2. Découpage

**Un seul sprint.** ~15 fichiers, changements localisés ; pas de migration de données.

## 3. Fichiers à modifier

### 3.1 Types — `packages/types`

- `src/requirement.ts`
  - `Requirement.needsRevalidation?: boolean` — champ système persisté, absent = `false`.
  - `ObjectLink.needsRevalidation?: boolean` — devient optionnel, `@deprecated` (ignoré, plus
    écrit). Commentaire `targetCommitHash` mis à jour (non utilisé pour la revalidation).
- `src/test.ts` : `TestCase.needsRevalidation?: boolean`.
- `src/traceability.ts`
  - commentaire `CoverageStatus.needs_revalidation` → « l'exigence ou un de ses tests liés est
    marqué `needsRevalidation` ».
  - `RevalidationItem` remplacé par
    `{ elementId: string; elementType: 'requirement' | 'test_case'; title: string; status: string }`
    (seul producteur : `getMissingLinks` ; aucun consommateur renderer).
- `src/polenta-workspace.ts:102` : commentaire compliance (`validated` = aucune extrémité marquée).

### 3.2 Nouveau service — `apps/desktop/src/main/services/revalidation.service.ts`

```ts
export interface ImpactedElement { id: string; category: 'requirement' | 'test'; repoPath: string }

export class RevalidationService {
  constructor(
    git: GitService,
    reqIndex: RequirementsIndexService,
    testsIndex: TestsIndexService,
    schema: SchemaService,
    workspaceTree?: WorkspaceTreeService,
  )

  /** Point d'entrée unique (T172, réutilisé par T171). Marque les pairs de `elementId`. */
  markImpactedBy(repoPath: string, elementId: string, workspaceDir?: string): Promise<ImpactedElement[]>

  /** Helper pour les services : vrai si `fromStatus` est isApproval et `toStatus` ne l'est pas. */
  static leavesApproval(typeDef: ObjectTypeDefinition | null, fromStatus: string, toStatus: string): boolean
}
```

Algorithme `markImpactedBy` :
1. `repoPaths` = même logique que `TraceabilityService.resolveRepoPaths` → extraite en helper
   partagé `resolveWorkspaceRepoPaths(workspaceTree, repoPath, workspaceDir)` dans
   `workspace-repos.util.ts` (nouveau), utilisé par les deux services (évite une 3e copie).
2. Liens = `reqIndex.findAllLinks(p)` pour chaque `p`, aplatis ; garder ceux où
   `sourceId === elementId || targetId === elementId` ; pair = l'autre extrémité ; ignorer
   `pair === elementId` (auto-lien) ; dédoublonner les pairs.
3. Pour chaque pair, le localiser : premier `p` où `reqIndex.findById(p, id)` ou
   `testsIndex.findById(p, id)` répond (même ordre que `findRequirementById`). Introuvable → ignoré.
4. Exclusions :
   - déjà `needsRevalidation === true` → ignoré ;
   - statut terminal : `findObjectTypeDef(schema(p), pair.objectTypeRef)` →
     `statuses.find(s => s.name === pair.status)?.isTerminal` → ignoré ;
   - nœud readonly : helper `isRefInReadonlyNode(schema(repoPath), ref)` (voir 3.3) évalué sur
     le schéma **du repo ouvert** (c'est lui qui déclare `readonly` sur ses nœuds submodules)
     → ignoré.
5. Écriture sous `withKeyLock(\`${p}::requirements/${id}\`)` (resp. `tests/`) : relire via
   l'index, poser `needsRevalidation: true`, `writeYaml(targetRepo, …, omitAuditFields(obj))`
   avec `targetRepo = schema.resolveComponentRepoPath(p, ref, workspaceDir) ?? p` (même
   résolution que `update`), puis `upsert` / `upsertTestCase`.
6. Best-effort par pair : une erreur d'écriture est loggée (`console.error`) et n'empêche ni les
   autres pairs ni l'opération appelante. Retourne la liste des éléments effectivement marqués.

Pas de cascade (un seul niveau).

### 3.3 `schema-lookup.util.ts`

Déplacer `findOwningNode` et `findLocalNodeByRefPrefix` depuis
`bulk-import-validation.util.ts` (où ils sont privés) et exporter un helper :

```ts
export function isRefInReadonlyNode(schema: ProjectSchema, objectTypeRef: string): boolean
```

même logique que `bulk-import-validation.util.ts:117-122` ; ce dernier l'utilise à la place de
son code inline (pas de changement de comportement).

### 3.4 Déclencheurs — `requirements.service.ts`, `tests.service.ts`

Les services reçoivent `revalidation?: RevalidationService` (dernier paramètre optionnel du
constructeur — même convention que `tree?`). Le marquage est lancé **après** la sortie de
`withKeyLock` de X (pas de verrous imbriqués, pas d'interblocage si un lien forme un cycle).

- `RequirementsService.openDraft` : `wasApproved` calculé comme dans `transition` (factoriser
  en méthode privée `isApprovalStatus(repoPath, ref, status)`) ; si `wasApproved` et le statut
  cible n'est pas isApproval → `markImpactedBy` après écriture.
- `RequirementsService.transition` : réutilise `wasApproved` déjà calculé ; déclenche si
  `wasApproved && !isApproval(toStatus)`.
- `TestsService.openDraft` : idem.
- `TestsService.update` : si `dto.status` est présent et que `existing.status` est isApproval
  et `dto.status` ne l'est pas → déclenche (chemin colonne Statut de la vue Excel pour les
  tests, `SystemView.tsx:811`).
- `update` (champs) ne déclenche jamais. Les `update` existants préservent déjà
  `needsRevalidation` (spread `...existing`).

Le résultat IPC de ces méthodes est inchangé (l'objet X) — le renderer invalide largement (3.8).

### 3.5 `container.ts`

```ts
const revalidation = new RevalidationService(git, reqIndex, testsIndex, schema, workspaceTree)
const requirements = new RequirementsService(git, reqIndex, schema, tree, revalidation)
const tests = new TestsService(git, testsIndex, schema, tree, revalidation)
```
Exposé dans le container (`c.revalidation`) pour T171. Pas de nouvel IPC en T172.

### 3.6 Lecteurs — bascule sur le flag de l'élément

- `requirements-index.service.ts`
  - `createLink` n'écrit plus `needsRevalidation`.
  - `findAll` : implémenter le filtre `needsRevalidation` (aujourd'hui déclaré mais ignoré) sur
    `r.needsRevalidation === true`.
  - `findLinksNeedingRevalidation` supprimé (seul appelant : `getMissingLinks`).
- `traceability.service.ts`
  - `computeCoverage` : cellule `needs_revalidation` si `req.needsRevalidation || tc.needsRevalidation` ;
    `coverageStatus = req.needsRevalidation ? 'needs_revalidation' : computeCoverageStatus(cells)`
    (couvre l'exigence marquée sans test lié).
  - `computeRevalidationReqIds(links)` → remplacé par la lecture directe de
    `r.needsRevalidation` dans l'appelant (méthode supprimée).
  - `getMissingLinks.revalidationItems` : exigences et tests marqués, nouveau `RevalidationItem`.
- `maturity.util.ts` : paramètre `hasNeedsRevalidationLink` → `needsRevalidation` (valeur
  `!!req.needsRevalidation`) ; libellé critère 5 `'lien à revalider'` → `'impact à vérifier'` ;
  commentaires mis à jour.
- `query-engine.service.ts`
  - `flattenRequirement` / `flattenTestCase` : colonne système `needsRevalidation: !!x.needsRevalidation`.
  - `flattenLink` : colonne `needsRevalidation` retirée.
  - suppression de l'appel `computeRevalidationReqIds`.
  - vérifier la liste des colonnes autorisées du Builder (`~l.411`) : ajouter
    `needsRevalidation` aux colonnes système exigences/tests, la retirer des liens.
- `interface-compliance.service.ts`
  - statuts `covered`/`validated` (`l.108` et `l.277`) : `covered` si l'exigence d'interface
    **ou** l'élément source du lien `implements-interface` est marqué (précision de la spec
    §2.5 : après réouverture d'une exigence d'interface, c'est l'élément du composant qui est
    marqué, pas l'exigence d'interface elle-même) ; nécessite de résoudre la source via
    `reqIndex.findById`.
  - `computeNeedsRevalidation` **supprimé**, ainsi que l'IPC `interface:needs-revalidation`
    (`ipc/index.ts:611`) et `api.interface.needsRevalidation` (`packages/api-client`
    `ipc-client.ts:251`, `types.ts:538`). Jamais appelé ; sémantique « lien marqué » obsolète.
- `agents-md.template.ts:123` (+ `apps/desktop/PL/Product/AGENTS.md` si suivi par git — non :
  dossier non tracké, ignoré) : « Un élément marqué `needsRevalidation: true` signale un impact
  à vérifier — ne pas le lever sans analyse d'impact. »

### 3.7 Renderer — affichage

- Nouveau `renderer/components/system/RevalidationFlag.tsx` :
  `({ show }: { show: boolean }) => show ? <span title={t('system.revalidation.tooltip')} aria-label=…>⚠</span> : null`,
  couleur `text-status-warning` (même jeton que `CoverageBadge` `needs_revalidation`).
- `WordView.tsx` (~l.460-480) : rendu juste après le badge / le `<select>` de statut, lu depuis
  `(obj as AnyObject).needsRevalidation`.
- `ExcelView.tsx` : cellule `status` (~l.1957) — `InlineCell` reçoit une prop optionnelle
  `adornment?: ReactNode` rendue à droite de la valeur (hors zone d'édition) ; passée seulement
  pour `col === 'status'`, depuis `objectMap.get(node.objectId)`.
- `EditView.tsx` : à côté du champ Statut (`name === 'status'`, ~l.604) ; `objectData`
  (`SystemView.tsx:446-478`) transporte `needsRevalidation: 'true' | ''` pour les exigences et
  les tests.
- i18n `fr.json` / `en.json` : `system.revalidation.tooltip` = « Impact à vérifier » /
  « Impact to check ».

### 3.8 Renderer — rafraîchissement

Les pairs peuvent appartenir à un autre type/nœud que la vue courante. Dans
`SystemView.tsx`, `reopenDraftMutation.onSuccess` et `autoSaveMutation.onSuccess` (quand
`field === 'status'`) invalident par préfixe : `['objects', repoPath]`, `['object', repoPath]`,
ainsi que les clés matrice/queries si présentes (`['traceability', …]`, `['queries', …]` — à
confirmer par grep des `queryKey` existants lors du dev).

## 4. Décisions techniques et alternatives rejetées

1. **Flag sur l'élément, pas un statut** — validé en Spec : un statut dédié ferait perdre
   `approved` (couverture, maturité, campagnes, verrouillage).
2. **Déclencheur dans les services, pas dans l'IPC** — tout appelant (UI, futur MCP, T171)
   bénéficie du marquage. Rejeté : hook dans `ipc/index.ts` (contournable).
3. **Marquage hors du verrou de X** — évite les verrous imbriqués et les interblocages
   (A↔B rouverts simultanément). Coût : fenêtre où X est rouvert sans pairs encore marqués ;
   acceptable (quelques ms, pas d'état incohérent persistant).
4. **Écriture directe `writeYaml` dans `RevalidationService`** plutôt que via
   `RequirementsService.update` — `update` ne prend pas de champ système et y ajouter
   `needsRevalidation` à l'`UpdateRequirementDto` exposerait la levée du flag à tout appelant
   (réservée à T173). Même motif que `rewriteObjectTypeRef` (T135).
5. **Readonly évalué sur le schéma du repo ouvert** — c'est là que `readonly` est déclaré sur
   les nœuds submodules ; le schéma d'un composant autonome ne se déclare pas readonly.
6. **Suppression de `computeNeedsRevalidation`** plutôt que conservation en code mort —
   rejeté : le garder entretiendrait la sémantique « lien marqué » abandonnée.
7. **`ObjectLink.needsRevalidation` optionnel + `@deprecated`** plutôt que supprimé — les
   `links.yaml` existants contiennent `needsRevalidation: false` ; le typer optionnel évite des
   erreurs de lecture et une réécriture massive. Pas de nettoyage des fichiers.
8. **`apps/api`** non aligné (hors scope spec).

## 5. Mises à jour SPEC prévues (dernier sprint = sprint 1)

- `SPEC-REQ-requirements.md §5.2/§5.3` : flag sur l'élément, déclencheur, pairs, exclusions ;
  `needsRevalidation` de `ObjectLink` déprécié.
- `SPEC-TRACEABILITY.md §2.2/§2.3/§3.3` : nouvelles règles cellule/statut, liste « éléments à
  revalider » ; renvoi T173 pour la levée.
- `SPEC-AUDIT.md §3` : « [ABSENT] Bouton Revalider » → remplacé par T172/T173.
- `CLAUDE.md` : `needsRevalidation` ajouté aux champs système ; règle de cohérence 6
  reformulée (« Pas d'élément `needsRevalidation: true` laissé sans analyse d'impact »).
- `SPEC-INDEX.md` : colonne MAJ → T172 pour les sections touchées.
