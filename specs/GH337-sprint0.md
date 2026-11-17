# GH337 — Sprint 0 (spike) : résultats

Spec : `specs/GH337.md` §8 (seuils). Design : `specs/GH337-design.md` §10.

## Livré

| Fichier | Rôle |
|---|---|
| `apps/desktop/scripts/git-version.json` | PortableGit 2.56.1 (Git for Windows `v2.56.1.windows.1`), URL et SHA-256 |
| `apps/desktop/scripts/fetch-git.ts` (`pnpm git:fetch`) | téléchargement, vérification du SHA-256, extraction dans `vendor/git`, élagage, garde-fous |
| `apps/desktop/scripts/git-prune.txt` | liste d'élagage : Git Credential Manager (.NET/Avalonia), Tcl/Tk, LFS, scalar, docs, locales |
| `apps/desktop/scripts/bench-git.ts` | mesures isomorphic-git contre natif, sur une copie du `.git` |
| `apps/desktop/src/main/git/git-binary.ts` | résolution (`POLENTA_GIT_DIR` → `resources/git` → `vendor/git` → PATH hors Windows), version ≥ 2.38 |
| `apps/desktop/src/main/git/git-config.ts` | config globale isolée, `gitEnv` |
| `apps/desktop/src/main/git/git-runner.ts` | processus ponctuels, file d'écriture par dépôt, délai, arrêt sur `AbortSignal` |
| `apps/desktop/src/main/git/git-errors.ts` | `GitError` + classement par `kind` |
| `apps/desktop/src/main/git/cat-file-batch.ts` | `cat-file --batch-command` persistant (relance, rejeu, arrêt après 60 s d'inactivité) |
| `apps/desktop/src/main/git/process-registry.ts` | suivi, `closeRepo` / `closeAll` qui **attendent** la fin des processus |
| `apps/desktop/src/main/git/git-backend.ts` | API `GitBackend` (lectures, écritures, `mergeTree`, réseau sans askpass) |
| `apps/desktop/src/main/git/*.gh337.test.ts` | 30 tests (B1–B5, P1–P3, P5, P7, P8, L1–L6, L8, E1–E3, E7, E9, F1–F4) |
| `apps/desktop/electron-builder.config.ts` | `win.extraResources` : `vendor/git` → `resources/git` |

## Mesures

Poste de développement Windows 11 avec Windows Defender actif, médiane de 3 passages, sur une
copie du `.git` placée dans `%TEMP%`.

| Opération | handstickProduct iso / natif | polenta-official iso / natif |
|---|---|---|
| 200 × resolve HEAD | 515 / 286 ms | 400 / 172 ms |
| lire tous les fichiers à HEAD | 2 292 / 287 ms | 49 258 / 777 ms |
| statut, arbre propre | 191 / 46 ms | 1 019 / 99 ms |
| historique par fichier (journal complet avec fichiers modifiés) | non relancé (≥ 451 s) / 64 ms | — / 442 ms |
| **checkout aller-retour** | 2 136 / **4 111 ms** | 3 472 / **10 389 ms** |

**Taille de l'installeur** : `Polenta-Setup-0.5.0-alpha.46.exe` pèse 225,1 Mo, contre 137,5 Mo pour la
release v0.5.0, soit **+87,6 Mo**. Le seuil est de 120 Mo. PortableGit occupe 388 Mo extrait, puis
291 Mo après élagage.

**Outils** : git 2.56.1, bash, ssh (OpenSSH 10.6), vim, less et perl démarrent après l'élagage.

## Seuils (spec §8)

| Seuil | Résultat |
|---|---|
| Installeur +120 Mo au plus | ✅ +87,6 Mo |
| Aucune opération plus lente de plus de 10 % | ❌ **checkout aller-retour 1,9× à 3× plus lent** ; tout le reste est 2× à 60× plus rapide |
| ssh et bash démarrent depuis le binaire élagué | ✅ |

## Analyse du checkout

Mesure d'un checkout seul (handstickProduct, 451 fichiers différents d'une branche à l'autre), en
alternant les binaires, avec la même config vide (`GIT_CONFIG_NOSYSTEM=1`) :

| Binaire | Temps par checkout |
|---|---|
| git du PC, `C:\Program Files\Git` (2.51) | 360–890 ms |
| **le même binaire du PC copié dans `%TEMP%`** | 580–5 380 ms |
| git embarqué, `vendor/git` (2.56) | 550–2 540 ms |

- Le lancement d'un processus coûte autant pour les trois (≈ 90 ms).
- `GIT_TRACE_PERFORMANCE` attribue entre 0,4 et 0,6 s à l'écriture des fichiers (`check_updates`).
  Le reste varie d'une exécution à l'autre.
- **Le même binaire copié hors de `Program Files` devient aussi lent que l'embarqué** : la version de
  git n'y est pour rien. Le surcoût suit l'**emplacement de l'exécutable qui écrit**. C'est cohérent
  avec l'analyse en temps réel de Windows Defender, qui serait plus légère pour `Program Files\Git`
  (exclusion ou réputation). Les exclusions ne sont lisibles qu'en administrateur, ce qui n'a pas été
  vérifié.
- Corrections déjà intégrées pendant le spike : `core.fscache`, `core.symlinks=false` et
  `core.preloadIndex` (réglages Windows de la config système de Git for Windows, perdus avec
  `GIT_CONFIG_NOSYSTEM`) ; appel direct de `ucrt64/bin/git.exe` au lieu du lanceur `cmd/git.exe`
  (≈ 70 ms de moins par appel). `checkout.workers=0` (écriture parallèle) ne change pas le résultat.
- **La comparaison avec isomorphic-git est biaisée** : dans le spike, isomorphic-git tourne dans
  `node.exe` (`Program Files\nodejs`), alors que dans Polenta installé il tourne dans `polenta.exe`,
  sous `%LOCALAPPDATA%\Programs`. Ce n'est mesurable que dans l'application installée.

### Mesure dans l'application empaquetée

Même script, exécuté par `dist/win-unpacked/Polenta.exe` (`ELECTRON_RUN_AS_NODE=1`) : isomorphic-git
tourne dans l'exécutable de Polenta, comme chez un client, et le git natif depuis
`win-unpacked/resources/git`.

| Opération | handstickProduct iso / natif | polenta-official iso / natif |
|---|---|---|
| 200 × resolve HEAD | 3 343 / 261 ms | 198 / 170 ms |
| lire tous les fichiers à HEAD | 8 498 / 244 ms | 23 323 / 490 ms |
| statut, arbre propre | 135 / 225 ms | 255 / 47 ms |
| historique par fichier | — / 116 ms | — / 341 ms |
| **checkout aller-retour** | 1 678 / **4 698 ms** | 1 506 / **8 152 ms** |

Dans les conditions réelles, le checkout natif reste **2,8× à 5,4× plus lent** qu'isomorphic-git.
L'hypothèse « l'emplacement pénalise aussi isomorphic-git » est donc écartée : `Polenta.exe` écrit
vite, et ce sont les écritures faites par `git.exe` hors de `Program Files` qui sont lentes,
vraisemblablement à cause de l'analyse de Windows Defender. Le statut du petit dépôt (225 ms contre
46 ms au passage précédent) varie d'un passage à l'autre.

