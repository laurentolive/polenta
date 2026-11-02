# GH245 — Sprint 2 : interface, SPEC

## Fichiers modifiés

- `renderer/components/versions/VersionAnalysisSection.tsx` (nouveau) — lignes (ID, label, statut d'impact,
  commentaire, source « racine → … → élément » avec « +n »), racines et arbres (`ImpactTreeView`, statut
  éditable sur les nœuds), lecture seule si released ; « n'est plus atteint ».
- `renderer/components/versions/VersionTestsSection.tsx` (nouveau) — liste cochable (amené par, instances,
  « Déjà dans »), exigences sans test, « Créer une campagne » et « Ajouter à … » (raccourcis, aucun lien).
- `renderer/components/versions/useVersions.ts` — `useVersionImpact` (un seul calcul), `useSectionOpen`.
- `renderer/routes/version.$versionId.tsx` — sections sous « Changements » (pas pour une version abandonnée).
- `renderer/hooks/useLiveFileSync.ts` — `versions` invalidé aussi sur `links/` et `campaigns/`.
- `renderer/components/impact/ImpactTrees.tsx` — `STATUS_ORDER` = `IMPACT_ANALYSIS_STATUSES`.
- Main (revue) : `versions:impact` (analyse + tests, un snapshot) ; tests à exécuter limités au repo de la
  version ; statut saisi sur un nœud d'un autre repo reporté sur le nœud, sans ligne « plus atteint ».
- i18n `versions.analysis.*`, `versions.tests.*`, `VERSION_ABANDONED`.

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-REQ-requirements.md` §11.4 (nouvelle) | analyse d'impact, `impacted`, `analysis` figée, tests à exécuter, aucun lien version ↔ campagne |
| `SPEC-MCP-SERVER.md` §4.8 | `get_version_impact`, `get_version_tests` |
| `SPEC-DASHBOARDS.md` §2 | `GraphVersion.impacted`, `GraphVersion.analysis`, manifeste v12 |
| `SPEC-ELECTRON-DESKTOP.md` §19.8b | sections de la page d'une version |
| `specs/MILESTONE-D.md` §3 | livraison #245, abandon du lien version ↔ campagne (§3.1, §3.3, §6) |
| `SPEC-INDEX.md` | MAJ `GH245` |

## Divergences par rapport au design

- Tests à exécuter limités aux tests du repo de la version (une campagne ne contient que les tests de son
  repo ; un composant propose les siens dans sa version).
- Canal `versions:impact` ajouté (analyse et tests en un calcul) ; `versions:analysis` / `versions:tests`
  restent pour le MCP.

## Comment tester manuellement

1. Version en cours incluant une exigence liée : section « Analyse d'impact » — lignes, sources, statut
   saisi dans le tableau ou sur un nœud ; « Rafraîchir ».
2. « Tests à exécuter » : cochés par défaut ceux qu'aucune campagne ouverte ne contient ; « Créer une
   campagne » (création pré-remplie) ; « Ajouter à … » (sélecteur pré-coché de la campagne).
3. Passer la version released : analyse « figée », lecture seule ; tests toujours proposés.
