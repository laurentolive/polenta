# T96 — Sprint 1 (unique)

## Fichiers modifiés

- `apps/desktop/src/renderer/routes/preferences.tsx` (nouveau) — page dédiée, un seul champ
  `autoPropagatePin` pour l'instant, flux draft + Enregistrer/Annuler identique aux autres pages
  d'édition de schéma
- `apps/desktop/src/renderer/components/sidebar/ProjectPanel.tsx` — retrait de la case inline
  (T95), ajout du lien « Préférences » sous « Modèle de données », redevient un panneau de liens
  simple (plus de `useProjectSchema`/mutation ici)
- `apps/desktop/src/renderer/routeTree.gen.ts` — entrée `/preferences` ajoutée à la main (voir
  `specs/T96.md` § Notes techniques pour le pourquoi de la régénération manuelle)

## Comportement implémenté

Identique à la description fonctionnelle de `specs/T96.md`. Le formulaire de préférences
(`EditorState` avec `autoPropagatePin: boolean`) est volontairement structuré comme les tabs de
`/schema` pour que l'ajout d'un futur champ soit un simple ajout de propriété + input, sans
refonte.

## Divergences par rapport au design

Aucune, sauf la régénération manuelle de `routeTree.gen.ts` documentée dans `specs/T96.md`
(contournement d'un bug d'environnement, pas un choix de conception).

## Comment tester manuellement

1. Ouvrir un projet — panneau latéral Projet : lien « Préférences » sous « Modèle de données ».
2. Cliquer → page `/preferences` s'ouvre, case décochée par défaut sur un schéma existant.
3. Cocher → `*` apparaît dans le titre, boutons Annuler/Enregistrer apparaissent.
4. Enregistrer → `.polenta/schema.yaml` du repo contient `preferences.autoPropagatePin: true`.
5. Recharger la page → case reste cochée.
6. Aller sur `/schema`, modifier un lien, Enregistrer → vérifier que `preferences.autoPropagatePin`
   n'est pas modifié dans le fichier.
7. Échap avec une modification en attente sur `/preferences` → popup confirmation, Annuler restaure
   l'état sauvegardé.

`npm run typecheck` (turbo, filtre desktop+types) — 0 erreur.

**Non testé interactivement** (pas d'Electron attachable dans cette session) — attend validation
manuelle humaine avant archivage/merge. À l'occasion, vérifier aussi en dev réel
(`pnpm --filter @polenta/desktop dev`) que `routeTree.gen.ts` se régénère correctement et reste
identique à la version écrite à la main ici.
