# GH104 — Sprint 1 : main process

Périmètre : `specs/GH104-design.md` §7, sprint 1 (types, utilitaires partagés + refactor GH100,
`SchemaDeleteService`, `deleteTypeTree`, câblage IPC / API / serveur web). Pas d'UI : la corbeille
de l'onglet Structure appelle encore l'ancienne suppression jusqu'au sprint 2.

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `packages/types/src/schema.ts` | `SchemaDeleteTarget`, `SchemaDeletePlan`, `SchemaDeleteResult` ; contrat « tableau vide » des `linkTypes` ; commentaires mal encodés (13 lignes) réparés |
| `apps/desktop/src/main/services/schema-refs.util.ts` | nouveau — `declaresRef`, `mapLinkRefs`, `objectIdsOfType`, `dedupeRepos`, `repoKey`, `pathExists` |
| `apps/desktop/src/main/services/type-rename.service.ts` | utilise `schema-refs.util.ts` (comportement inchangé, tests GH100 verts sans modification) |
| `apps/desktop/src/main/services/schema-delete.service.ts` | nouveau — `plan` / `delete` |
| `apps/desktop/src/main/services/tree.service.ts` | `deleteTypeTree` |
| `apps/desktop/src/main/services/link-validation.util.ts` | liste de refs vide → type de lien refusé |
| `apps/desktop/src/main/container.ts`, `main/ipc/index.ts` | DI, `schema:preview-delete` / `schema:delete` (+ `checkDeleteTarget`, `GRAPH_WRITE_CHANNELS`) |
| `apps/desktop/src/web-server/channel-policy.ts` | 2 canaux, arguments chemin `[0, 1]` |
| `packages/api-client/src/{types,ipc-client}.ts` | `schema.previewDelete`, `schema.delete` |
| `apps/desktop/src/main/services/campaigns.service.ts` | commentaire mal encodé réparé (commit séparé) |
| tests : `schema-delete.service.test.ts`, `schema-refs.util.test.ts`, `link-validation.util.test.ts` | D1–D10 + D9b, D9c |

## Comportement implémenté

- `plan` : aperçu sans écriture — nœuds du sous-arbre, refs supprimées, objets par catégorie, liens
  par repo (relus sur disque, en parallèle), types de lien modifiés / vidés, erreurs
  `REPO_MISSING` / `NOT_FOUND` (cible absente, ou `root`) / `READONLY`.
- `delete` : refait le plan, refuse s'il a des erreurs, puis : objets (pierre tombale d'abord,
  verrou par fichier ; fichier déjà absent = supprimé) → `impact-acks/<ID>/`, `test-runs/<ID>/` des
  objets effectivement supprimés → liens de tous les repos → arbres → schéma du repo → refs des
  autres repos → invalidation des index.

## Divergences par rapport au design

1. **Arrêt sur échec avant les arbres** (et pas seulement avant le schéma) : si un objet n'a pas pu
   être supprimé, son arbre d'affichage est gardé (sinon il disparaîtrait de la vue tout en
   restant sur disque) et ses liens aussi ; la relance termine. Design §2.3 étape 5 et D9 mis à jour.
2. **Schéma du repo d'abord, autres repos seulement s'il est enregistré** : sinon les autres repos
   perdraient une ref vers un type encore déclaré (D9c).
3. **Lecture seule** : vérifiée sur le nœud cible, ses ancêtres **et tout le sous-arbre supprimé**,
   ainsi que sur le repo s'il est monté `readonly` dans le schéma du repo racine du workspace
   (`RevalidationService.readonlyRepoPaths`). Le design parlait aussi de « pin tag / SHA » : le main
   n'a pas de notion de repo en lecture seule par pin (les autres écritures n'en tiennent pas compte
   non plus) — non ajoutée. L'UI actuelle ne bloque pas non plus la corbeille (contrairement à ce
   que disait la spec §3).
4. **Pas de vérification `url` sur le nœud** : `SystemNode` n'a plus de `url` (les composants en
   repo séparé sont déclarés dans `polenta-repo.yaml`) ; tout nœud du schéma sauf `root` est un
   composant local.
5. **Validation des liens (main / MCP)** : `validateLinkEntries` refuse un type de lien dont
   `sourceRefs` ou `targetRefs` est un tableau vide (avant : « accepte tout »). Sinon un type vidé
   par une suppression aurait accepté n'importe quel lien via le serveur MCP. Une liste **absente**
   reste non contrainte.

## Revue (`/code-review`)

Corrigés : liste vide = « tout accepté » côté main ; sous-composant en lecture seule non vérifié ;
arbres supprimés malgré un échec ; `ENOENT` bloquant ; autres schémas réécrits malgré l'échec du
schéma principal ; lectures `links.yaml` en série ; `exists` dupliqué.
Écartés : cache du schéma / index périmés et graphe des autres repos non invalidé — le watcher
invalide déjà schéma, index et graphe sur tout changement de fichier de chaque repo du workspace
(`container.ts`), comme pour GH100.

## Tests

- `pnpm typecheck` : 0 erreur. `pnpm test` : 639 tests verts (desktop), 38 (merge-core).
- `pnpm --filter @polenta/desktop test:e2e:web` : 100 verts, 13 ignorés (inchangé).
- Pas de lint configuré dans le repo (`turbo lint` : 0 tâche).

## Tester manuellement

Pas d'UI dans ce sprint. Depuis la console DevTools du renderer, sur un workspace de test :
`await window.api.schema.previewDelete(repoPath, workspaceDir, { kind: 'node', nodeName: 'A' })`
puis `window.api.schema.delete(...)`, et relire `git status` / `git diff` du ou des repos
(objets supprimés, pierres tombales, `links.yaml`, `.polenta/trees`, `schema.yaml`).
