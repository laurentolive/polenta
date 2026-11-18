# GH337 — Design : git natif embarqué, suppression d'isomorphic-git

Spec : `specs/GH337.md` (validée le 2026-11-16). Scénarios de test : `specs/GH337-tests.md`.

## 1. Vue d'ensemble

Le nouveau module `apps/desktop/src/main/git/` est la seule porte vers git. Il est utilisé par le
main process, le serveur MCP, le CLI et le serveur web, qui partagent tous les mêmes services.

```
services (sync, git, workspace, merge-resolution, …)
        │  GitBackend (API métier typée, une instance par dépôt)
        ▼
git/ ── git-backend.ts      opérations : lectures, écritures, fusion, réseau
     ── git-runner.ts       processus ponctuels, file d'écriture par dépôt, erreurs typées
     ── cat-file-batch.ts   processus persistant `cat-file --batch-command`
     ── process-registry.ts suivi et arrêt des processus (fermeture du dépôt, de l'app, de la session web)
     ── git-binary.ts       résolution du binaire, version minimale, environnement isolé
     ── git-config.ts       <userData>/git/config + dossier de hooks vide
     ── askpass.ts          serveur d'identifiants (pipe nommé / socket unix) + shim askpass
     ── git-errors.ts       GitError { kind, stderr, … } et classement
```

En dehors de `git/`, aucun fichier n'importe `isomorphic-git` ni ne lance `git`. Une règle
`no-restricted-imports` d'ESLint l'impose, et un test vérifie qu'aucun appel
`execFile|spawn('git'` ne se trouve hors de `git/`, les tests et les e2e mis à part.

## 2. Binaire et environnement (`git-binary.ts`, `git-config.ts`)

### 2.1 Résolution

`resolveGit(): { gitDir, gitExe, bashExe | null, sshExe | null, version }`, évalué une fois puis mis en
cache :
1. `POLENTA_GIT_DIR` s'il est défini (racine d'une installation au format PortableGit, ou préfixe
   Unix) ;
2. en app packagée, `process.resourcesPath/git` ;
3. en dev et pour les tests, `apps/desktop/vendor/git` (ignoré par git, rempli par
   `pnpm git:fetch`) ;
4. hors Windows uniquement, le `git` du `PATH` (Docker, CI Linux). Sous Windows, il n'y a pas de
   repli : `GitUnavailableError`, avec un message qui donne la commande `pnpm git:fetch` en dev.

Sous Windows : `gitExe = <gitDir>/cmd/git.exe`, `bashExe = <gitDir>/bin/bash.exe`,
`sshExe = <gitDir>/usr/bin/ssh.exe`. Le serveur MCP et le CLI tournent avec `ELECTRON_RUN_AS_NODE` :
ils retrouvent `resourcesPath` comme aujourd'hui pour `extraResources`. Le serveur web (Docker) passe
par le cas 4.

**Version** : `git version` est lu au premier appel. En dessous de 2.38, `GitUnavailableError`
(« git ≥ 2.38 requis, trouvé X ») est levée, journalisée une fois et propagée à chaque opération.

### 2.2 Environnement isolé

`gitEnv(opts)` part de `process.env`, retire `GIT_*` hérités (sauf `GIT_TRACE*` en dev), puis pose :

| Variable | Valeur |
|---|---|
| `GIT_CONFIG_NOSYSTEM` | `1` |
| `GIT_CONFIG_GLOBAL` | `<userData>/git/config` (`<dataDir>/git/config` pour le serveur web, par utilisateur) |
| `GIT_TERMINAL_PROMPT` | `0` (sauf terminal) |
| `GIT_ASKPASS`, `SSH_ASKPASS`, `POLENTA_ASKPASS_*` | §6 |
| `GIT_ALLOW_PROTOCOL` | serveur web : `https` ; desktop : `https:http:ssh:file` |
| `LC_ALL`, `LANGUAGE` | `C` (messages en anglais pour le classement des erreurs) — sauf terminal |
| `GIT_OPTIONAL_LOCKS` | `0` pour les lectures (le statut ne prend pas `index.lock`) |
| `PATH` | `<gitDir>/cmd` en tête, ainsi que `<gitDir>/usr/bin` sous Windows (ssh) |

Le fichier `<userData>/git/config`, écrit par `git-config.ts` au démarrage puis à chaque changement de
compte actif, contient :

