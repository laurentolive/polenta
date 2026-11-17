# GH389 — Scénarios de test

Critères : `specs/GH389.md` § Critères d'acceptation (C1…C13). Unitaires = vitest à côté du module
(`*.gh389.test.ts`). e2e-web : `apps/desktop/e2e-web/gh389-*.spec.ts` ; écrans indisponibles en web
(Validation, si confirmé) : `apps/desktop/e2e-desktop/gh389-*.spec.ts`.

## Unitaires (modules purs, sprint 1)

| # | Module | Scénarios |
|---|--------|-----------|
| U1 | `columnFilters.ts` | contient / casse / mot entier / regex ; regex invalide n'exclut rien ; deux colonnes en ET ; texte vide = pas de filtre ; purge d'une colonne masquée |
| U2 | `columnLayout.ts` | largeur auto bornée ; largeur choisie prioritaire ; offsets de gel cumulés ; gel borné au nombre de colonnes ; réordonnancement (avant / après, colonne de tête immobile) |
| U3 | `gridKeyboard.ts` | ↑/↓ bornés (première / dernière ligne) ; ←/→ bornés ; Tab en fin de ligne → ligne suivante col. 0 ; Maj+Tab en début → ligne précédente dernière col. ; Tab en dernière cellule : reste ; Maj+↓ → `extendSelection` ; Entrée sur éditable → `edit`, sinon `activate` ; ←/→ sur ligne de groupe → `collapse` / `expand` ; grille vide → null |
| U4 | `rowSelection.ts` | clic simple ; Maj = plage depuis l'ancre ; Ctrl = bascule ; clic dans une sélection multiple ne réduit pas ; ancre masquée ⇒ Maj ignoré ; mode cases tri-état |
| U5 | `exportTable.ts` | lignes filtrées et colonnes visibles dans l'ordre ; texte affiché ; liens d'élément joints par « , » ; nom de feuille tronqué / nettoyé |
| U6 | `table.xlsx.ts` (main) | classeur : en-tête, valeurs, volets figés, hyperlien |
| U7 | `exportColumns.ts` | (sprint 2) colonnes `link*` et `coverageStatus` exportées en texte ; lignes = lignes affichées ; tests existants adaptés |

## e2e

| # | Critère | Spec | Scénario |
|---|---------|------|----------|
| E1 | C1 | `gh389-validation` | replier l'en-tête : hauteur de la grille augmente, statut et « reste à décider » visibles ; ouvrir une autre validation : replié ; recharger : replié |
| E2 | C2 | `gh389-validation` | filtre `^conf` (Décision) + `SYS` (ID) : seules les lignes attendues, compteur « n / total » ; icône active |
| E3 | C3 | `gh389-validation` | largeur, gel, ordre modifiés → fermer l'onglet, rouvrir : retrouvés ; Réinitialiser → défaut |
| E4 | C4 | `gh389-validation` | survol ID exigence 500 ms → popup avec champs Popup ; Ctrl+clic → nouvel onglet vue système ; ID version de l'en-tête → popup (ID, titre, état), clic → page version |
| E5 | C5 | `gh389-validation`, `gh389-excel-keyboard` | ↓×3, →×2 → cellule attendue ; Tab fin de ligne ; Entrée ouvre l'éditeur, Échap referme sans écrire (fichier inchangé) ; cellule hors écran ramenée visible |
| E6 | C6 | `gh389-validation` | Maj+clic 3 lignes, décision « Conforme » → 3 entrées écrites (YAML) ; décision `proposesIssue` en lot → un dialogue, issue avec 3 `origin.decisions` et 3 liens `issue-impact` |
| E7 | C7 | `gh389-validation` | validation signée : double-clic / Entrée n'ouvrent rien, pas de boutons de lot ; filtre, flèches, export OK |
| E8 | C8 | `gh389-validation` | export filtré : classeur lu (exceljs) = lignes / colonnes / libellés affichés |
| E9 | C9 | `gh389-excel-export` | vue Excel, filtre de colonne + regex global → export = lignes affichées ; colonne de lien visible exportée avec ses ID |
| E10 | C10 | `gh389-executions` | en-tête cliqué : ordre inchangé ; filtre par colonne ; lien test / campagne avec popup |
| E11 | C11 | `gh389-versions`, `gh389-campaigns`, `gh389-misc` | pour chaque grille du spec §4 : icône de filtre, 👁 (si prévu), ↕▯, Exporter (si prévu), flèches ; aucun ID d'un autre élément sans `ElementLink` (sélecteur `[data-element-link]` ou équivalent) |
| E12 | C12 | `gh389-versions`, `gh389-campaigns` | défiler, aller sur un autre panneau par la barre d'activité, revenir : position reprise, échantillonnage par frame sans peinture en haut (leçon 2026-11-06) |
| E13 | C13 | existants | `gh288`, `gh235`, `gh203`, `gh176`, `gh224`, `gh300`, `gh229-*`, `gh70-*`, `gh126`, `gh139`, `gh136`, `gh246-render-loop`, `gh250`, `gh195`, `gh74`, `e2e-desktop/gh204-validation`, `gh210-reflections` |

## Cas limites

- Grille vide : compteur « 0 / 0 », pas d'erreur clavier, export d'un classeur à en-tête seul.
- Préférence de colonnes contenant une clé inconnue : ignorée, jamais réécrite.
- Toutes les colonnes masquées sauf verrouillées : pas de crash, clavier sur ID / titre.
- Écriture en lot avec une ligne refusée (ex. `DECISION_IN_USE`, lecture seule) : autres lignes écrites,
  message listant la ligne en échec.
- Échap dans le popover de filtre d'une grille dans une modale (drill-down, sélecteur) : ne ferme que
  le popover.
- `localStorage` indisponible : en-tête déplié, aucune erreur.

## Manuel (non automatisable)

- Fluidité perçue du clavier sur une grande Vue Excel (≈ 200 lignes, 25 colonnes).
- Lisibilité du classeur exporté dans Excel / LibreOffice (largeurs, volets figés).
- Thème sombre des nouvelles barres d'outils et popovers.
