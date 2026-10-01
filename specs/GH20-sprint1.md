# GH20 — Sprint 1 (unique) : IDs par parsing + pierres tombales

Spec `specs/GH20.md`, design `specs/GH20-design.md`, tests `specs/GH20-tests.md`.

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `apps/desktop/src/main/services/id-counter.util.ts` | réécrit : calcul depuis le disque (fichiers + pierres tombales + mémoire de session), migration paresseuse de `counters.yaml`, `deleteWithTombstone`, `assertNewObjectFile`, `TOMBSTONES_DIR`, paramètre `historyRepos` |
| `apps/desktop/src/main/services/git.service.ts` | `nextCounterId` supprimé ; `writeText` ajouté |
| `apps/desktop/src/main/services/reviews.service.ts` | `nextReviewId`/`CountersConfig` supprimés → `nextCounterId(…, 'REVIEW', 'reviews')` + garde-fou |
| `apps/desktop/src/main/services/campaigns.service.ts` | `delete` → `deleteWithTombstone` ; garde-fou dans `create` |
| `apps/desktop/src/main/services/dashboards.service.ts` | attribution via le module ; pierre tombale sur `delete` et `setScope` → privé ; garde-fous |
| `apps/desktop/src/main/services/saved-queries.service.ts` | idem |
| `apps/desktop/src/main/services/requirements.service.ts` | `nextId` attribue dans `targetRepo`, produit en `historyRepos` |
| `apps/desktop/src/main/services/tests.service.ts` | idem pour `nextTestId` |
| `apps/desktop/src/mcp-server/tools/bulk-import.tools.ts` | aperçu `dryRun` dans le repo cible de chaque prefix |
| `apps/desktop/src/main/services/schema.service.ts` | commentaire seulement |
| `CLAUDE.md` | `.polenta/tombstones/` dans les arborescences ; convention des IDs ; interdiction de supprimer une pierre tombale |
| `specs/SPEC-*.md`, `specs/SPEC-INDEX.md` | cf. § Mises à jour SPEC |

## Comportement implémenté

Conforme à la spec : plus aucune écriture de `config/counters.yaml` (il n'est plus que lu
puis supprimé par la migration), un seul module d'attribution pour les six types, pierre
tombale à chaque suppression physique, migration idempotente, aperçu `dryRun` sans écriture.

## Divergences par rapport au design

1. **Historique du produit pour les composants** (trouvé par `/code-review`). Le design
   (§2.3) acceptait que la migration du `counters.yaml` du produit pose, pour un prefix de
   composant, une pierre tombale « superflue » dans le produit. Or cette valeur est la
   seule trace des IDs du composant attribués depuis le produit avant GH20 : un fichier de
   composant supprimé hors application aurait vu son ID réattribué. Correctif :
   `nextCounterId`/`peekNextCounterId` prennent un paramètre `historyRepos` ;
   `RequirementsService`/`TestsService` (et l'aperçu bulk import) y passent le repo produit
   quand le fichier va dans un composant. Le max inclut alors ses pierres tombales et son
   `counters.yaml` non migré pour ce prefix (sans le migrer depuis là). Scénario 16b ajouté.
2. **Garde-fou mutualisé** : `assertNewObjectFile` (erreur `<ID> already exists`) plutôt
   qu'une copie du test `fileExists` dans chaque service. Les messages existants de
   `RequirementsService`/`TestsService` sont inchangés.
3. **Lint** : le desktop n'a pas de configuration ESLint (seuls `apps/api` et `apps/web` en
   ont) ; seul le typecheck a pu être exécuté.

## Vérifications

- `pnpm typecheck` (desktop) : 0 erreur.
- `/code-review` (medium) : 1 constat (divergence 1), corrigé.
- Script `tsx` jetable (scratchpad, non commité) sur des repos temporaires : scénarios
  **1–22 + 16b tous au vert**. Contre-épreuve : le même script sur le code d'avant GH20
  échoue sur 15 scénarios.
- Scénarios manuels 23–24 : **non exécutés**, à vérifier dans l'app (ci-dessous).

## Limite connue

L'aperçu `dryRun` d'un import vers un type de composant appelle
`SchemaService.resolveComponentRepoPath`, qui initialise un repo git vide si le
composant figure dans l'arbre mais n'a pas encore de `.git` (comportement existant de
`create()`). Cas marginal, non traité.

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-TECH-stack.md` §4.1 | `counters.yaml` retiré de l'arborescence `config/` |
| `SPEC-TECH-stack.md` §4.4 | réécrite : calcul depuis le disque, pierres tombales, sérialisation et mémoire de session, garde-fou, composants, migration, aperçu, collisions entre branches (renvoi #17) |
| `SPEC-REQ-requirements.md` §6.1 | numéro calculé par préfixe depuis le disque (au lieu d'un « compteur global au projet », déjà inexact) |
| `SPEC-REQ-requirements.md` §9 | non-réutilisation garantie par le fichier, limite des suppressions hors application |
| `SPEC-DASHBOARDS.md` §3 | tableau de stockage : ID via `nextCounterId`, pierre tombale |
| `SPEC-FORKS-BRANCHES-BASELINES.md` §6 | `counters.yaml` retiré de l'arborescence |
| `SPEC-MCP-SERVER.md` §4.2, §4.3 | aperçu `dryRun` (disque, repo cible) ; mention `counters.yaml` retirée |
| `SPEC-INDEX.md` | MAJ → GH20 pour SPEC-TECH-stack §4, SPEC-REQ §6, SPEC-DASHBOARDS §3, SPEC-MCP-SERVER (SPEC-REQ §9 et SPEC-FORKS §6 n'ont pas de ligne d'index) |

## Tester manuellement

1. Ouvrir un projet existant qui a un `config/counters.yaml`. Créer une exigence :
   l'ID suit la séquence d'avant ; la vue des changements montre `counters.yaml`
   supprimé et, le cas échéant, des fichiers `.polenta/tombstones/…` (scénario 24).
2. Créer deux campagnes, supprimer la dernière, Publier : le commit contient la
   suppression et `.polenta/tombstones/CAMP-xxxx` (scénario 23). Recréer une campagne :
   elle ne reprend pas l'ID supprimé.
3. Passer un dashboard partagé en privé puis en créer un nouveau partagé : nouvel ID.
