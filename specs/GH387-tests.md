# GH387 — Scénarios de test

Le ticket ne touche que l'outillage e2e : les « tests » sont des passages de la suite et des
contrôles de l'outillage.

## Nominal

| # | Scénario | Attendu |
|---|---|---|
| N1 | `pnpm --filter @polenta/desktop test:e2e:web` sur le poste Windows, build exécuté | durée totale < 10 min, tout vert |
| N2 | Second passage complet juste après N1 | tout vert (pas d'instabilité) |
| N3 | `npx playwright test --list` avant / après | même nombre de tests (398), aucun `skip`/`fixme` ajouté |
| N4 | `POLENTA_E2E_TIMINGS=<f> npx playwright test …` puis `node e2e-web/support/timings.mjs <f> <report>` | sommes par étape du `beforeAll` et somme des corps de test affichées |
| N5 | Fichier avec le projet par défaut, deuxième fichier du même worker | le second copie le modèle (`mode: copy` dans les mesures) ; projet identique (exigences, composants, remote) |

## Cas limites

| # | Scénario | Attendu |
|---|---|---|
| L1 | Un fichier publie vers la démo, le fichier suivant du même worker s'ouvre | signature changée → vrai clone ; il voit la publication |
| L2 | `s.cloneAndOpen(...)` explicite, clone depuis l'accueil (`s2-core`) | vrai clone, inchangé |
| L3 | Deux worktrees lancent la suite en même temps, sans variable de port | aucun conflit de port, les deux passages se déroulent |
| L4 | `POLENTA_E2E_PORT=8897 POLENTA_E2E_GIT_PORT=8898 POLENTA_E2E_ADMIN_PORT=8899` | worker `i` sur base + 10·i |
| L5 | `npx playwright test e2e-web/parity.spec.ts` (un fichier) | une seule pile démarrée (N = 1 worker utile), test vert |
| L6 | Un test échoue → le worker redémarre | le worker suivant retrouve sa pile (même ports) |
| L7 | `npx playwright test --last-failed` après un échec | relance seulement les échecs, vert |
| L8 | `POLENTA_E2E_WORKERS=1` | comportement série, vert |
| L9 | Fin de suite (verte ou rouge, ou Ctrl+C) | aucun processus serveur / admin restant (`tasklist`) |
| L10 | `project: null` (10 fichiers) | accueil affiché, pas de projet préparé |

## Critères vérifiables

- Durées avant/après chaque piste dans `specs/GH387.md` § 6.
- README `e2e-web` et WORKFLOW § Niveaux de vérification à jour (durée, workers, ports).
