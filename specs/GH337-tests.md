# GH337 — Scénarios de test

Spec : `specs/GH337.md`. Design : `specs/GH337-design.md`. Indications : U = test unitaire (vitest),
W = e2e web, D = e2e desktop (ciblé), M = test manuel.

## 1. Binaire et environnement

| # | Scénario | Attendu | Type |
|---|---|---|---|
| B1 | `POLENTA_GIT_DIR` pointe sur une installation valide | elle est utilisée ; version lue | U |
| B2 | Windows, ni variable ni binaire embarqué | `GitUnavailableError` qui cite `pnpm git:fetch` ; aucun repli sur le git du `PATH` | U (plateforme simulée) |
| B3 | Version < 2.38 (faux binaire) | `GitUnavailableError` « git ≥ 2.38 requis » | U |
| B4 | Config système hostile : `GIT_CONFIG_SYSTEM` simulée avec `core.autocrlf=true`, `commit.gpgsign=true`, hook `pre-commit` qui sort en 1, `credential.helper=!echo bad`, `core.editor=false` | commit, checkout, statut et push se comportent comme avec une config vide | U |
| B5 | Variables `GIT_DIR` et `GIT_WORK_TREE` héritées de l'environnement | ignorées (retirées) | U |
| B6 | Installeur Windows : `resources/git` présent ; `git`, `bash`, `ssh`, `vim`, `less`, `perl` démarrent | ok ; taille relevée | M (sprint 0 et sprint 4) |

## 2. Exécution et processus

| # | Scénario | Attendu | Type |
|---|---|---|---|
| P1 | 200 `resolve` en parallèle sur un dépôt | un seul processus `cat-file` ; résultats corrects ; moins de 500 ms | U |
| P2 | Le processus `cat-file` est tué entre deux requêtes, puis pendant une requête | relance transparente ; la requête en cours est rejouée une fois | U |
| P3 | 50 écritures concurrentes (`add`, `commit`) sur un même dépôt | aucune erreur `index.lock` ; ordre respecté | U |
| P4 | Écritures sur deux dépôts différents | pas de sérialisation entre dépôts | U |
| P5 | `closeRepo` puis `closeAll` | aucun enfant vivant (pid vérifiés) | U |
| P6 | Fermeture de l'application après un fetch long interrompu | aucun `git.exe`, `git-remote-https.exe` ni `ssh.exe` restant | D |
| P7 | Délai réseau dépassé (serveur qui ne répond pas) | `GitError timeout` → message `describeTimeout` qui cite le réglage ; arbre de processus arrêté | U |
| P8 | Classement des erreurs : stderr de référence de chaque `kind` | bon `kind` | U |

## 3. Lectures

| # | Scénario | Attendu | Type |
|---|---|---|---|
| L1 | `status` : fichier modifié, ajouté, supprimé, renommé, non suivi, ignoré, chemin avec espaces et accents | entrées exactes (porcelain v2 `-z`) | U |
| L2 | GH326 : fichier réécrit à taille égale dans la même seconde que son indexation | vu modifié | U |
| L3 | GH296/GH335 : fichiers en CRLF sur disque, LF dans git, `.gitattributes` `eol=lf` | non vus modifiés après normalisation §9 ; un fichier réellement modifié reste modifié | U |
| L4 | `fileHistories` sur un dépôt de 50 commits avec renommages et suppressions | mêmes résultats (création, dernier auteur et date) que l'ancien `fileHistory` | U |
| L5 | `readText(rev, path)` sur un fichier absent ou un rev inconnu | `null` | U |
| L6 | `refs` : branches locales, distantes, tags légers et annotés (oid pelé) | conformes à `for-each-ref` | U |
| L7 | `graph` du panneau Version sur un historique avec merges | même rendu qu'avant (ordre, parents, refs) | U + W (spec du graphe existante) |
| L8 | `diffNames` avec renommage | statut R et `oldPath` | U |

## 4. Écritures locales

| # | Scénario | Attendu | Type |
|---|---|---|---|
| E1 | `commit` avec l'auteur passé, message multiligne avec accents | auteur, committer et message exacts ; pas de hook ni de signature | U |
| E2 | `commitSingleFile` (GH106) alors que d'autres fichiers sont indexés | seul le fichier est commité ; le reste de l'index est inchangé | U |
| E3 | Checkout avec une modification locale d'un fichier suivi | `LocalChangesError` qui nomme le fichier ; le working directory est intact | U |
| E4 | Checkout avec un fichier non suivi qui serait écrasé | `LocalChangesError` qui nomme le fichier | U |
| E5 | Checkout avec un `*.pref` commité par erreur sur la branche cible (GH336 Q1) | le checkout aboutit ; la copie locale de l'utilisateur est restaurée | U |
| E6 | « Rien à committer » affiché → changement de branche toujours possible (règle GH336 C) | ok sur les cas L2, L3 et E5 | U + W (gh336) |
| E7 | `updateRefs` en transaction, avec une ref dont l'`oldOid` ne correspond pas | rien n'est écrit | U |
| E8 | Tag annoté puis baseline (GH40) | tag lisible, pelé vers le bon commit | U |
| E9 | `discard` d'un fichier indexé et modifié | revient à HEAD dans l'index et sur le disque | U |

