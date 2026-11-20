# GH337 — Sprint 4 (fixtures, suppression, mesures) : résumé

Design : `specs/GH337-design.md` §10 sprint 4. Spec : `specs/GH337.md` §5, §8.

## Livré

- **Helper de fixtures natif** : `apps/desktop/src/main/git/test-repo.test-util.ts` (`TestRepo` : init,
  write, add, commit, checkout, branch, tag, remote, status…). Auteur et date fixés, commits vides
  autorisés. `GitBackend` gagne `removeRemote` et `gitLsRemoteHeadOids`.
- **36 fichiers de tests migrés** hors isomorphic-git. `e2e-web/gh222-tree-merge.spec.ts` ne citait
  isomorphic-git que dans un commentaire.
- **Adaptations à relire** (les tests ne sont pas affaiblis, mais ces trois changements de fixture
  ou d'attendu méritent un regard) :
  - `gh173` U5 : `toBeUndefined` devient `toBeNull` (tête détachée renvoie `null`).
  - `gh332` : le test « reproduit le blocage isomorphic-git » ne testait que la bibliothèque. Remplacé
    par une vérification de la fixture (deux bases de fusion).
  - `gh314` : l'état « HEAD posé sur un objet tag » est écrit directement dans `.git/HEAD`, car un
    checkout natif ne peut pas produire cet état.
  - `gh296` : le blob CRLF est un vrai blob CRLF (`writeBlob` + `setIndexEntries`), pour que le test
    veuille dire quelque chose.
- **Production** : `forge-access.ts` ne contient plus les branches d'erreur propres à isomorphic-git
  (`HttpError`, `GitPushError`, `SmartHttpError`). Les commentaires qui citent isomorphic-git sont
  réécrits.
- **Scripts** : `forge-smoke.ts` passe par `GitBackend`. `bench-git.ts` ne mesure plus que le natif.
- **Dépendances** : `isomorphic-git` et `async-lock` retirés de `apps/desktop/package.json`, et de
  `electron.vite.config.ts`. `pnpm-lock.yaml` : entrées orphelines retirées, une entrée ajoutée
  (`events@3.3.0`, optionnelle). Aucune version changée. `pnpm install --frozen-lockfile` passe.
- **Test anti-import** : `src/main/git/no-direct-git.gh337.test.ts`. Il échoue si un fichier hors de
  `src/main/git/` (tests et e2e exceptés) importe isomorphic-git ou async-lock, ou lance `git`.
  **Une exception documentée** : `scripts/app-version.ts` (`git describe` au build). Décision en
  attente, voir ci-dessous.
- **Spec** : `SPEC-TECH-stack` (§2, §6, §8, §9), `SPEC-ELECTRON-DESKTOP` (§1, §2-3, règles, §19.8b),
  `SPEC-FORKS-BRANCHES-BASELINES` (§2), `SPEC-ACCOUNTS-AUTH` (jetons), `SPEC-WEB` (§9, image Docker).
  Index `SPEC-INDEX` : colonne MAJ mise à jour. **Non mis à jour** : des exemples de code historiques
  citent encore isomorphic-git dans `SPEC-ELECTRON-DESKTOP` (lignes ~242, 278, 464, 2590, 2757, 2846,
  2870). À reprendre.

## Mesures

### Installeur

`Polenta-Setup-0.5.0-alpha.55.exe` : **227 Mo**, contre 137,5 Mo pour la v0.5.0, soit **+89,6 Mo**.
Seuil : +120 Mo. **Tenu.**

### Checkout (application installée, médiane de 5 aller-retours)

| Dépôt | Écriture Polenta | Git natif | Isomorphic-git (sprint 0) |
|---|---|---|---|
| handstickProduct (504 fichiers) | 660 à 787 ms | 1 200 à 1 618 ms | 1 678 ms |
| polenta-official | **1 605 puis 1 742 ms** | 8 125 à 11 892 ms | 1 506 ms |

- **handstickProduct : seuil tenu**, sans régression.
- **polenta-official : seuil non tenu**, de façon stable. Cible : 1 657 ms (1 506 + 10 %). Mesures
  au-dessus, avec une variance d'environ 8 % entre deux séries.
- Le chiffre isomorphic-git (1 506 ms) date du sprint 0 et n'a **pas** été re-mesuré dans la même
  session. C'est la principale réserve sur la comparaison.
- **Décision de l'humain (2026-11-19) : écart accepté et documenté.** Pas de changement de la spec.

Ce qui a été fait pour réduire le surcoût : diff des arbres en JavaScript (récursion seulement sur les
sous-arbres modifiés), blobs par le `cat-file` persistant, index mis à jour par `update-index
--index-info` au lieu de `read-tree` plus `update-index --refresh`. Résultat : 8 processus git par
checkout au lieu de 5 (voir sprint 4 partie agent, trace). Il reste 2 processus de plus à supprimer
(`config`, `check-attr`) : non tentés.

### Lancements de git

Non mesurés pour ce sprint (la suite n'a pas été instrumentée à la fin).

## Vérifications

- `pnpm typecheck` : 0 erreur.
- Suite unitaire : **191 fichiers sur 191, 2 001 tests verts.**
- E2E web (`pnpm build:web` puis Playwright), série de 7 specs :
  - 28 réussies, 2 échecs, 3 non lancées.
  - **`gh222-diff-edit` 15/16** : échec connu, déjà présent sur main dans les séries du sprint 3.
    Passe seul sur la branche.
  - **`gh222-tree-merge` R8** (« finaliser après une résolution en Rendu ») : échoue **seul**, sur la
    branche **et sur main**, avec les mêmes valeurs (`droite` / `10` au lieu de `gauche` / `42`). Passe
    dans la série sur main. **Pré-existant, dépendant de l'ordre d'exécution, pas de la migration.**
    À traiter séparément.
  - `gh367-remote-branches` : échoue seul sur main, passe seul sur la branche (sprint 3).
- **Non lancé** : specs desktop `gh238` et `gh342` (sprint 3 et 4 n'y touchent pas directement),
  et la suite e2e complète (niveau 3, au merge sur main après validation).
- **Revue de code** : non lancée.

## Points à trancher à la validation finale

1. **Exception anti-import** : `scripts/app-version.ts` lance `git describe` au build. **Décidé
   (2026-11-19) : exception gardée**, documentée dans `no-direct-git.gh337.test.ts` (script de build,
   hors application livrée). Rien d'autre à changer.
2. **Askpass côté terminal** (sprint 3, écart 6) : **câblé (2026-11-19)**. Voir « Suite : sprint 5 »
   ci-dessous.
3. **Test du délai réseau natif** (sprint 3, écart 7) : **couvert (2026-11-19)** par
   `git/network-timeout.gh337.test.ts`. Voir « Suite : sprint 5 ».
4. **Checkout polenta-official** : écart accepté (voir Mesures). À reconfirmer après relecture.
5. **R8 et gh222-diff-edit** : échecs e2e antérieurs à GH337, à traiter dans un ticket séparé.
6. **Spec historique** : exemples de code à mettre à jour dans `SPEC-ELECTRON-DESKTOP`.

## Suite : sprint 5 (2026-11-19)

**Askpass côté terminal (spec §6, écart 6 du sprint 3).**

- `askpass.ts` : `CredentialResolver` reçoit l'invite. `hostFromPrompt` lit l'hôte dans
  `Password for 'https://user@host': ` (sans port ni identifiant). `terminalCredentials(lookup)` appelle
  `auth.getHttpsCredentials` pour cet hôte. `openAskpassSession(resolve, 'terminal')` : pas de
  `SSH_ASKPASS` (le terminal garde `ssh` interactif).
- `ELECTRON_RUN_AS_NODE=1` n'est plus dans l'environnement : `askpass.sh` le pose pour son seul
  processus. Le shell du terminal ne le reçoit donc pas (il filtre déjà `ELECTRON_*`).
- `terminal.service.ts` : chaque session ouvre son nonce (`'terminal'`), l'environnement du shell reçoit
  `POLENTA_ASKPASS_*` et `GIT_ASKPASS` après filtrage (`shellEnv(…, extra)`). Le nonce est révoqué au
  `kill`, à la fin du shell, et si le lancement échoue. `start` devient asynchrone (ouverture du pipe).
  `TerminalDeps` (`auth`, `spawnPty`, `shell`) est injectable pour les tests.
- Tests : `services/terminal-askpass.gh337.test.ts` (faux pty, vrai `askpass.sh` lancé par le `sh` de
  Git for Windows) : (1) aucun PAT dans l'environnement du shell ; (2) hôte extrait d'une invite ; (3) hôte
  inconnu ou pas de compte : réponse vide ; (4) nonce refusé après fin de shell et après `kill`.
- **Choix non prévu par la spec** : le nonce terminal n'a **pas** le plafond de 6 réponses des
  opérations (il vit toute la session, un `push` par invite consommerait sinon le quota). Les réponses
  restent bornées par la durée de la session.
- **Restreint à l'hôte du dépôt (décision de l'humain, 2026-11-19, point 1 de la question du jeton)** : le
  nonce du terminal ne répond plus que pour les hôtes des remotes du dépôt ouvert dans le terminal (le
  dossier de départ du shell). À l'ouverture de la session, `remoteHostsOf(dir)` (`terminal.service.ts`)
  calcule cet ensemble : `rev-parse --git-dir` (hors dépôt : ensemble vide, pour ne pas lire la config
  globale), puis `gitFor(dir).remotes()`, chaque URL réduite à son hôte par `hostFromRemoteUrl`
  (`askpass.ts` : sans schéma, identifiant ni port ; forme scp `git@hôte:chemin` acceptée ; chemins locaux
  ignorés). `terminalCredentials(lookup, allowedHosts)` n'appelle `auth.getHttpsCredentials` que pour un
  hôte de cet ensemble ; une invite pour un autre hôte, ou dans un dossier sans dépôt, reçoit une réponse
  vide, comme un hôte inconnu.
- **Limite résiduelle** : le nonce reste dans l'environnement du shell. Un programme lancé dans le terminal
  peut donc interroger `askpass.js` avec une invite forgée et obtenir les identifiants du compte connecté
  pour un hôte **du dépôt** ouvert. La restriction borne l'exposition aux hôtes du dépôt, elle ne la supprime
  pas ; c'est la conséquence de la décision du §6 (nonce de session).
- Non vérifié : un vrai `git push` depuis le terminal vers une forge (aucun serveur HTTP authentifié en
  test). Le chemin git complet n'est couvert que pour les opérations (`network.gh337.test.ts`).

**Délai réseau natif (GH15, écart 7 du sprint 3).**

- `netRun` reçoit déjà `timeoutMs` par `NetworkOptions` : aucune modification de production.
- `git/network-timeout.gh337.test.ts` : serveur HTTP muet sur `127.0.0.1` (port libre), délai de
  1,5 s. `ls-remote`, `fetch` et `clone` s'arrêtent avec une `GitError` de kind `timeout`, en moins de 20 s,
  et `liveProcessCount()` revient à 0.
- **Message clair (point 2 de la suite sprint 5)** : `GitError` de kind `timeout` (toutes origines : délai
  de `netRun`, ou classement du stderr « timed out ») a pour message « le serveur Git n'a pas répondu dans le
  délai imparti (opération : fetch) ». Le kind ne change pas ; le stderr reste dans `err.stderr`. Le test
  `network-timeout.gh337.test.ts` vérifie le message exact pour `ls-remote`, `fetch` et `clone`.

**Vérifications (sprint 5)**

- `pnpm -s typecheck` : 0 erreur.
- `npx vitest run src/main/git src/main/services/terminal src/main/services/sync` : 17 fichiers, 154 tests verts.
- `npx vitest run` (suite complète) : 193 fichiers, 2 014 tests verts.
- E2E desktop `gh238` (`pnpm test:e2e:desktop -g GH238`) : **4 réussis, 4 échecs** (E5, E6, GH345, E7).
  Le même lot sur la branche **sans** ce diff (stash) donne les mêmes 4 échecs : pas causé par ce sprint.
  E1 à E4 (ouverture du shell avec l'environnement askpass) passent. Non établi : si ces 4 échecs existent
  déjà sur `main` (la branche a changé le terminal au sprint 3). Un processus `sleep.exe` a survécu à la
  fermeture du shell dans E5 : à qualifier.

## Décisions de la revue (2026-11-19)

**P7 — sortie git partielle : acceptée.** `git/git-runner.ts`, `spawnGit` : après la fin de git, les
tuyaux sont fermés au bout de 500 ms s'ils ne sont pas vidés, et l'appel se résout avec ce qui a été lu.
La sortie peut donc être **partielle** si les tuyaux ne sont pas vidés à temps sous Windows. Le risque est
accepté par l'humain ; la cause (héritage de tuyaux par un autre processus) est connue
(`tasks/lessons.md`, 2026-11-18). Le code de vidage n'a pas changé. **À réouvrir si un bug de données
tronquées est observé.**

**P3 — identité Git du PC : lue en repli.** La config git de Polenta reste isolée (`GIT_CONFIG_GLOBAL`,
`GIT_CONFIG_NOSYSTEM=1`). L'identité globale du PC n'est lue que par `pcGitIdentity()` (`git/git-config.ts`),
avec un processus `git config --global` ponctuel, les `GIT_CONFIG_*` de Polenta retirés. Ordre de repli :
1. identité du dépôt (`.git/config`, effective) ;
2. compte actif de Polenta (`[user]` de la config globale de Polenta, et les comptes de `getAuthor`) ;
3. identité globale du PC.

Trois usages : `getAuthor` (`auth.service.ts`, après la config du dépôt, avant l'auteur par défaut),
`gitUserName` (`results-import.service.ts`, champ `executedBy`), et le terminal (`terminal.service.ts`) :
pour chaque clé `user.name` / `user.email` absente du dépôt et du compte actif, la valeur du PC passe par
`GIT_CONFIG_COUNT` dans l'environnement du shell. Une clé déjà présente n'est jamais remplacée.
Le compte actif règle `[user]` de la config globale de Polenta à chaque changement de compte
(`AuthService.saveAccount` et `logout` appellent `syncGitIdentity`, qui appelle `refreshGitIdentity`),
et plus seulement au démarrage (`initGitHome`). Sans compte : pas de `[user]`.
Test de la variable : `POLENTA_TEST_PC_GITCONFIG` (chemin d'une config globale temporaire) ; le
`~/.gitconfig` réel n'est jamais lu par les tests. Tests : `git/git-identity.gh337.test.ts` (5),
`services/auth-git-identity.gh337.test.ts` (1).

**P9 — `safe.directory = *` : gardé, risque documenté.** `git/git-config.ts`, `renderGitConfig` : inchangé,
le commentaire explique pourquoi `*` (dépôts créés par un autre compte Windows ou sur un partage réseau,
spec §2.2 ; `gitFindRoot` découvre le dépôt avant de pouvoir le lister), le risque (CVE-2022-24765 : un
dépôt appartenant à un autre utilisateur peut déclencher des commandes via sa config locale) et la décision
de l'humain du 2026-11-19. Restreindre la liste par dépôt si la décision change.

**P1 — shims askpass dans l'image du serveur web : corrigé.** Les shims sont dans `src/main/git/askpass/`,
et `apps/desktop/Dockerfile.web` ne copiait pas `src/`. Correction :
- `Dockerfile.web` (phase de build) : `mkdir -p /out/app/resources/git && cp -r src/main/git/askpass /out/app/resources/git/`,
  puis `COPY --from=build /out/app /app` place les shims en `/app/resources/git/askpass`, et
  `POLENTA_WEB_RESOURCES_DIR=/app/resources` les désigne.
- `git/askpass.ts`, `askpassDir()` : cherche aussi `POLENTA_WEB_RESOURCES_DIR/git/askpass` (après
  `process.resourcesPath`, avant la remontée depuis `__dirname`).
- Test : `git/askpass-web-image.gh337.test.ts` (3) : lit la copie et la variable dans `Dockerfile.web`,
  vérifie qu'elles désignent le même chemin, reproduit la copie dans un dossier temporaire et vérifie
  qu'`askpassDir()` le trouve avec la seule variable d'environnement.
- **Non vérifié** : l'image Docker elle-même n'a pas été construite (pas de reconstruction demandée) ; le
  test vérifie la configuration de build et le chemin d'exécution, pas le contenu réel de l'image.