```
[core]  autocrlf = false ; safecrlf = false ; longpaths = true ; hooksPath = <userData>/git/hooks (vide) ; fsmonitor = false
[credential] helper =            # chaîne vide : désactive tout helper
[commit] gpgSign = false
[tag]    gpgSign = false
[init]   defaultBranch = main
[user]   name = <compte actif> ; email = <compte actif>
[safe]   directory = *           # dépôts créés par un autre compte Windows ou sur un partage réseau
[http]   lowSpeedLimit = 1 ; lowSpeedTime = <300 × facteur GH15>
```

Polenta passe en plus l'auteur de chaque commit par `-c user.name=… -c user.email=…`. Le fichier
global ne sert donc vraiment qu'au terminal.

## 3. Exécution (`git-runner.ts`, `process-registry.ts`)

- `run(repo, args, { stdin?, write?, timeoutMs?, env?, signal? }) → { stdout: Buffer, stderr: string }`.
  Les appels utilisent `spawn` sans shell, avec `windowsHide: true`. La sortie est lue en `Buffer`,
  puis découpée avec `-z` partout où git le permet.
- **File d'écriture par dépôt** : les appels `write: true` (tout ce qui prend `index.lock` ou écrit
  des refs) passent un par un, dans une chaîne de promesses par chemin de dépôt normalisé. Les
  lectures ne sont pas mises en file. Le module `git-lock-limits.ts` et le paquet `async-lock`, s'il
  n'a plus d'usage, sont supprimés.
- **Erreurs** : `GitError { kind, args, exitCode, stderr }`, où `kind` vaut `not-found`,
  `conflict`, `local-changes`, `non-fast-forward`, `auth`, `network`, `timeout`, `lock` ou `other`.
  Le classement se fait sur le stderr en `LC_ALL=C`. Les classes d'erreurs métier existantes
  (`LocalChangesError`, `MergeConflictError` côté services, `describeTimeout`,
  `isNetworkUnreachable`) sont construites à partir de `kind`.
- **`process-registry`** : enregistre chaque enfant, ponctuel ou persistant. `closeRepo(path)` arrête
  les persistants d'un dépôt ; `closeAll()` est appelé sur `will-quit` (desktop), à l'arrêt du
  serveur web et à la fin d'une session utilisateur. Sous Windows, un enfant réseau (git lance
  `git-remote-https` et `ssh`) est arrêté par `taskkill /T /F /PID`. Le délai d'une opération
  ponctuelle (`timeoutMs`, réseau) déclenche le même arrêt.

### 3.1 `cat-file --batch-command` persistant

- Un processus par dépôt, lancé paresseusement et arrêté après 60 s sans requête, ou par
  `closeRepo`.
- Commandes `info <rev>` et `contents <rev>`, où `<rev>` vaut `oid`, `ref` ou `rev:path`. La
  résolution de ref passe par `info` (oid + type) : un `missing` renvoie `null`.
- Les requêtes sont mises en file et traitées une par une. La réponse est lue en `Buffer` sur la
  longueur annoncée, plus le saut de ligne final.
- Si le processus meurt (exit, EPIPE), il est relancé et la requête en cours est rejouée une fois.
  Un deuxième échec la rejette (`GitError other`).
- **Cohérence** : `cat-file` lit les refs à chaque commande (pas de cache de refs). Après une
  écriture faite par Polenta dans un dépôt, aucune invalidation n'est nécessaire.

Les autres persistants envisagés par l'issue (`check-ignore`, `check-attr`, `hash-object`,
`update-ref --stdin`) ne sont pas créés à l'avance. Leurs usages passent par un appel ponctuel
groupé (`check-ignore --stdin -z` avec la liste complète, `update-ref --stdin` pour une transaction).
Le spike mesure ; un persistant n'est ajouté que si un chemin chaud le justifie (alternative
rejetée §11).

## 4. API `GitBackend`

`gitFor(repoPath): GitBackend`, mis en cache par chemin. Méthodes (les oid sont des sha-1 complets) :

