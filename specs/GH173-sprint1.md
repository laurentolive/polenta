# GH173 — Sprint 1 (unique)

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `packages/types/src/branch.ts` | `AUTO_BRANCH_PREFIX`, `isAutoBranch` (noms exacts `dev-auto`, `dev-auto-<n>`) |
| `apps/desktop/src/main/services/sync.service.ts` | `settleAutoBranch`, `nextFreeBranchName` (extraite de `setAside`), appel dans `autoSync` et `resyncIntegration`, fast-forward par référence de l'intégration non checkoutée, `setAside` réutilise la `dev-auto` courante |
| `apps/desktop/src/main/services/workspace-tree.service.ts` | `repoExistsAtPin` : une `dev-auto` issue de la branche épinglée compte comme « au pin » |
| `apps/desktop/src/main/ipc/index.ts`, `web-server/channel-policy.ts` | channel `sync:settle-auto-branch` (desktop + liste blanche web) |
| `packages/api-client/src/{types,ipc-client,index}.ts` | `api.sync.settleAutoBranch`, type `AutoBranchOutcome` |
| `apps/desktop/src/renderer/lib/publishWorkspace.ts` | `readRepoState` : `dev-auto` = branche éphémère (fusion toujours, suppression) |
| `apps/desktop/src/renderer/hooks/useModificationMode.ts` | « Publier » actif sur une `dev-auto` propre portant des commits non fusionnés |
| `apps/desktop/src/renderer/components/sidebar/version/VersionRepoFolder.tsx` | « Tout annuler » : retour immédiat sur l'intégration |
| `apps/desktop/src/main/services/sync.service.gh173.test.ts` | 22 tests (U1–U22) sur de vrais repos git |

## Comportement implémenté

Conforme à `specs/GH173.md`. Toute modification de l'intégration désignée (repo avec remote)
bascule sur `dev-auto` au plus tard au tick d'auto-pull suivant (avant le fetch, donc aussi hors
ligne), ou au début de Resynchroniser. L'auto-pull avance ensuite l'intégration par référence.
« Publier » fusionne `dev-auto` et revient sur l'intégration. « Tout annuler » ramène tout de suite
sur l'intégration. Aucune UI ajoutée.

## Divergences par rapport au design (issues de la revue de code)

1. **Fast-forward par référence restreint** (design §2.2 étape 5 « quelle que soit la branche
   courante ») : seulement quand la branche courante n'a **aucun commit propre**. Sinon, pendant
   une publication en conflit sur `dev-auto`, l'auto-pull déplaçait l'intégration et l'éditeur de
   résolution (GH37) rejetait la résolution comme périmée. Test U21. Conséquence : sur une `dev-*`
   manuelle avec commits, l'intégration n'avance plus qu'à « Publier » (comme avant GH173).
2. **Resynchroniser divergé en conflit depuis `dev-auto`** : `setAside` ne crée pas de
   `dev-resync` quand la `dev-auto` courante porte déjà les commits locaux divergés — sinon ils
   étaient en double sur deux branches et `dev-resync` n'était jamais nettoyée. L'intégration est
   réalignée sur `origin`, « Publier » fusionne `dev-auto`. Test U22.
3. **Composant épinglé par nom de branche** (non prévu au design) : après bascule puis
   fast-forward de la branche épinglée, `repoExistsAtPin` voyait HEAD ≠ pin et la reconstruction de
   l'arbre faisait un checkout du pin sur une copie de travail modifiée. Tolérance ajoutée.
4. **Robustesse** : une erreur de `settleAutoBranch` est journalisée sans faire échouer le tick
   (fetch et push relancé conservés) ; après « Tout annuler », elle est best-effort.

Non retenus de la revue : double `status()` par tick (coût jugé faible), clé de la requête
`sync:is-merged` sans branche d'intégration (écart ≤ 3 s après une redésignation), garde
`integration-dirty` devenue filet de sécurité (gardée volontairement, design §2.2).

## Mises à jour SPEC

- `SPEC-FORKS-BRANCHES-BASELINES.md` §2.1 (règle « toute modification transite par une `dev-*` ») :
  ajout de `dev-auto`.
- §2.3 : nouveau paragraphe « Branche automatique `dev-auto` (GH173) ».
- §2.5 : étape d'auto-pull GH173 (bascule avant fetch, fast-forward par référence restreint).
- §2.6 : Resynchroniser avec modifications en attente, conflit depuis `dev-auto`.
- `SPEC-INDEX.md` : ligne §1–2, résumé, mots-clés, MAJ → GH173.

## Vérifications

- `pnpm typecheck` : OK.
- `vitest` desktop : 801/801 (dont 22 GH173).
- e2e web (`pnpm test:e2e:web`) : 151 passés, 13 ignorés, **1 échec hors ticket** :
  `gh136-status-label.spec.ts` GH136-1 attend 2 options dans la liste d'enum et en reçoit 3
  (option vide ajoutée par GH165, mergé sur `main`), reproductible seul ; GH173 ne touche pas ce
  composant. À corriger dans un ticket dédié.

## Tester manuellement

Préférence projet `autoPullIntervalMinutes: 1`, projet avec remote ; scénarios N1–N8 et L1–L6 de
`specs/GH173-tests.md`. En résumé :
1. modifier une exigence sur l'intégration, attendre une minute : panneau Version sur `dev-auto` ;
2. publier depuis un autre poste, attendre : graphe, intégration locale avancée, fichiers inchangés ;
3. « Publier » : retour sur l'intégration, `dev-auto` supprimée, les deux modifications sur le serveur ;
4. recommencer 1 puis « Tout annuler » : retour immédiat sur l'intégration ;
5. même modification des deux côtés : « Résoudre les conflits », puis retour sur l'intégration.