### Emplacement de git.exe et Windows Defender (2026-11-17)

Mesure en console administrateur, ms **par checkout** (médiane, min–max), 5 allers-retours, quatre
binaires alternés, sur des copies du `.git` : handstickProduct (HEAD ↔ premier commit, 504 fichiers)
et PH4, un dépôt C plus gros du poste (TV-2143 ↔ PH_Integration, 1 032 fichiers). Config identique
à celle de Polenta pour tous les binaires (`GIT_CONFIG_NOSYSTEM`, `fscache`, `preloadIndex`).

| Binaire | handstick, Defender normal | handstick, exclusion du processus | PH4, Defender normal | PH4, exclusion du processus |
|---|---|---|---|---|
| git du PC, `Program Files\Git` (2.51) | 266 (189–276) | 257 (212–403) | 1 366 (1 219–1 891) | 1 303 (1 232–1 644) |
| git embarqué copié dans `Program Files\PolentaGitTest` | 674 (298–4 925) | 1 007 (317–1 423) | 4 223 (2 770–11 701) | 7 075 (1 739–10 192) |
| git embarqué dans `%LOCALAPPDATA%\Programs` (cas client) | 402 (214–1 697) | **271 (166–392)** | 2 960 (1 130–6 521) | **1 460 (1 246–2 022)** |
| git embarqué dans `vendor\git` | 1 036 (326–1 365) | 697 (307–1 135) | 4 007 (1 096–9 022) | 3 334 (1 624–3 822) |

La colonne « exclusion » exclut de Defender **le seul** git.exe de `%LOCALAPPDATA%`, de façon
temporaire.

- **Defender est confirmé** : exclu, le git.exe de `%LOCALAPPDATA%` rejoint le git du PC, à quelques
  % près. Les autres binaires, non exclus, restent lents.
- **Ce n'est ni l'emplacement `Program Files`, ni la signature** : le binaire embarqué placé dans
  `Program Files` reste lent, et les deux git.exe ont une signature Authenticode valide.
  `Program Files\Git` ne figure dans aucune exclusion de Defender (exclusions lues : Android Studio
  et IDE embarqués seulement). Pourquoi le git installé du PC est épargné reste inexpliqué
  (réputation propre à ce fichier, vraisemblablement).
- **Grande dispersion** pour les binaires analysés (rapport max/min jusqu'à 16) : un changement de
  branche peut prendre de 0,3 s à 5 s sur 500 fichiers, et de 1 s à 12 s sur 1 000 fichiers.
- Ordre de grandeur pour le client : 1,5× à 2× le git du PC en médiane. Isomorphic-git dans
  Polenta.exe : ≈ 840 ms par checkout sur handstickProduct (451 fichiers).
- Écarté : demander aux clients ou à l'installeur une exclusion Defender (droits administrateur,
  politique de sécurité des clients, Polenta s'installe par utilisateur).

## Écarts par rapport au design

- **Statut** : un fichier dont la taille sur disque diffère de celle de l'index (CRLF sur disque, LF
  dans git) est vu modifié par git sans comparaison de contenu. `status()` rafraîchit donc
  l'entrée d'index de ces fichiers quand leur contenu filtré (`hash-object`) est identique au blob de
  l'index : le statut est propre, le disque intact. Cela remplace la normalisation par réécriture du
  disque du design §9.
- **Pas d'ESLint dans le dépôt** (`pnpm lint` ne vérifie rien pour l'app desktop) : la garde « aucun
  moteur git hors de `git/` » sera un test vitest (N4).
- Dossier Git for Windows : depuis 2.5x, les binaires sont sous `ucrt64/`, plus sous `mingw64/`. La
  résolution accepte les deux.
- Un lancement de git coûte environ 90 à 140 ms ici, contre 35 ms dans la mesure du 2026-11-10 :
  regrouper les appels (`add` d'une liste de chemins, `hash-object --stdin-paths`, `check-ignore
  --stdin`) est indispensable.

## Vérifications

- `pnpm typecheck` : 0 erreur.
- `npx vitest run src/main/git` : 30/30.
- Le reste de la suite n'a pas été lancé : aucun service n'est encore branché sur le backend.
