# T94 — Sprint 1 (unique)

## Fichiers modifiés

- `packages/types/src/schema.ts` — nouvelle interface `ProjectPreferences` + champ optionnel
  `ProjectSchema.preferences`
- `apps/desktop/src/renderer/routes/schema.tsx` — nouvel onglet **Préférences** dans la page
  Modèle de données (`/schema`), case à cocher `autoPropagatePin`, même flux draft +
  Enregistrer/Annuler que l'onglet Liens
- `CLAUDE.md` — documentation de `preferences:` dans le format `schema.yaml`
- `specs/SPEC-TEMPLATES.md` §2 — format du template mis à jour avec `preferences`
- `specs/SPEC-INDEX.md` — colonne MAJ de la ligne SPEC-TEMPLATES.md §1–4 → T94

`apps/desktop/src/main/services/schema.service.ts` n'a pas eu besoin de modification : la
lecture/écriture disque round-trip déjà n'importe quel champ de `ProjectSchema` tel quel
(`yaml.load`/`yaml.dump`), `preferences` est transporté sans traitement spécial.

## Comportement implémenté

- Un schéma sans `preferences` (repos existants) charge sans erreur ; la case Préférences
  apparaît décochée par défaut (`schema.preferences?.autoPropagatePin ?? false`).
- Cocher/décocher puis Enregistrer écrit `preferences: { autoPropagatePin: <bool> }` dans
  `.polenta/schema.yaml` — la clé est toujours écrite explicitement une fois l'onglet
  sauvegardé au moins une fois (cohérent avec le reste de l'éditeur, ex. `linkTypes: []`).
- Annuler (Échap / bouton) restaure l'état sauvegardé, identique aux autres onglets.

## Divergences par rapport au design

Aucune — scope volontairement réduit à schéma + UI de préférence, la logique de propagation du
pin au commit reste hors scope (dépend de la refonte Version multi-repo non codée, voir
`specs/T94.md` § Hors scope).

## Mises à jour SPEC

- `SPEC-TEMPLATES.md` §2 : ajout de `preferences.autoPropagatePin` dans le format YAML du
  template (nouvelle clé racine optionnelle du bloc `schema:`)
- `SPEC-INDEX.md` : ligne SPEC-TEMPLATES.md §1–4, colonne MAJ → T94, mots-clés étendus
  (preferences, autoPropagatePin)

## Comment tester manuellement

1. Ouvrir un projet Polenta, aller sur la page **Modèle de données** (`/schema`).
2. Onglet **Préférences** (nouveau, après Interfaces) : la case doit être décochée par défaut
   sur un projet existant.
3. Cocher la case → bouton **Enregistrer** apparaît (indicateur `*` dans le titre) → cliquer.
4. Vérifier dans `.polenta/schema.yaml` du repo que `preferences.autoPropagatePin: true` a été
   écrit.
5. Recharger la page → la case reste cochée (round-trip disque OK).
6. Décocher, Enregistrer → `autoPropagatePin: false` dans le fichier.
7. Vérifier qu'un projet dont le `schema.yaml` ne contient pas `preferences` (ancien format)
   s'ouvre toujours normalement, sans erreur console.

`npm run typecheck` (via `npx turbo typecheck --filter=@polenta/desktop --filter=@polenta/types`)
exécuté dans le worktree — 0 erreur.

**Non testé interactivement** (pas d'Electron attachable dans cette session) — attend validation
manuelle humaine avant archivage/merge.
