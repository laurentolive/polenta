# T46 — Sprint 1 : backend + lecture seule

## Fichiers modifiés

**Nouveaux :**
- `packages/types/src/impact-analysis.ts` — types partagés (`ImpactAnalysisStatus`, `ImpactNode`, `ChangedRequirement`, `ImpactAnalysis`, DTOs)
- `apps/desktop/src/renderer/routes/impact-analysis.tsx` — route `/impact-analysis` (sélection de baselines, arbre des exigences changées, navigation vers les vues existantes)
- `specs/T46-sprint1.md` — ce fichier

**Modifiés :**
- `apps/desktop/src/main/services/traceability.service.ts` — nouvelles méthodes T46 (voir plus bas), constructeur étendu (`sync: SyncService` ajouté avant `workspaceTree?`)
- `apps/desktop/src/main/services/git.service.ts` — `listFilesAtRef`, `readYamlDirAtRef`
- `apps/desktop/src/main/services/sync.service.ts` — `resolveTag`
- `apps/desktop/src/main/container.ts` — injection de `sync` dans `TraceabilityService`
- `apps/desktop/src/main/ipc/index.ts` — 5 nouveaux endpoints IPC
- `packages/api-client/src/types.ts`, `packages/api-client/src/ipc-client.ts` — client `impactAnalysis.*` + `traceability.diffRequirements`
- `apps/desktop/src/renderer/routeTree.gen.ts` — entrée `/impact-analysis` ajoutée à la main (pas de serveur Vite disponible dans cette session pour la régénération automatique) ; vérifié structurellement identique aux 12 points d'insertion d'une route existante comparable (`/dashboard`)
- `apps/desktop/src/renderer/routes/baseline.tsx` — `readinessIssue()` ne bloque plus sur la branche d'intégration (D7/D5, cf. `T46-design.md`)
- `apps/desktop/src/renderer/components/sidebar/VersionPanel.tsx` — bouton "Analyse d'impact" (icône `ListTree`)
- `TICKETS.md` — statut `[coding sprint 1]`

## Comportement implémenté

- **Diff exigence-par-exigence entre deux baselines** (`diffRequirementsBetweenRefs`) : sur les blobs bruts des deux tags via `sync.diffBetween` + `git.readYamlRef`, classe ajoutée/supprimée/modifiée avec détail des champs changés (`status`, `title`, `fields.*`).
- **Arbres d'impact bidirectionnels figés** (`loadSnapshotAtRef` + `buildImpactTreesFromSnapshot`) : snapshot des exigences/tests/liens tel qu'il existait à la baseline B (pas l'index vivant), traversée complète (pas de limite de profondeur), tests couvrants rattachés à chaque nœud, garde-fou anti-cycle partagé entre les deux arbres.
- **Persistance** (`createImpactAnalysis`/`listImpactAnalyses`/`getImpactAnalysis`) : un fichier `impact-analyses/<id>.yaml` par analyse, calcul figé une seule fois à la création.
- **Baseliner n'importe quelle branche** : `readinessIssue()` ne bloque plus que sur les modifications en attente — testé en créant une baseline depuis une branche non-intégration.
- **UI lecture seule** : sélection de deux baselines (`BaselineCombobox`, avec option "Créer une baseline sur l'état actuel…" qui navigue vers `/baseline`), liste des exigences changées avec champs modifiés, arbres descendant/montant dépliables, navigation vers les fiches exigence/test existantes.

`updateImpactItemStatus` (édition de statut) est codé côté backend + IPC + client mais **pas encore branché dans l'UI** — prévu sprint 2, cf. plus bas.

## Divergences par rapport au design

- **Format de fichier — correction majeure** : `T46-design.md` supposait un format "frontmatter YAML + corps Markdown" (`requirements/*.md`) sur la base de l'exemple `CLAUDE.md`. Le code réel stocke des `.yaml` purs (`requirements/*.yaml`, lus via `GitService.readYaml`/`readYamlRef`, sans frontmatter). Toute la logique de "parsing frontmatter avec repli sur diff brut" décrite en design est donc caduque — remplacée par une comparaison directe des objets `Requirement` parsés, plus simple. `GitService.readYamlRef` (déjà existant, non documenté dans le design) fournit directement la lecture "YAML à un ref donné" que le design pensait devoir construire à la main.
- **`loadSnapshotAtRef` simplifié** : grâce au point ci-dessus, pas besoin de reconstruire un parseur — `git.walk` mono-arbre (`listFilesAtRef`, nouveau) + `readYamlRef` suffisent. Un nouveau `readYamlDirAtRef` sur `GitService` factorise le tout (ajouté en cours de revue de code, cf. ci-dessous).
- **Revue de code** : `/code-review high` a pu tourner sur seulement 2 des 8 angles prévus (reuse, efficacité) — le service d'agents a atteint sa limite de session en cours de route (5 des 8 lancements ont échoué). Les 2 angles qui ont tourné ont trouvé 7 candidats, tous vérifiés manuellement (les sous-agents de vérification n'étaient plus disponibles) :
  - **Corrigés** : 3 problèmes d'efficacité (lectures séquentielles au lieu de `Promise.all`, re-scan O(nœuds×liens) des liens au lieu d'un index construit une fois, `diffRequirementsBetweenRefs`/`loadSnapshotAtRef` non parallélisés dans `createImpactAnalysis`), 1 régression (clic-extérieur manquant sur `BaselineCombobox`, copié de `GitRefCombobox` sans son gestionnaire), 1 duplication (nouveau `GitService.readYamlDirAtRef` pour éviter de dupliquer le pattern déjà centralisé par `readYamlDir`).
  - **Non corrigés, acceptés** : `listImpactAnalyses` parse chaque analyse en entier (arbres complets) juste pour en extraire les métadonnées — déjà noté en design (D4) comme un compromis à trancher plus tard selon le volume réel observé ; formatage de date dupliqué à 3 endroits (`baseline.tsx`, `graph.tsx`, `impact-analysis.tsx`) — cosmétique, pas de coût fonctionnel.
  - Les angles non exécutés (line-by-line, removed-behavior, cross-file, simplification, altitude, conventions) ont été partiellement couverts manuellement : aucun autre appelant de `new TraceabilityService(...)` (grep sur tout le repo), noms de canaux IPC vérifiés identiques des deux côtés, `routeTree.gen.ts` vérifié structurellement identique (12 points d'insertion, comme pour `/dashboard`) à ce que le générateur produirait.

## Comment tester manuellement

Non testé interactivement (pas d'Electron attachable dans cette session).

1. Ouvrir un projet avec au moins deux baselines existantes (ou en créer une nouvelle depuis une branche de travail `dev-*` — vérifie le correctif `readinessIssue`)
2. Panneau Version → icône "Analyse d'impact" (arbre) → `/impact-analysis`
3. Choisir baseline A et B, cliquer "Analyser l'impact"
4. Vérifier la liste des exigences changées, les champs modifiés affichés, et les arbres descendant/montant en dépliant une exigence modifiée qui a des liens
5. Cliquer un élément impacté ou une exigence → doit ouvrir sa fiche existante (`/req/$reqId` ou `/test/$testId`)
6. Revenir au panneau, rouvrir l'analyse depuis "Analyses existantes" → doit restituer exactement le même contenu