**Lectures**
- `resolve(rev): Promise<string | null>` ; `resolveOrThrow(rev)` ; `objectType(rev)`
- `currentBranch(): Promise<string | null>` (`symbolic-ref -q --short HEAD`, `null` en tête détachée)
- `readBlob(rev): Promise<Buffer | null>` ; `readText(rev, path)` (`rev:path`)
- `readCommit(oid) → { oid, tree, parents, author{name,email,timestamp,tzOffset}, committer, message }`
- `readTag(oid) → { object, type, tag, tagger, message }`
- `lsTree(rev, { prefix?, recursive? }) → { mode, type, oid, path }[]` (`ls-tree -z --full-tree`)
- `log(rev | rev[], { limit?, paths?, firstParent? }) → CommitInfo[]` (`log -z --format=…`)
- `fileHistories(rev, prefixes) → Map<path, FileHistory>` : un seul
  `log --name-status -z --format=…`, qui remplace la marche commit par commit (`fileHistory`,
  `auditDatesFromHistory`, GH340)
- `refs(patterns) → { ref, oid, peeled?, upstream?, symref? }[]` (`for-each-ref`) : branches,
  tags et remotes
- `remotes() → { name, url }[]` ; `config(key)`
- `isAncestor(a, b)` (`merge-base --is-ancestor`) ; `mergeBases(a, b): string[]` (`--all`)
- `diffNames(a, b, { prefixes? }) → { path, status: A|M|D|R, oldPath? }[]` (`diff-tree -r -z -M`)
- `status({ prefixes?, ignored? }) → StatusEntry[]` : `status --porcelain=v2 -z
  --untracked-files=all`, avec `{ path, index, worktree, origPath? }`. **C'est la seule définition de
  « modification locale »** (GH336 C), utilisée par le panneau Version, le checkout, le merge, le pull
  et Publier.
- `checkIgnore(paths): Set<string>` ; `lsFiles({ prefixes? })`
- `findRoot(path)` (`rev-parse --show-toplevel`) ; `isRepo(path)`

**Écritures locales** (toutes `write: true`)
- `init({ initialBranch })` ; `addRemote(name, url)` ; `setConfig(key, value)` (config locale du
  dépôt)
- `add(paths)` ; `addAll()` ; `remove(paths, { cached })` ; `resetPaths(paths)` (unstage) ;
  `restore(paths)` (discard, `restore --source=HEAD --staged --worktree`)
- `commit({ message, author, allowEmpty?, paths? }) → oid` (`commit -F -`, avec `--only -- paths`
  pour `commitSingleFile`)
- `commitTree(tree, parents, message, author) → oid` ; `writeTree()`
- `updateRefs(ops: { ref, newOid | null, oldOid? }[])` : transaction `update-ref --stdin -z`
- `createBranch(name, start)` ; `deleteBranch(name, { force })` ; `tag(name, target)` ;
  `annotatedTag(name, target, message, tagger)` ; `deleteTag(name)`
- `checkout(rev, { detach?, create? })` : fichiers écrits par Polenta (`node-checkout.ts`, Defender
  épargné, GH337-sprint0.md § Essai), repli sur `git checkout` hors du chemin simple ;
  `resetHard(rev)` ; `resetSoft(rev)`
- `mergeFastForward(target)` (`merge --ff-only`)

**Fusion**
- `mergeTree(ours, theirs) → { clean: true, tree } | { clean: false, tree, conflicts: string[] }`,
  via `merge-tree --write-tree -z --name-only --no-messages`. Exit 1 signale un conflit ; la liste
  des chemins est dédoublonnée. git gère lui-même l'histoire croisée (base virtuelle récursive).
- `displayBase(a, b) → oid | null` : ancêtre commun unique pour l'éditeur de résolution GH37. Il
  vaut l'unique `mergeBases` s'il n'y en a qu'un. Avec plusieurs bases, `mergeTree` des bases deux à
  deux crée un commit non référencé ; en cas de conflit entre bases, on se replie sur `mergeBases`
  de ces bases, comme le fait aujourd'hui `singleMergeBase`.

**Réseau** (`write: true`, délai réseau, identifiants §6)
- `clone(url, dir, { branch?, depth?, onProgress? })` : `clone --progress`, avec la progression lue
  sur le stderr
- `lsRemoteHeads(url) → string[]`
- `fetch(remote, { prune? })` ; `push(remote, refspecs: string[], { force? })`, où un refspec
  `:refs/heads/x` supprime
- Chaque appel réseau : `checkRemote(url)` d'abord (garde du serveur web), `-c http.proxy=…` si le
  proxy est résolu par Chromium sans variable d'environnement (`resolveProxyDispatcher` → URL),
  délai `timeoutMs = 300 s × facteur GH15` côté runner.

