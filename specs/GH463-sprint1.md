# GH463 — Sprint 1 (résumé)

Spec : `specs/GH463.md` (validée) · Design : `specs/GH463-design.md` · Tests : `specs/GH463-tests.md`

## Livré

- « + Nouvel élément » déplacé en tête d'arbre (`ElementTree.tsx`), collé en haut (`sticky top-0`, fond `bg-surface`).
- Création depuis ce bouton : élément inséré en tête de liste (`treeInsertAtBeginning`), titre en édition.
- Élément créé sélectionné et montré dans la vue de droite (Tableau, Document) via le mécanisme de cible
  existant (`requestGoto(nodeId, objectId)`, `SystemViewContext.tsx`).
- Filtre global effacé dès l'insertion ; filtres de colonne du Tableau effacés via `filtersResetSeq`
  (`ExcelView.tsx`, `useColumnFilters.ts` → `clear()`).
- Hors périmètre, inchangé : clic droit dans le vide, « + » d'interstice, coller, état vide.
- Écart par rapport à la spec : le menu du bouton de tête propose « Créer un dossier » ; un dossier créé ainsi
  est aussi placé en tête (même menu), sans sélection (pas d'objet).

## Vérifications

- `tsc --noEmit` (apps/desktop) : OK. `eslint --max-warnings=0` sur les fichiers modifiés : OK.
- Tests unitaires complets (`vitest run`, apps/desktop) : 262 fichiers, 2506 tests réussis, 5 ignorés.
- `pnpm build:web` : OK.
- e2e `e2e-web/gh463-create-top.spec.ts` (6 scénarios, clic souris) :
  - Exécution 1 : 3 réussis, 1 échec (sélecteur de l'icône de filtre de colonne, recouverte par la colonne figée
    « Section » ; corrigé en ciblant la colonne « Label »). Les tests suivants n'ont pas tourné (mode série).
  - Exécution 2 : 5 réussis, 1 échec : le test « Édition » partait avec le filtre global laissé par le test
    « clic droit » (la ligne cherchée était masquée). Corrigé dans le test (filtre remis à vide).
  - Exécution 3 : 6 réussis, 0 échec.

## Reste à faire

- Niveau 3 (suite e2e complète) : au push de `main`, une fois pour le lot, après la validation finale.
