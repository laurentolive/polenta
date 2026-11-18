# GH337 — Sprint 1 (lectures) : résumé

Design : `specs/GH337-design.md` §4, §5, §10.

## Livré

Toutes les **lectures** git passent par `GitBackend`. Les écritures, le réseau et les fusions restent
sur isomorphic-git jusqu'aux sprints 2 et 3.

| Fichier | Lectures migrées |
|---|---|
| `git.service.ts` | refs, tags, blobs, arbres, historique (`pathCommits`, `fileHistories` en un seul `log`), `mergeBase` |
| `sync.service.ts` | statut (`status()`), graphe (un seul `log`), diff, fichiers d'un commit, refs, tags, branches, état d'intégration, `ahead` (`notOnRemotes`, un seul `rev-list`) |
| `baseline`, `workspace-tree`, `integration-branch`, `read-file-at`, `repo-conformity`, `results-import`, `auth`, `forge/*`, `ipc` | refs, branches, remotes, fichiers, `check-ignore`, config ; `results-import` sans `execFile('git')` |

**Ajouts à `GitBackend`** : `refNames`, `refCommits`, `pathCommits`, `fileHistories`, `notOnRemotes`,
`hashFiles`, `lsTreeProcess` (référence de test).

**Socle (`git/`)** :
- `cat-file` persistant lancé **hors du dossier du dépôt** (`--git-dir`). Sous Windows, le dossier
  courant d'un processus vivant ne peut pas être supprimé : retrait d'un dépôt en EBUSY pendant 60 s.
  Vérifié : les packs ouverts n'empêchent pas la suppression.
- `GIT_LITERAL_PATHSPECS=1` pour tous les appels de Polenta (pas le terminal) : `a[1].yaml` ne vise
  plus `a1.yaml`. `check-ignore` le refuse et s'en passe.
