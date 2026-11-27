# GH441 — Sprint 1 : couverture figée (`verification`) exposée au graphe et au MCP

Spec : [GH441.md](GH441.md) · Design : [GH441-design.md](GH441-design.md) · Tests : [GH441-tests.md](GH441-tests.md)

## Fichiers modifiés

- `packages/types/src/graph.ts` — `GraphVersion.verification` (type, JSDoc).
- `apps/desktop/src/main/services/graph.service.ts` — `listVersions` : mapping de `verification` (garde `?? []`).
- `apps/desktop/src/mcp-server/tools/versions.tools.ts` — `get_version` : clé `verification` (lue sur la version brute), description.
- `apps/desktop/resources/dashboard-lib/polenta.d.ts` — régénéré (`tsx scripts/generate-graph-dts.ts`), +7 lignes.
- `apps/desktop/resources/dashboard-lib/manifest.json` — `polenta-types` version 19 (`dashboard-lib-manifest.ts --bump`).
- `apps/desktop/src/main/services/graph-verification.gh441.test.ts` — nouveau (7 tests : T1, T2a-c, T3a-b, T6).
- `apps/desktop/src/main/services/versions-verification.gh441.test.ts` — nouveau (5 tests : M1-M5, dépôt git réel).
- `specs/SPEC-DASHBOARDS.md` §2 — note « GH441 (contrat v1, ajout) ».
- `specs/SPEC-MCP-SERVER.md` §4.8 — `get_version` renvoie `verification`.
- `specs/SPEC-INDEX.md` — colonne MAJ des deux lignes (GH441).

## Comportement implémenté

- `GraphVersion.verification` : copie fidèle de `verification` du fichier de version (`computedAt`, lignes `{ id, status, tests }`),
  `null` pour une version en cours, abandonnée sans gel, ou released avant GH439.
- Un bloc incomplet (`rows` ou `tests` absents) ne fait pas tomber le graphe ni disparaître les autres versions du repo.
- MCP `get_version` : clé `verification` au premier niveau (même forme), `version` ne la porte toujours pas (GH439).
- Aucun calcul : la valeur vient du fichier ; un lien retiré après release ne la modifie pas (M4, M5).

## Divergences par rapport au design

Aucune de fond. Notes d'exécution :
- Le design prévoyait `GraphCoverageStatus` pour `status` : confirmé, les deux types ont les mêmes cinq valeurs.
- Les tests de graphe passent par `setVersions` (fixture), comme prévu ; le test de séquence réelle M4/M5 est sur dépôt git et conteneur MCP réels.

## Mises à jour SPEC

- SPEC-DASHBOARDS §2 : note GH441 (contrat v1, ajout), manifeste v19.
- SPEC-MCP-SERVER §4.8 : `get_version`, clé `verification`.
- SPEC-INDEX : colonne MAJ = GH441 pour ces deux sections.
- SPEC-REQ §11 / §13 : pas modifiées (la couverture figée y est déjà décrite par GH439).

## Comment tester à la main

1. Dans l'application, ouvrir une version en cours, la passer released : le fichier `versions/<ID>.yaml` reçoit `verification`.
2. Via le MCP, `get_version { id }` sur cette version : clé `verification` avec les lignes du fichier ; sur une version en cours : `null`.
3. Retirer le lien test↔exigence d'une exigence de la version released : la couverture courante de l'exigence change, `verification` non.
4. Un script de la vue Suivi peut lire `data.versions[i].verification`.

## Vérifications

| Niveau | Commande | Résultat |
|---|---|---|
| 1 | `pnpm typecheck` | OK (4 tâches) |
| 1 | `pnpm lint` | échec **hors périmètre** : fichiers non touchés (`askpass.js`, `node-checkout.gh337.test.ts`, `merge-resolution.service.ts`) et `vendor/git` téléchargé dans ce worktree. Le lint de mes fichiers passe (`eslint` ciblé, exit 0). Les correctifs (GH437, ignore de `vendor`) sont sur le `main` poussé depuis, pas dans la base du milestone : résolu à la mise à jour avec `main` (validation finale). |
| 1 | `vitest` ciblé (graphe, GH439, GH271, contrat L7/L8/L11) | 98 tests OK |
| 2 | `pnpm test` (suite unitaire complète) | **260 fichiers, 2 496 tests passés, 5 ignorés**, code 0 (passage propre, sans autre charge). Un premier passage avait un échec isolé (`sync.service.gh414` R3, délai de 20 s) pendant le build web et l'e2e lancés en parallèle ; le test passe seul (1,2 s) et dans le passage propre. |
| 2 | `pnpm build:web` puis `playwright test e2e-web/gh74-suivi e2e-web/gh74-editing` | 9 passés |
| 3 | suite e2e complète | non lancée : requise au push du lot (le ticket touche `graph.service.ts` et le MCP). |

Dépendances : `pnpm install --frozen-lockfile` et `pnpm git:fetch` (Git embarqué dans `apps/desktop/vendor/`, non versionné) lancés dans ce worktree.
