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

1. **Exception anti-import** : `scripts/app-version.ts` lance `git describe` au build. Le garder
   documenté, ou le faire passer par le git embarqué ?
2. **Askpass côté terminal** (sprint 3, écart 6) : non câblé. À faire, ou à décider comme limite
   connue ?
3. **Test du délai réseau natif** (sprint 3, écart 7) : pas d'équivalent.
4. **Checkout polenta-official** : écart accepté (voir Mesures). À reconfirmer après relecture.
5. **R8 et gh222-diff-edit** : échecs e2e antérieurs à GH337, à traiter dans un ticket séparé.
6. **Spec historique** : exemples de code à mettre à jour dans `SPEC-ELECTRON-DESKTOP`.
