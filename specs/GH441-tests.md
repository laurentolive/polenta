# GH441 — Scénarios de test

Référence : [GH441.md](GH441.md) §4 (critères 1 à 8), [GH441-design.md](GH441-design.md).

## Niveau 1 — pendant le développement

- `pnpm typecheck`, `pnpm lint`.
- `npx vitest run` sur les fichiers touchés : `graph-verification.gh441.test.ts`, `versions-verification.gh441.test.ts`,
  `graph.service.test.ts`, `dashboard-lib.test.ts` (L7, L8, L11), `milestone-d-coverage.gh271.test.ts` (`get_version`
  existant).

## Tests du graphe — `graph-verification.gh441.test.ts` (fixtures, `fixtureServices`)

Le graphe reçoit des versions injectées par `setVersions({ list, versionType, designVersions })` ; le schéma de la
fixture déclare le type `version` (`isApproval` → released, `isTerminal` → abandoned).

| ID | Cas | Attendu |
|---|---|---|
| T1 | `released` avec `verification` `{ computedAt, rows: [{ id, status, tests }] }` | `GraphVersion.verification` égal au fichier (critère 1) |
| T2a | `in_progress` (sans `verification`) | `null` (critère 2) |
| T2b | `abandoned` (sans gel) | `null` (critère 2) |
| T2c | `released` sans `verification` (avant GH439) | `null` (critère 2) |
| T3a | `released`, `verification` sans `rows` | `rows: []`, les autres versions du repo sont toujours listées (critère 3) |
| T3b | `released`, une ligne sans `tests` | `tests: []` pour cette ligne, les autres lignes intactes (critère 3) |
| T6 | Script de la vue Suivi (bac à sable, `SandboxContext.prepare` sur le JSON du graphe) lit `versions[i].verification.rows.length` ; une version non figée donne `null` | critère 6 |

## Tests MCP et séquence réelle — `versions-verification.gh441.test.ts` (dépôt git temporaire)

Harnais : `TestRepo.init`, `createMcpContainer`, `registerVersionTools`, comme `milestone-d-coverage.gh271.test.ts`.
Release réelle (`versions.release`) : le fichier de version est écrit dans le commit de release.

| ID | Cas | Attendu |
|---|---|---|
| M1 | `get_version` d'une version released | `verification` identique au fichier `versions/<ID>.yaml` (critère 7) |
| M2 | `get_version` d'une version en cours | `verification: null` (critère 7) |
| M3 | Clés de `get_version` | exactement `version, state, component, basedOn, components, changes, verification` ; `version` sans `verification` (critère 7) |
| M4 | Séquence : release v1 (exigence couverte par un test) → on supprime le lien test↔exigence et on ajoute une exécution FAIL → relecture du graphe **et** de `get_version` | `verification` inchangée ; la matrice live, elle, a changé (critère 4) |
| M5 | Séquence : mêmes étapes, relecture du graphe construit à partir du dépôt (pas d'instance de service conservée) | identique à M4 : la valeur vient du fichier (critère 4) |

Le test M5 couvre le chemin « écriture hors application puis relecture » (leçon 2026-11-19, GH413) : il ne passe pas
par `setVersions`.

## Contrat

- **L7** : `checkJs` de la bibliothèque contre `polenta.d.ts` régénéré.
- **L8** : `polenta.d.ts` est exactement `renderGraphDts()` (critère 5).
- **L11** : dernière empreinte de `polenta-types` = contenu livré, versions croissantes (critère 5).

## Vérification de niveau 2 — avant le « Validé » final

- `pnpm test` complet (unitaires).
- Specs e2e voisines : le ticket n'a pas de spec e2e propre (pas d'UI). Voisines : `gh74-*` (vue Suivi, contrat du graphe).
  `pnpm build:web` puis `npx playwright test e2e-web/gh74-` si le temps le permet ; sinon, dit dans le compte rendu.
- Niveau 3 (suite complète) : **non** ici. Il se lance au push du lot : le ticket touche des services du main
  (`graph.service.ts`, MCP), donc il sera requis pour le push de `main`.
