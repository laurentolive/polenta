# GH133 — Sprint 1 (unique)

## Fichiers modifiés

Voir `specs/GH133-design.md` § Fichiers. Tests ajoutés : `renderer/lib/publishWorkspace.gh133.test.ts`,
`main/services/pref-publish-merge.gh133.test.ts`.

## Comportement implémenté

Conforme à `specs/GH133.md` : avertissement et case « Fusionner dans … » quand un repo à publier est
sur une branche de l'utilisateur, cochée par défaut, mémorisée par branche ; décochée, commit et push
de la branche courante seulement, sans fusion ni épinglage ; notification « Publié sur … (non
fusionné dans …) ».

## Divergences par rapport au design

Aucune. Limite connue : la reprise d'une publication après résolution d'un conflit publie les repos
restants avec fusion.

## Mises à jour SPEC

- `SPEC-FORKS-BRANCHES-BASELINES.md` §2.1, ligne « branche libre / `dev-*` » : popup, case, publication
  sans fusion.
- `SPEC-INDEX.md` : ligne §1–2, `MAJ` → GH133.

## Points d'attention

- Écrit sur un poste sans Node : **typecheck, lint et `pnpm test` non lancés**.

## Tester manuellement

1. Créer `toolTest` depuis le panneau Version, modifier une exigence, Publier : avertissement + case cochée.
2. Décocher, Publier : `origin/toolTest` contient le commit, `main` et `origin/main` inchangées,
   notification « Publié sur toolTest (non fusionné dans main) ».
3. Publier à nouveau depuis `toolTest` : case décochée. Depuis une autre branche jamais publiée : cochée.
4. Cocher, Publier : fusion dans `main` et push de `main` comme aujourd'hui.
