# T173 — Sprint 1 : levée du flag dans les arbres d'analyse

Réf. : `specs/T173.md`, `specs/T173-design.md`, `specs/T173-tests.md`. Travail sur `main`.

## Fichiers modifiés

**Types / API**
- `packages/types/src/traceability.ts` — `FlaggedElement`, `FlaggedLinkedElement`,
  `ClearRevalidationFailure`, `ClearRevalidationResult`.
- `packages/api-client/src/types.ts`, `ipc-client.ts` — `api.revalidation.list` / `clear`.

**Main**
- `services/revalidation.service.ts` — `listFlagged(repoPath, workspaceDir)` et
  `clear(repoPath, ids, workspaceDir)` ; refactor interne partagé avec le marquage
  (`buildContext`, `locate`, `isReadonly`, `findElement`, `writeElement`), `markImpactedBy`
  inchangé fonctionnellement.
- `ipc/index.ts` — canaux `revalidation:list`, `revalidation:clear` (contrôle `string[]`) ;
  `Container.revalidation`.
- `container.ts` — `revalidation` passé à `registerIpcHandlers`.

**Renderer**
- `hooks/useFlaggedElements.ts` (nouveau) — query `['revalidation:flagged', rootRepoPath, workspaceDir]`, `flaggedIds`.
- `hooks/useClearRevalidation.ts` (nouveau) — mutation + invalidation par préfixe
  (`revalidation:flagged`, `objects`, `object`, `requirement(s)`, `test(s)`, `*-all`,
  `traceability-matrix`, `impact-analysis:local`, `widget-query-result`, `sync:status`).
- `hooks/useLiveFileSync.ts` — invalide `revalidation:flagged` avec l'analyse locale.
- `routes/impact-analysis.tsx` — contexte `RevalidationTreeContext` ; nœud marqué : case à
  cocher, ⚠, bouton « Lever le flag » (analyses baseline et locale) ; ligne d'élément changé :
  ⚠ seul ; bouton d'en-tête « Lever le flag de la sélection (N) » + modale de confirmation ;
  bandeau d'échecs fermable.
- `i18n/locales/fr.json`, `en.json` — `impactAnalysisPage.revalidation.*`.

## Comportement implémenté

Conforme à `T173.md` §2.1, §2.2, §2.4 : clé `needsRevalidation` retirée (jamais `false`),
statut/version/liens intacts, levée permise sur approuvé et terminal, refusée en readonly,
écriture dans le repo propriétaire (composant), verrou par fichier, best-effort par élément,
résultat `cleared` / `unchanged` / `failed`. État ⚠ lu en direct, y compris sur une analyse
baseline figée ; sélection dédupliquée par id, vidée au changement d'analyse, purgée des ids
qui ne sont plus marqués.

## Divergences par rapport au design

- `FlaggedElement.version` / `FlaggedLinkedElement.version` **optionnels** (`TestCase.version`
  est optionnel dans le modèle) — pas de valeur par défaut inventée.
- Les invalidations incluent aussi `requirements`, `tests`, `widget-query-result` et
  `sync:status` (l'écriture rend le working tree modifié : bouton Publier).
- Le compteur optionnel « N impacts à vérifier » dans l'en-tête d'analyse n'est pas fait
  (nice-to-have du design).

## Vérifications

- `tsc --noEmit` : `apps/desktop`, `packages/types`, `packages/api-client` — 0 erreur.
- Script de service hors UI (tsx, repos git temporaires produit + composant + composant
  readonly, sans Electron) : **23/23 OK**, 5 exécutions consécutives — N1–N5, N6, N7, N8, L1–L9,
  R1 de `T173-tests.md`.
- `/code-review` (medium) : 1 constat — levée impossible pour les éléments non atteints par un
  arbre (ligne « élément changé », marquage T171) : **attendu**, c'est la liste de repli du
  sprint 2. Remarque mineure non corrigée : un élément d'un composant readonly (non marquable par
  T172, seulement marqué à la main) affiche le bouton ; le clic renvoie l'échec « lecture seule ».

**Constat hors périmètre** : `RequirementsIndexService.getOrBuild` / `TestsIndexService.getOrBuild`
ne dédupliquent pas les constructions concurrentes d'un index froid ; une construction tardive
peut écraser un index plus récent (observé dans L8 avec index froid, intermittent). Sans effet
dans l'app (index construit à l'ouverture du repo), mais à traiter dans un ticket dédié.

Non couvert par le script (manuel) : N9–N13, L10–L13, R2, R3.

## Tester manuellement

1. Projet avec `SYS-A` approuvée liée à un test approuvé `T1` et à une exigence brouillon `SW-C`.
   Rouvrir `SYS-A` en brouillon (T172 marque `T1` et `SW-C`).
2. Vue Analyse d'impact → « Modifications locales » : `T1` et `SW-C` apparaissent dans les
   arbres de `SYS-A` avec case, ⚠ et « Lever le flag » ; `SYS-A` n'a pas de bouton.
3. « Lever le flag » sur `T1` : ⚠ disparaît de la ligne, puis dans Excel/Word/Édition et la
   matrice sans recharger. `git diff tests/T1.yaml` = une seule ligne `needsRevalidation` en moins.
4. Rouvrir à nouveau (après réapprobation) pour re-marquer, cocher `T1` et `SW-C`, « Lever le
   flag de la sélection (2) » → modale → OK : les deux flags levés, sélection vidée.
5. Ouvrir une analyse baseline dont un nœud est marqué : ⚠ et bouton présents ; le statut
   d'impact du nœud (sélecteur) n'est pas modifié par la levée, et inversement.
6. Passer l'app en anglais : libellés traduits.
