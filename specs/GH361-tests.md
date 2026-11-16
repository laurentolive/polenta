# GH361 — Scénarios de test

Auto = couvert par un test automatique (fichier indiqué) ; Manuel = à vérifier à la main.

## A. Opérations pures (`tree-ops.util.gh361.test.ts`) — Auto

| # | Scénario | Attendu |
|---|---|---|
| A1 | `parseFolderPath` : `"A/B"`, `" A / B "`, `""`, `"A//B"`, `"/A"`, `"A/"` | `[A,B]` ×2, puis `FOLDER_PATH_INVALID` ×4 |
| A2 | `ensureFolder` sur arbre vide, `Sécurité/Batterie` puis `Sécurité/Moteur` | 3 dossiers, `Sécurité` créé une fois, ordre de création |
| A3 | `ensureFolder` sur chemin existant | aucun créé, arbre identique |
| A4 | Deux dossiers frères `A` | `findFolder(A)` → `FOLDER_AMBIGUOUS` |
| A5 | Dossier sous un élément, nom avec `/` | non atteignable par chemin ; `toEntries` → `path: null` |
| A6 | `renameFolder` vers nom d'un frère / nom avec `/` / même nom | `FOLDER_EXISTS` / `FOLDER_PATH_INVALID` / unchanged |
| A7 | `moveFolder` dans lui-même, dans un descendant, vers parent ayant un homonyme | `FOLDER_CYCLE` ×2, `FOLDER_EXISTS` ; contenu déplacé intact sinon |
| A8 | `deleteFolder` vide / non vide / non vide + recursive | supprimé / `FOLDER_NOT_EMPTY` / supprimé, objets libérés listés (sauf objet aussi rangé ailleurs) |
| A9 | `moveObject` élément avec enfants vers dossier | déplacé avec ses enfants, à la fin |
| A10 | `moveObject` objet présent deux fois | `OBJECT_AMBIGUOUS` |
| A11 | `moveObject` vers `null`, élément avec enfants | élément retiré, enfants à sa place |
| A12 | `reorderChildren` : cités en tête, autres dans l'ordre actuel ; non-enfant → `NOT_A_CHILD` ; doublon → `DUPLICATE_ENTRY` | |

## B. Verrou (`tree-lock.util.gh361.test.ts`) — Auto

| # | Scénario | Attendu |
|---|---|---|
| B1 | Repo git : dossier de verrou sous `.git/polenta/locks` ; `.git` fichier (worktree) → dossier cible | |
| B2 | `withTreeWriteLock` sans verrou | `fn` exécuté, fichier `.write` retiré après (même si `fn` lève) |
| B3 | Verrou long actif (ce processus, `expiresAt` futur) | `TreeLockedError` avec `since`, `fn` non exécuté, `.write` retiré |
| B4 | Verrou long expiré, ou `pid` mort | ignoré, `fn` exécuté |
| B5 | Deux `withTreeWriteLock` concurrents sur le même arbre | sérialisés (jamais simultanés) |
| B6 | `.write` d'un `pid` mort / de plus de 30 s | supprimé, `fn` exécuté |
| B7 | `.write` vivant tenu plus de 5 s | `TreeLockedError` |
| B8 | Autre arbre (autre type) verrouillé | sans effet |
| B9 | `waitForWriteLock` rend la main à la libération du `.write` | |

## C. Outils MCP (`tree-tools.gh361.test.ts`, conteneur MCP réel, repo temporaire) — Auto

| # | Scénario | Attendu |
|---|---|---|
| C1 | `get_tree` sur exigences rangées + non rangées | `root` = rangement, `unclassified` trié par ID, titres courants, `locked: null` |
| C2 | `get_tree` sur type de test, sur type d'issue | idem |
| C3 | `get_tree` type campagne / inconnu | `TYPE_NOT_SUPPORTED` / `TYPE_NOT_FOUND` |
| C4 | `create_folders` dryRun (défaut) | aucun fichier écrit, `created` prévu |
| C5 | `create_folders` réel puis rejoué | 3 dossiers, une écriture ; rejoué : `existing`, fichier inchangé |
| C6 | `move_to_folder` objet non classé → dossier ; puis `null` | `get_tree` le montre dans le dossier puis dans `unclassified` ; fichier sans `name` sur les éléments |
| C7 | `move_to_folder` dossier absent + `createMissing:false` | `FOLDER_NOT_FOUND` |
| C8 | `move_to_folder` objet d'un autre type / inexistant | `OBJECT_NOT_FOUND` |
| C9 | `rename_folder`, `move_folder`, `delete_folders` (recursive), `reorder_tree` | arbre attendu via `get_tree` ; objets du dossier supprimé dans `unclassified`, aucun fichier objet supprimé |
| C10 | Verrou long posé (`writeAppLock`) | écriture → `TREE_LOCKED`, fichier inchangé ; dryRun → aperçu + `locked` ; `get_tree` → `locked` ; autre type → passe |
| C11 | Verrou retiré | écriture passe |
| C12 | Branche en lecture seule ; nœud `readonly` | `READONLY_BRANCH` ; `READONLY_REPO` |
| C13 | `bulk_import_requirements` dryRun avec `folder` valide / `"A//B"` | `foldersToCreate` / erreur d'entrée `FOLDER_PATH_INVALID`, rien écrit |
| C14 | `bulk_import_requirements` réel avec `folder` | objets créés et rangés ; YAML sans `folder` ; une écriture d'arbre par type |
| C15 | `bulk_import_tests` réel, arbre verrouillé | objets créés, `FOLDER_PLACEMENT_FAILED: [TREE_LOCKED]…` par entrée, objets non classés |
| C16 | Fichier écrit par le MCP relu par `TreeService.get` de l'app | même arbre que `get_tree` |

## D. Application (sprint 2)

| # | Scénario | Type |
|---|---|---|
| D1 | `TreeEditLocks` : acquire écrit le fichier, release le retire ; deux baux sur le même arbre → fichier tant qu'il en reste un ; purge des baux expirés ; `renew` d'un bail purgé → `false` ; `releaseAll` | Auto (`tree-edit-locks.gh361.test.ts`) |
| D2 | `acquire` attend la libération d'un `.write` actif | Auto (D1) |
| D3 | Hook : acquire au montage, renew périodique, release au changement de type et au démontage, ré-acquire si renew `false`, `onAcquired` appelé | Auto (`useTreeEditLock.gh361.test.ts`, faux timers) |
| D4 | e2e web : ouvrir Exigences sur un type → fichier de verrou présent (via canal de test ou lecture disque) ; passer sur Tests → verrou de l'exigence retiré, verrou du test posé | Auto (`e2e-web/gh361-tree-lock.spec.ts`) |
| D5 | Canaux `tree:lock*` acceptés par la politique du serveur web | Auto (test de `channel-policy` existant) |
| D6 | App desktop ouverte sur un type, agent (Claude Code) qui range : `TREE_LOCKED`, message clair ; changer de type → l'agent réussit ; revenir → rangement visible | **Manuel** |
| D7 | App tuée (gestionnaire des tâches) pendant l'affichage → écriture de l'agent passe aussitôt | **Manuel** |
| D8 | `git status` propre après une session (aucun fichier de verrou visible) | **Manuel** (et B1) |
