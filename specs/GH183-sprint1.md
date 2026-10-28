# GH183 — Sprint 1 (unique)

## Fichiers

- `apps/desktop/src/renderer/lib/constellationLayout.ts` : logique pure (graphe, racines, anneaux,
  angles, part couverte, lignée, tracés SVG) — testée par `constellationLayout.test.ts`.
- `apps/desktop/src/renderer/routes/constellation.tsx` : la page (SVG + React, sans dépendance).
- `routeTree.gen.ts` : route `/constellation` ajoutée à la main (régénérée au prochain build).
- `components/sidebar/ImpactPanel.tsx` : entrée « Constellation des exigences ».
- `components/sidebar/version/VersionImpactSelector.tsx` : choisir une analyse depuis la
  Constellation ramène sur `/impact-analysis`.
- `components/layout/AppLayout.tsx`, `contexts/TabsContext.tsx` : panneau et titre d'onglet.
- `i18n/locales/{fr,en}.json` : section `constellation`.

## Données

`useWorkspaceLinks` (objets + liens de tous les repos, GH105) et `api.traceability.matrix`
(couverture, énoncés) — même clé de cache que la Vue Système. Rien n'est recalculé côté main.

## Divergences avec la maquette

- Générique : anneaux par type (ou par profondeur), couleur par type ou par champ enum au lieu du
  champ « service » propre au projet de démonstration.
- Bouton « Simuler des tests » retiré (démo seulement).
- Bouton « Inverser le sens » ajouté : le sens d'un lien de raffinement dépend du modèle du projet.

## Mises à jour SPEC

- `SPEC-TRACEABILITY.md §8` (nouvelle) : vue Constellation.

## Vérification

- **Non exécutée sur ce poste** (pas de Node) : `pnpm typecheck`, `pnpm lint`, `pnpm test`
  restent à lancer, ainsi que la vérification visuelle dans l'appli.

## Tester à la main

1. Ouvrir un projet avec des liens exigence ↔ exigence, panneau Analyse d'impact → « Constellation ».
2. Survoler / cliquer des nœuds, filtrer par type, chercher un ID, changer la couleur.
3. Lier un test à une exigence terminale : le halo doré apparaît sur elle et ses ancêtres.
4. « Ouvrir » : l'exigence s'ouvre dans un nouvel onglet.
