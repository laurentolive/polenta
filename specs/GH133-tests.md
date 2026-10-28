# GH133 — Scénarios de test

Automatiques : `renderer/lib/publishWorkspace.gh133.test.ts` (`api` simulé),
`main/services/pref-publish-merge.gh133.test.ts`.

| # | Scénario | Attendu | Couvert par |
|---|---|---|---|
| 1 | Sur `main` = intégration, Publier | Ni avertissement ni case | `isOffIntegration('main')` faux |
| 2 | Sur `toolTest`, exigence modifiée, aucun choix mémorisé | Avertissement + case « Fusionner dans `main` » cochée | `offIntegrationRepos`, manuel |
| 3 | Case décochée, Publier | Commit sur `toolTest`, push de `toolTest`, `main` / `origin/main` inchangées, repo sur `toolTest` | test « case décochée », manuel |
| 4 | Case cochée | Comportement actuel (fusion dans `main`, push de `main`) | test « case cochée » |
| 5 | Sur `int-B` non désignée | Bloqué (GH106), pas de case | `isOffIntegration('int-B')` faux |
| 6 | Reprise d'une `dev-<slug>` éphémère, `dev-resync` | Pas de case, fusion | `isOffIntegration` (éphémère, `dev-resync`) |
| 7 | Multi-repo : enfant sur `toolTest`, parent sur son intégration, case décochée | Enfant poussé sur `toolTest`, parent publié normalement, pas de ré-épinglage | test « ni épinglage », manuel |
| 8 | Case décochée puis Publier depuis `toolTest` ; puis autre branche jamais publiée | Décochée sur `toolTest`, cochée ailleurs | test pref |
| 9 | Publier décoché sur la branche d'intégration | Publication nominale inchangée | test « branche d'intégration » |

Manuel (desktop) : scénarios 2, 3, 7 avec un vrai remote (`origin/toolTest` créée, `origin/main` au même SHA).
