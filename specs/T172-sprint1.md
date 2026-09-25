# T172 — Sprint 1 (unique) : marquage automatique `needsRevalidation` des éléments impactés

Réf. : `specs/T172.md`, `specs/T172-design.md`, `specs/T172-tests.md`. Travail sur `main`.

## Fichiers modifiés

**Types partagés**
- `packages/types/src/requirement.ts` — `Requirement.needsRevalidation?`, `ObjectLink.needsRevalidation` optionnel `@deprecated`.
- `packages/types/src/test.ts` — `TestCase.needsRevalidation?`.
- `packages/types/src/traceability.ts` — `RevalidationItem` par élément `{ elementId, elementType, title, status }` ; commentaire `needs_revalidation`.
- `packages/types/src/polenta-workspace.ts` — commentaire `ComplianceCellStatus`.
- `packages/api-client/src/{ipc-client,types}.ts` — `interface.needsRevalidation` retiré.

**Main (desktop)**
- `services/revalidation.service.ts` (nouveau) — `markImpactedBy()`, `leavesApproval()`.
- `services/workspace-repos.util.ts` (nouveau) — `resolveWorkspaceRepoPaths()` extrait de `TraceabilityService`.
- `services/requirements.service.ts` — déclencheur dans `openDraft` / `transition` (après le verrou), helper `readTypeDef`.
- `services/tests.service.ts` — déclencheur dans `openDraft` / `update` (quand `dto.status` quitte l'approbation), helper `readTypeDef`.
- `services/schema-lookup.util.ts` — `findOwningNode`, `findLocalNodeByRefPrefix` déplacés ici et exportés, nouveau `isRefInReadonlyNode` ; `needsRevalidation` ajouté à `SYSTEM_QUERY_FIELDS`.
- `services/bulk-import-validation.util.ts` — importe les helpers déplacés (comportement inchangé).
- `services/requirements-index.service.ts` — `createLink` n'écrit plus le flag ; filtre `needsRevalidation` de `findAll` implémenté ; `findLinksNeedingRevalidation` supprimé.
- `services/traceability.service.ts` — cellules et statut de couverture à partir des éléments ; `computeRevalidationReqIds` supprimé ; `revalidationItems` = éléments marqués ; `resolveRepoPaths` délègue à l'util.
- `services/maturity.util.ts` — critère 5 = flag de l'exigence, libellé « impact à vérifier ».
- `services/query-engine.service.ts` — colonne `needsRevalidation` sur les exigences et les tests, retirée des liens.
- `services/interface-compliance.service.ts` — `covered` si l'exigence d'interface ou l'élément implémentant est marqué (`hasImpactToCheck`) ; `computeNeedsRevalidation` supprimé.
- `services/agents-md.template.ts` — invariant reformulé.
- `ipc/index.ts` — IPC `interface:needs-revalidation` supprimé.
- `main/container.ts`, `mcp-server/container.ts` — `RevalidationService` injecté dans les services exigences et tests.

**Renderer**
- `components/system/RevalidationFlag.tsx` (nouveau) — ⚠ + infobulle i18n.
- `WordView.tsx` — icône après le badge ou le sélecteur de statut.
- `ExcelView.tsx` — prop `adornment` sur `InlineCell`, passée pour la colonne `status`.
- `EditView.tsx` — prop `labelAdornment` sur `FieldRow`, passée pour le champ Statut.
- `SystemView.tsx` — `objectData.needsRevalidation` ; `invalidateImpactedObjects()` (préfixes `objects` / `object` / `traceability-matrix` + candidats) après réouverture et après un changement de statut.
- `i18n/locales/{fr,en}.json` — `system.revalidation.tooltip`.

**Hors desktop**
- `apps/api/src/modules/traceability/traceability.service.ts` — correctif de compilation minimal : `?? false` et type local `LegacyRevalidationItem`. Le comportement n'est pas aligné (hors scope).

## Comportement implémenté

Conforme à `specs/T172.md` §2. Quand un élément quitte un statut `isApproval`, chaque élément
à l'autre bout d'un de ses liens (sens et type indifférents, tous les repos du workspace) reçoit
`needsRevalidation: true` dans son YAML. Ne sont pas marqués : l'élément lui-même, les éléments
terminaux, les éléments readonly, les liens orphelins et les éléments déjà marqués. Le statut et
la version des éléments marqués ne changent pas, et `links.yaml` n'est pas modifié. Le marquage
se fait au mieux : une erreur ne fait jamais échouer la réouverture.

## Divergences par rapport au design

1. **Détection readonly en mode workspace** (trouvée par `/code-review`) : pour un élément stocké
   dans un autre repo que le repo ouvert, son `objectTypeRef` est exprimé dans le schéma du
   composant et ne peut pas être résolu dans le schéma ouvert. Le readonly se lit donc **par
   repo** : un nœud de l'arbre workspace dont le nom de montage correspond à un nœud `readonly`
   du schéma ouvert (`readonlyRepoPaths`). `isRefInReadonlyNode` reste utilisé pour les
   éléments du repo ouvert.
2. `RevalidationService` n'est **pas ajouté à l'interface `Container`** de l'IPC : aucun canal
   n'en a besoin en T172. T171 l'ajoutera s'il expose un IPC.
3. `apps/api` : correctif de compilation minimal (le design le laissait hors périmètre, mais le
   changement de type `RevalidationItem` / `ObjectLink.needsRevalidation` cassait `tsc`).
4. `SearchEditPane` (vue Recherche) : pas d'invalidation élargie après un changement de statut.
   Les éléments marqués s'y rafraîchissent au prochain chargement.

## Vérifications

- `tsc --noEmit` : `apps/desktop`, `apps/api`, `apps/web`, `packages/types`,
  `packages/api-client` — 0 erreur.
- Greps de `T172-tests.md` : aucune occurrence de `computeNeedsRevalidation`,
  `findLinksNeedingRevalidation` ni `computeRevalidationReqIds`, et aucune lecture de
  `link.needsRevalidation`.
- Script de service hors UI (tsx, repos git temporaires, sans Electron), 20/20 OK : N1–N4, N8,
  L1, L2, L6–L11, L13, liste `revalidationItems`, plus le scénario workspace (repo composant
  marqué dans son repo, repo readonly non marqué).
- `/code-review` : un bug trouvé (readonly inter-repo), corrigé et re-testé.
- Non vérifié automatiquement : l'affichage (N7), le Query Builder (N9), la maturité (N10),
  la compliance d'interface (L16) et la multi-sélection Excel (L12). Tests manuels ci-dessous.

## Mises à jour SPEC

| Section | Modification |
|---------|--------------|
| `SPEC-REQ-requirements.md §3.4` | `needsRevalidation` ajouté aux champs système |
| `SPEC-REQ-requirements.md §5.2/§5.3` | `ObjectLink.needsRevalidation` déprécié ; §5.3 réécrit (déclencheur, éléments marqués, exclusions, notification, renvoi T173) |
| `SPEC-TRACEABILITY.md §2.2/§2.3` | statut de couverture et cellule `needs_revalidation` basés sur les éléments |
| `SPEC-TRACEABILITY.md §3.3` | « Liens à revalider » → « Éléments à revalider », plus de bouton Revalider |
| `SPEC-AUDIT.md §3` | « [ABSENT] Bouton Revalider » → résolu par changement de spec (T172/T173) |
| `SPEC-DASHBOARDS.md §5` | critère de maturité 5 = flag de l'exigence |
| `SPEC-ELECTRON-DESKTOP.md §22.7` | IPC `interface:needs-revalidation` supprimé |
| `SPEC-FORKS-BRANCHES-BASELINES.md §4/§5` | « liens » → « éléments » marqués |
| `SPEC-INDEX.md` | MAJ → T172 pour les lignes ci-dessus |
| `CLAUDE.md` | champs système fixes + règle de cohérence 6 |

## Tester manuellement

1. Prendre un projet avec SYS-A `approved` lié à un test approuvé T1 (lien créé depuis le
   test) et à une exigence en brouillon SW-C.
2. Vue Word : « Rouvrir en brouillon » sur SYS-A. → ⚠ à côté du statut de T1 et de SW-C
   (infobulle « Impact à vérifier »), mais pas sur SYS-A. T1 reste « Approuvé ».
3. Vérifier `tests/T1.yaml` : `needsRevalidation: true` est présent, version inchangée. `git diff
   links/links.yaml` est vide.
4. Vue Excel : l'icône ⚠ apparaît dans la cellule Statut de T1 et de SW-C. Vue Édition : elle
   apparaît à côté du libellé « Statut ».
5. Changer le statut d'une autre exigence approuvée en `review` dans la colonne Statut d'Excel
   → ses éléments liés sont marqués. Faire de même pour un test.
6. Matrice de traçabilité : SYS-A est en ⚠ `needs_revalidation`. Query Builder : colonne
   `needsRevalidation` présente sur les exigences et les tests.
7. Éditer un champ d'un brouillon → aucun nouvel élément marqué.
8. En anglais : l'infobulle affiche « Impact to check ».
