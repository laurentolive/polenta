# GH229 — Sprint 1 : modèle, navigation, lien d'élément et popup (vue système)

Spec `specs/GH229.md`, design `specs/GH229-design.md`. Sprints 1 et 2 enchaînés dans le même
worktree (`../polenta-official-GH229`, branche `GH229` → `milestone-C`) et commités ensemble
(voir `GH229-sprint2.md`).

## Fichiers modifiés

- `packages/types/src/schema.ts` — `ObjectTypeDefinition.displayIdField`,
  `DISPLAY_ID_FIELD_TYPES`, `displayIdFieldCandidates`, `displayIdFieldError`, `displayIdOf`.
- `packages/types/src/requirement.ts` — `WorkspaceObject.displayId`.
- `packages/api-client/src/types.ts` — `FieldVisibilityPref.popup`.
- `apps/desktop/src/main/services/schema.service.ts` — code `DISPLAY_ID_FIELD_INVALID`,
  `assertValidDisplayIdFields` dans `save()` (erreur nouvelle seulement).
- `apps/desktop/src/main/services/workspace-links.service.ts` — `listObjects` calcule
  `displayId` (schémas lus en parallèle des index, types indexés par ref une fois par repo).
- `apps/desktop/src/mcp-server/tools/schema-mutation.tools.ts`,
  `apps/desktop/src/main/services/agents-md.template.ts` — `displayIdField` (MCP, AGENTS.md).
- `components/schema/objectTypeEditor.tsx`, `components/schema/ElementConfigModal.tsx` — liste
  « ID affiché dans les liens » ; retirée si le champ disparaît ou change de type, suivie s'il
  est renommé.
- `contexts/SystemViewContext.tsx` — `objectPage`, `viewModeForLink` ; `showObject` via
  `objectPage`.
- `contexts/ElementNavContext.tsx` (nouveau) — index (objets du workspace + campagnes), `follow`,
  contrôleur de popup (contexte d'état séparé).
- `components/element/ElementLink.tsx`, `components/element/ElementPreviewPopup.tsx` (nouveaux).
- `components/layout/AppLayout.tsx` — `ElementNavProvider` + `ElementPreviewPopup`.
- `components/system/FieldConfigModal.tsx` — onglet « Popup ».
- `components/system/SystemView.tsx` — préférence `popup`, `navigateToObject` délégué à
  `follow`, Édition en chargement tant que l'élément de l'URL attend son arbre (#236).
- `components/system/ExcelView.tsx`, `WordView.tsx`, `LinkCombobox.tsx` — `ElementLink`.
- `components/system/ElementTree.tsx`, `components/sidebar/SystemPanel.tsx` — sélection et
  dévoilement (`revealNodeId`) de l'élément ciblé ; Tableau : ligne ciblée sélectionnée.
- i18n fr / en.

## Comportement

- Clic sur un ID : page de la cible dans le mode courant de la vue système (Tableau, Document,
  Édition), sinon dernier mode Tableau / Document du repo ; élément ciblé, sélectionné dans le
  Tableau et dans l'arbre. Ctrl / Cmd / clic du milieu / Ctrl+Entrée : même page, nouvel onglet.
- #236 : la page « invalide » était la fiche Édition montée sans nœud pendant le chargement de
  l'arbre du type cible (formulaire vide) — désormais Tableau gardé, et état de chargement en
  Édition ; le Ctrl+clic ouvrait la fiche `/test/…` et le `mousedown` remontait à la cellule —
  désormais même page dans un nouvel onglet, `mousedown` arrêté (e2e N4 : URL et historique de
  l'onglet source inchangés).
- Popup : 500 ms, grâce 200 ms, Échap / clic / défilement ; en-tête, titre, champs de l'onglet
  « Popup » (défaut : aucun).
- Lien accessible au clavier (`tabIndex`, Entrée), nom accessible = texte affiché.

## Divergences avec le design

- Contrôleur de popup dans `ElementNavProvider` (deux contextes : navigation stable, état de la
  popup lu par la popup seule) plutôt qu'un `ElementPreviewProvider` distinct.
- `ElementLink.onFollow` : un écran garde son geste de clic (popover de liens du Tableau fermé
  avant la navigation, constellation, analyse d'impact) ; il reste cliquable tant que l'index
  n'est pas chargé.
- Infobulle native : seulement l'ID Polenta quand l'ID affiché diffère (la popup tient lieu
  d'infobulle).
- Validation `displayIdField` : seule une erreur nouvelle bloque l'enregistrement (un YAML édité
  à la main ne bloque pas les écritures en cascade).
- Onglet « Popup » absent pour un type campagne.

## Tests

- Unitaires : `schema.service.gh229.test.ts` (L1–L3), `objectTypeEditor.gh229.test.ts` (L14,
  renommage).
- e2e : `e2e-web/gh229-element-links.spec.ts` (N1, L9, N4, N5/L7/L8, N6) ;
  `gh169-excel-link-navigate.spec.ts` adapté (clic depuis le Tableau : reste en Tableau).
