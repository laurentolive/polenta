# GH267 — Sprint 1 : figer à la signature

## Fichiers

- **Types** : `validation.ts`, `graph.ts`.
- **Main** : `validation-rows.util.ts`, `validations.service.ts`, `graph.service.ts`, `container.ts`, `mcp-server/container.ts`.
- **Renderer** : `ValidationGrid.tsx`, `ValidationRuns.tsx`, `runMentions.ts`, locales.
- **Livré aux projets** : `polenta.d.ts` régénéré, manifeste +1.
- **Specs** : SPEC-REQ §13 ; `GH204.md` Q1 renvoie ici.

## Comportement

Conforme à `specs/GH267.md`.

## Divergences par rapport à la spec

- La mention « À la signature » est une ligne au-dessus de la grille, et non un libellé par colonne : elle concerne plusieurs colonnes et le détail.
- Un test ajouté sous le chevron n'apparaît pas s'il a été lié après la signature, pour que la liste figée reste identique.

## Non couvert par un test automatique

Affichage du détail figé, du bandeau et du badge : voir `specs/GH267-tests.md`.