- **Chemins chauds sans processus** :
  - `currentBranch()` lit le fichier `HEAD` (185 `symbolic-ref` sur 237 lancements dans un fichier
    de test : vérification de lecture seule à chaque écriture) ;
  - `lsTree()` lit les arbres par le `cat-file` persistant (équivalence à `ls-tree` testée sur 36
    combinaisons d'options) ;
  - `remotes()` en cache tant que `.git/config` ne change pas (date en ns, taille ; invalidé par les
    écritures de Polenta).
- `status()` : le rafraîchissement des faux changements de fins de ligne passe par la file d'écriture
  seulement si elle est libre. Il ne bloque plus derrière un fetch, ne fait rien si l'index est
  verrouillé par un autre processus, et ne laisse pas indexée une réécriture concurrente.
- `POLENTA_GIT_SPAWN_STATS=<fichier>` : une ligne par processus git lancé (mesures).

**Packaging** :
- `Dockerfile.web` installe `git` et `openssh-client` : sans eux, le client web casse dès ce sprint.
- `release.yml` lance `pnpm git:fetch` avant l'empaquetage : sans lui, l'installeur partirait sans git.

**`nodeCheckout`** (essai du sprint 0) : les conflits dossier / fichier sont vérifiés avant toute
écriture, avec repli sur `git checkout`.

## Comportement

- **Hors dépôt**, `currentBranch()` lève, comme isomorphic-git. `GitService` traduisait sinon un dossier
  quelconque en « tête détachée », donc en lecture seule (GH206 S8).
- **Mise en conformité (#336)** sur un clone sans `.gitattributes`, en CRLF sur disque et LF dans git :
  ces faux changements ne la bloquent plus (`conformity-dirty`). C'est elle qui pose `.gitattributes`
  et normalise (spec §4.3).
- **`workdirChangesVsHead`** compare le disque à HEAD quand l'index en diffère (`D.` + `??`, `MM`) :
  plus de faux « modifié ».

## Écarts et points à valider

1. **À valider par l'humain** : un fichier **CRLF dans git**, LF sur le disque, avec le `.gitattributes`
   de Polenta (`* text=auto eol=lf`), est maintenant vu **modifié**, comme par `git status` en ligne
   de commande (spec §3.1). isomorphic-git le voyait inchangé (test GH296 réécrit, commentaire
   « à confirmer »). Le cas inverse, CRLF sur disque et LF dans git, reste non modifié (spec §4.3).
2. **Tests GH296 / GH335** : la fixture reçoit le `.gitattributes` de #336, qui porte la règle depuis
   (spec §4.3, §5.4).
3. **Durée de la suite unitaire : réglée.** Elle était passée de ~80 s à ~140 s, avec des tests qui
   dépassaient 20 s au hasard. Ces dépassements étaient des **blocages**, pas de la lenteur
   (`POLENTA_GIT_HANG_LOG`) : un `git add` ou un `rev-list` de quelques ms restait en vie plus de 50 s.
   - **Cause** : vitest exécute les fichiers dans des threads d'un même processus. Sous Windows, un
     processus lancé par un thread hérite des tuyaux qu'un autre thread crée au même moment. Un
     `cat-file` persistant (60 s d'inactivité) gardait ainsi ouverte la sortie d'un git déjà terminé.
   - **Preuve** : avec le pool `forks`, zéro blocage.
   - **Correctif** : `POLENTA_GIT_BATCH_IDLE_MS=2000` en test (`vitest.config.ts`).
   - **Résultat** : 81 à 95 s, contre 78 à 91 s pour main dans les mêmes conditions. Délais de 20 s
     d'origine et P3 à 50 écritures, verts 3 fois sur 3.
   - **L'application n'est pas concernée** : elle lance git depuis un seul thread.

   En plus, les chemins chauds lancent moins de processus :
   - avance et retard : un `rev-list --left-right --count` au lieu de deux `log` ;
   - remotes : lus dans `.git/config` (repli sur `git config` hors format simple) ;
   - branches d'intégration : un seul `for-each-ref`.

   Soit 1 712 lancements sur la suite au lieu de 1 943, et au total ~25 % de moins qu'au début du
   sprint.
4. **État mixte, transitoire** : index écrit par isomorphic-git, lu par git natif. Une réécriture de
   même taille dans la seconde d'un commit peut échapper au statut natif. Un échec isolé
   (`versions.gh245` A5, `DIRTY_CHANGES`) une fois sur trois suites complètes ; il passe seul. Cela
   disparaît avec les écritures natives du sprint 2, où il sera revérifié.
5. **Pas encore migrés** : `safeCheckout` et `stageAll` utilisent encore isomorphic-git
   (`eolAwareStatusMatrix`, `add`). Ils passent au sprint 2, et `racy-status.util.ts` n'est supprimé
   qu'à ce moment-là, car `safe-checkout` l'utilise encore.
6. **Revue de code** (`/code-review high`, 10 points) : 7 corrigés ici, 2 relèvent du sprint 2
   (`safeCheckout`, `stageAll`), et 1 est le point 1 ci-dessus.

## Vérifications

- `pnpm typecheck` : 0 erreur.
- `pnpm lint` : ne vérifie rien (pas d'ESLint dans le dépôt, voir sprint 0).
- `npx vitest run` (suite complète) : 186 fichiers sur 186 et 1 976 tests verts sur deux des trois
  derniers passages. Le troisième a eu un échec : le point 4.
- Nouveaux tests : `sync.service.gh337.test.ts` (9), `git-backend.gh337.test.ts` (L7b, L9 à L13),
  `git-core.gh337.test.ts` (retrait d'un dépôt pendant que `cat-file` vit),
  `node-checkout.gh337.test.ts` (conflits dossier / fichier).
- Non lancé : aucun e2e. Le sprint 1 n'en prévoit pas ; e2e ciblés au sprint 3.

## Tester à la main

Ouvrir un workspace et vérifier :
- panneau Version : statut, graphe, tags, avance et retard ;
- historique d'une exigence ;
- mise en conformité d'un vieux clone sans `.gitattributes`.

Les écritures (commit, checkout, publier) passent encore par isomorphic-git.
