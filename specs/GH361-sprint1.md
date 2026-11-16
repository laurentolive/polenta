# GH361 — Sprint 1 : outils MCP de rangement et module de verrou

## Fichiers

| Fichier | Changement |
|---|---|
| `apps/desktop/src/main/services/tree-lock.util.ts` | nouveau — verrou long (app) / court (écriture), `<gitdir>/polenta/locks/` |
| `apps/desktop/src/main/services/tree-ops.util.ts` | nouveau — opérations pures par chemin de dossier |
| `apps/desktop/src/main/services/tree.service.ts` | `readLayout` (rangement stocké hydraté, non classés, objets) |
| `apps/desktop/src/mcp-server/container.ts` | `tree: TreeService` reconstruit (lister + adopteur de titres comme l'app) |
| `apps/desktop/src/mcp-server/tools/tree.tools.ts` | nouveau — 7 outils, `planBulkFolders` / `placeBulkFolders` |
| `apps/desktop/src/mcp-server/tools/bulk-import.tools.ts` | champ `folder` (exigences, tests) |
| `apps/desktop/src/mcp-server/index.ts` | enregistrement |
| `apps/desktop/src/main/services/agents-md.template.ts` | outils de rangement, `TREE_LOCKED` |
| `*.gh361.test.ts` (3 fichiers) | scénarios A, B, C de `GH361-tests.md` |

## Comportement

Conforme à `specs/GH361.md` côté MCP. Sans le sprint 2, l'application ne pose pas de verrou long :
les écritures MCP passent toujours (verrou court entre agents seulement).

## Divergences avec le design

- §4.2 : les outils opèrent sur le **rangement stocké** (`placed`) et non sur l'arbre hydraté
  complet — un dossier ajouté à la fin de la racine hydratée se serait placé après la queue non
  classée, qui aurait alors été écrite en entier dans le fichier. Design corrigé.
- §2.1 : encodage des noms de fichiers de verrou rendu injectif (`_` → `__`, `%` → `_`).
- `bulk_import_*` : un chemin `folder` invalide ou ambigu est contrôlé **avant** la création, en
  écriture comme en aperçu : l'entrée n'est pas créée. Les erreurs `FOLDER_PLACEMENT_FAILED`
  (objet créé mais non rangé) figurent dans `errors` sans compter dans `summary.failed`.
- Spec, critère 2 : un `create_folders` rejoué renvoie dans `existing` les chemins demandés (2),
  pas les 3 dossiers.

## Vérifications

- `pnpm typecheck` (desktop) : OK.
- `npx vitest run --changed main` : 22 fichiers, 270 tests OK (dont 35 nouveaux GH361).
- Pas de script `lint` pour `apps/desktop`.

## Revue de code (`/code-review medium`)

Corrigé : dossiers prévus de même id dans l'aperçu (faux `FOLDER_AMBIGUOUS`) ; erreur imprévue
au rangement après création (compte rendu perdu) → `FOLDER_PLACEMENT_FAILED` ; verrou court sans
propriétaire (jeton, reprise d'un verrou périmé par renommage vérifié, libération du seul sien) ;
IDs prévus décalés par une entrée refusée pour son dossier (entrées refusées exclues avant
l'import, plus de correspondance par identité d'objet) ; aperçu muet sur la lecture seule ;
`toCreate` comptant des entrées non créées ; comparateur dupliqué.

Non retenu : relecture des index à chaque appel (nécessaire, ce process n'a pas de watcher) ;
documentation du verrou côté application (livré au sprint 2, même ticket).

Après correctifs : typecheck OK ; `vitest --changed main` 22 fichiers OK (39 tests GH361).