## 5. Réseau et identifiants

| # | Scénario | Attendu | Type |
|---|---|---|---|
| R1 | Clone, fetch et push HTTPS avec PAT sur le serveur `git http-backend` des e2e | ok ; progression du clone remontée | U + W |
| R2 | PAT recherché dans la ligne de commande des processus, `.git/config`, l'environnement des processus git et les logs | absent partout | U |
| R3 | PAT faux | erreur `auth` ; même message qu'avant | U |
| R4 | Remote `file://` (bare local), puis fetch, pull et push sans PC git dans le `PATH` | ok (plus de double chemin) | U |
| R5 | Remote SSH réel avec clé de l'utilisateur | fetch, pull et push ok | M |
| R6 | Serveur web : remote hors GIT_HOSTS ou `ext::`/`file://` | refusé avant tout lancement de git | U |
| R7 | Proxy : `HTTPS_PROXY` défini ; `NO_PROXY` qui exclut l'hôte (GH347) | le proxy est utilisé ou contourné comme pour `forge-http` | U |
| R8 | Hors ligne pendant Publier ou l'auto-pull | classé `isNetworkUnreachable` ; même message qu'avant | U |
| R9 | Push d'une branche en retard | `non-fast-forward` ; même parcours UI qu'avant | U |

## 6. Fusion

| # | Scénario | Attendu | Type |
|---|---|---|---|
| F1 | Fusion sans conflit (branche courante) | commit de merge, working directory à jour, branche avancée | U |
| F2 | Fusion avec conflit | `MergeConflictError` avec les chemins et les deux refs ; **ni le working directory ni l'index ne sont modifiés** | U |
| F3 | `mergeInto` vers une branche non courante | la ref avance ; le working directory n'est pas touché | U |
| F4 | GH332 : histoire croisée sans conflit, puis avec conflit | fusion ok, puis `MergeConflictError` | U |
| F5 | Éditeur de résolution GH37 sur un conflit YAML (champs différents des deux côtés) | même session et même résultat qu'avant ; la finalisation avance la bonne branche | U + W (gh37, gh222) |
| F6 | `displayBase` avec plusieurs bases, avec et sans conflit entre bases | même base que `singleMergeBase` | U |
| F7 | Pull avec avance des deux côtés, puis pull en avance rapide | identiques au comportement actuel | U + W |

## 7. Terminal

| # | Scénario | Attendu | Type |
|---|---|---|---|
| T1 | Ouverture du terminal sur un poste sans Git for Windows | Git Bash embarqué ; `git --version` donne la version embarquée ; pas d'invitation winget | D (gh238 adapté) + M |
| T2 | `git config --show-origin core.autocrlf` dans le terminal, avec un Git for Windows `autocrlf=true` installé | valeur de la config Polenta, pas celle du système | M |
| T3 | `git push` HTTPS depuis le terminal, compte connecté | aucun mot de passe demandé ; push ok | M |
| T4 | `git commit` dans le terminal | auteur = compte actif ; aucun hook du poste | M |
| T5 | Fermeture du terminal, puis askpass avec l'ancien nonce | refusé | U |

## 8. Non-régression et mesures

| # | Scénario | Attendu | Type |
|---|---|---|---|
| N1 | `pnpm test` complet | vert | U |
| N2 | Suite e2e web complète au merge | verte | W (niveau 3) |
| N3 | Mesures `PH2/handstickProduct` et `polenta-official` : statut, checkout, historique par fichier, ouverture du workspace | pas plus de 10 % plus lent que `main` | script `bench-git.ts` |
| N4 | Aucun `isomorphic-git` dans le dépôt ; aucun `git` lancé hors `git/` | test et lint verts | U |
| N5 | Client web (Docker) : clone, Publier, merge | ok avec le git de l'image | M (image construite) ou W |

## Critères d'acceptation

Ceux de `specs/GH337.md` §5. Les tests manuels restants à la validation finale sont B6, R5, T1 à T4
et N5 (si l'image n'est pas construite).