## 5. Migration des services

| Fichier | Devenir |
|---|---|
| `git.service.ts` | garde son API publique ; les corps passent sur `GitBackend` (`fileHistory` et `auditDatesFromHistory` via `fileHistories`) |
| `sync.service.ts` | tout sur `GitBackend` ; suppression du double chemin SSH (`isHttpRemote`, `execFileAsync`) ; `status` via `status()` ; `graph` via `log` ; `rebase` via `run` (seul usage, garde `--abort`) |
| `merge-resolution.service.ts` | `git.walk` des trois arbres remplacé par `diffNames(base, left)` ∪ `diffNames(base, right)` puis `readBlob(rev:path)` ; finalisation via `commitTree` + `updateRefs`/`checkout` |
| `recursive-merge.util.ts` | **supprimé** : `mergeRecursive` devient `mergeTree` + `commitTree` + mise à jour de la branche (`mergeFastForward` si c'est la branche courante, sinon `updateRefs`) ; `singleMergeBase` devient `displayBase` |
| `safe-checkout.util.ts` | réécrit, en gardant `LocalChangesError` et la mise de côté des fichiers d'état local (Q1 GH336). Un contrôle préalable par `status()` refuse en nommant les fichiers modifiés. Le refus de git pour un « untracked working tree file would be overwritten » est analysé et donne `LocalChangesError`. Les contournements des fins de ligne disparaissent |
| `racy-status.util.ts`, `eol-status.util.ts` | **supprimés** (git gère les cas racy et `.gitattributes`). `addKeepingEol` devient `add` |
| `git-lock-limits.ts`, `git-http.ts` | **supprimés** (file par dépôt §3 ; proxy et délais §4). `net-proxy.ts` et `net-timeouts.ts` restent pour `forge-http` |
| `read-file-at.util.ts` | sur `readText` |
| `workspace.service.ts`, `schema.service.ts` | `init`, `add`, `commit`, `remotes`, `resolve` |
| `workspace-tree.service.ts`, `integration-branch.service.ts`, `baseline.service.ts`, `repo-conformity.service.ts` | sur `GitBackend` (refs, `isAncestor`, `updateRefs`, `lsFiles`, `remove`) |
| `results-import.service.ts` | `findRoot`, `config('user.name')` (plus de `execFile('git')`) |
| `auth.service.ts`, `forge/*.service.ts` | `remotes()`, `addRemote`, `currentBranch`, `checkIgnore` ; `repo-settings` via `status()` |
| `ipc/index.ts` | `log` via `GitService`/`GitBackend` ; `safeCheckout` inchangé dans son principe |
| `web-server/hardening.ts` | commentaires mis à jour ; `GIT_ALLOW_PROTOCOL=https` |
| `terminal.service.ts`, `terminal-shell.util.ts` | §7 |
| `scripts/forge-smoke.ts` | sur `GitBackend` |

Les signatures publiques des services et des canaux IPC ne changent pas. Le renderer n'est pas
touché, sauf pour le terminal (§7 : retrait de l'invitation winget).

## 6. Identifiants (`askpass.ts`)

- **Serveur d'identifiants** dans le process hôte (main Electron ou serveur web) : un pipe nommé
  `\\.\pipe\polenta-askpass-<aléa>` sous Windows, une socket unix en `0600` sous Linux.
- Chaque opération réseau enregistre un **jeton à usage limité** (nonce aléatoire de 32 octets) qui
  mène à `{ username, password }`, résolus par `auth.getHttpsCredentials(url)`. Le jeton est retiré à
  la fin de l'opération. Le processus git reçoit `POLENTA_ASKPASS_PIPE` et `POLENTA_ASKPASS_NONCE`,
  jamais le PAT.
- **Shim** `git/askpass/askpass.sh` (exécuté par le `sh` de git sous Windows comme sous Linux) :
  `exec "$POLENTA_NODE" "$POLENTA_ASKPASS_JS" "$@"`, avec `ELECTRON_RUN_AS_NODE=1`. Le petit script
  `askpass.js` (sans dépendance, hors asar) se connecte au pipe, envoie `{ nonce, prompt }` et écrit
  la réponse : `Username…` donne `username`, `Password…` donne `password`.
- **Terminal** : sa session reçoit un nonce de type « session terminal ». Le serveur extrait alors
  l'hôte de l'invite (`Password for 'https://user@host': `) et résout les identifiants du compte
  connecté pour cet hôte (décision 1 du STOP). Le nonce est révoqué à la fermeture de la session.
- Réponse vide quand rien n'est connu : git échoue en `auth`, avec le même message qu'aujourd'hui.
- SSH : `GIT_SSH_COMMAND="<sshExe> -o BatchMode=yes -o ConnectTimeout=<délai>"` pour Polenta. Le
  terminal garde `ssh` interactif.

## 7. Terminal GH238

- `resolveShell` choisit d'abord le `bashExe` embarqué (`bin/bash.exe --login -i`) sous Windows. Les
  shells du PC ne restent qu'en repli hors Windows. L'état `not-found` et le bouton d'installation
  winget sont retirés, côté main et côté renderer.
- `shellEnv` = `gitEnv({ terminal: true })` : `PATH` avec le git embarqué en tête, config isolée
  identique, askpass « session terminal », `GIT_TERMINAL_PROMPT` non forcé, locale de l'utilisateur.
  `HOME` reste inchangé, si bien que `~/.ssh` et `~/.bashrc` restent ceux de l'utilisateur.
  L'éditeur des commits du terminal reste celui de l'utilisateur (`vim` est inclus dans
  PortableGit).

## 8. Packaging

- **`scripts/fetch-git.ts`** (`pnpm git:fetch`) : télécharge `PortableGit-<v>-64-bit.7z.exe` depuis la
  release Git for Windows fixée dans `scripts/git-version.json` (`{ version, url, sha256 }`), vérifie
  le SHA-256 et l'extrait avec `-y -o<dest>` (archive auto-extractible, Windows seulement), puis
  **élague** selon la liste `scripts/git-prune.txt` : `mingw64/share/doc`, `mingw64/share/gitk`,
  `mingw64/lib/tcl*`, `mingw64/lib/tk*`, `mingw64/bin/wish*`, `mingw64/bin/tcl*`, `git-gui`,
  `mingw64/share/git-gui`, `usr/share/doc`, `usr/share/man`, `usr/share/info`, locales sauf `fr`/`en`,
  `git-bash.exe`, `git-cmd.exe`, `post-install.bat`… La liste exacte est fixée au spike, avec deux
  garde-fous : `git`, `bash`, `ssh`, `vim`, `less` et `perl` doivent démarrer (les commandes
  `add -p` et `send-email` utilisent perl, que l'élagage garde). Destination : `apps/desktop/vendor/git`.
  Il est idempotent, avec un marqueur `<dest>/.polenta-git-version`.
- `pnpm install` ne déclenche **pas** le téléchargement (CI Linux, Docker). La CI Windows
  (`release.yml`) et le premier lancement en dev Windows le font, avec un message clair si `vendor/git`
  manque.
- `electron-builder.config.ts` : `extraResources` reçoit `{ from: 'vendor/git', to: 'git' }` (Windows),
  ainsi que `git/askpass/` (le shim et `askpass.js`).
- `Dockerfile.web` : `apt-get install -y --no-install-recommends git openssh-client` (bookworm, 2.39).
- `THIRD-PARTY-NOTICES.txt` : section Git for Windows (GPLv2, LGPL, MSYS2…), avec le lien vers les
  sources de la version fixée.
- `.gitignore` : `apps/desktop/vendor/`.

## 9. Fins de ligne et clones existants

Le `.gitattributes` de chaque repo (#336) fixe la règle, et `core.autocrlf=false` dans la config
isolée. Pour un clone existant dont des fichiers sont en CRLF sur disque alors qu'ils sont en LF dans
git, le statut natif ne les voit pas modifiés tant que `.gitattributes` impose `eol=lf` et que l'index
est à jour. Mais git peut en signaler certains après un `touch`. **Normalisation unique** à
l'ouverture du dépôt (`repo-conformity.service.ts`, déjà chargé de la mise en conformité #336) : pour
chaque fichier que `status()` voit modifié et dont le contenu ne diffère du blob de HEAD que par les
fins de ligne, le contenu de HEAD est réécrit sur disque. Aucun commit n'est créé, et un fichier
réellement modifié n'est jamais touché.

## 10. Découpage en sprints

| Sprint | Périmètre | Fin de sprint |
|---|---|---|
| **0 — Spike** | `fetch-git.ts` + élagage ; `git-binary`, `git-config`, `git-runner`, `cat-file-batch`, `process-registry` ; `scripts/bench-git.ts` (iso contre natif : statut propre et modifié, lecture de tous les fichiers à HEAD, historique par fichier, checkout aller-retour, ouverture du workspace) ; installeur construit sur `main` et sur la branche | Mesures dans `GH337-sprint0.md`, comparées aux seuils de la spec §8. Arrêt humain si un seuil est dépassé |
| **1 — Lectures** | `GitBackend` lectures ; migration des lectures de `git.service`, `sync.service` (status, graph, diff, commitFiles, resolveRefs, tags, branches, integrationState en lecture), `baseline`, `workspace-tree`, `integration-branch`, `read-file-at`, `repo-conformity`, `results-import`, `auth`, `forge/*`, `ipc` ; suppression de `racy-status` | Tests unitaires du backend + tests existants verts |
| **2 — Écritures locales** | add/remove/restore/commit/commitTree/updateRefs/branch/tag/checkout/reset/init/addRemote/setConfig ; `safe-checkout` réécrit ; suppression de `eol-status` et `git-lock-limits` ; normalisation §9 | idem + scénarios de config hostile |
| **3 — Réseau, fusion, terminal** | askpass ; clone, fetch, push, pull, lsRemote ; suppression du double chemin SSH ; `mergeTree`, `displayBase`, fusions de `sync` et de `merge-resolution`, suppression de `recursive-merge` et `git-http` ; terminal §7 ; Docker ; hardening web ; arrêt des processus | idem + e2e ciblés web (gh37, gh222, gh332, gh335, gh336) et desktop (gh238, gh342) |
| **4 — Suppression** | 34 tests et `e2e-web/gh222-tree-merge.spec.ts` réécrits avec un helper de fixtures natif (`git/test-repo.test-util.ts`) ; `forge-smoke.ts` ; retrait de `isomorphic-git` (et `async-lock`) de `package.json`, `pnpm-lock.yaml`, `electron.vite.config.ts` ; règle ESLint + test anti-import ; notices ; mises à jour SPEC (§ Refs SPEC) ; mesures finales | Niveau 2 complet ; puis validation finale |

Tant que la branche n'a pas atteint le sprint 4, les tests existants gardent leurs fixtures
isomorphic-git : ce sont de vrais dépôts git, que le backend natif lit sans problème.

## 11. Décisions techniques et alternatives rejetées

- **dugite / MinGit** : rejeté par l'humain (2026-11-16), car le terminal resterait dépendant du Git
  Bash du PC et donc d'une seconde config.
- **Bibliothèque d'exécution (`simple-git`, `dugite` en tant que runner)** : rejetée, car c'est une
  dépendance de plus pour un `spawn`, sans persistants ni file par dépôt.
- **Tous les persistants de l'issue dès le départ** : seul `cat-file --batch-command` est créé. Les
  autres sont des appels groupés, ajoutés en persistant seulement si le spike montre un chemin chaud.
  Chaque persistant ajoute un état à gérer (relance, arrêt sous Windows).
- **PAT dans l'environnement du processus git** (askpass qui ferait `echo $POLENTA_PASSWORD`) :
  rejeté. L'environnement est lisible par les outils du même utilisateur, et le terminal ne connaît
  pas d'avance l'hôte visé. Le serveur à jetons couvre les deux cas.
- **`merge-tree --merge-base`** (git ≥ 2.40) pour imposer une base : inutile, git gère lui-même la
  base virtuelle. La base d'affichage GH37 se calcule sans cette option, ce qui garde le minimum à
  2.38 et rend compatible le git 2.39 de Debian bookworm.
- **Télécharger git au premier lancement** au lieu de l'embarquer : rejeté, car les postes clients
  ont un accès réseau restreint (proxy, GFW, GH15).

## 12. Risques

- **Antivirus Windows et temps de démarrage d'un processus** (~35 ms mesurés) : on regroupe les
  appels et on utilise `cat-file` persistant. Le spike mesure l'ouverture du workspace.
- **Messages de git analysés** pour le classement des erreurs : `LC_ALL=C` et des tests de classement
  par `kind`, avec la version de git fixée.
- **Chemins longs Windows** : `core.longpaths=true`.
- **Taille** : élagage, seuil de 120 Mo (spec §8).
