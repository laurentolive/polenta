# GH229 — Sprint 2 : ID dans le texte, autres écrans, SPEC

## Fichiers modifiés

- `lib/elementRefs.ts` (nouveau) — `elementRefRegExp`, `findElementRefs`, règle markdown-it
  `element_refs` (hors code et texte de lien Markdown).
- `tiptap/ElementRefDecoration.ts` (nouveau) — décorations du viewer Tiptap en lecture seule.
- `components/element/elementRefDelegation.tsx` (nouveau) — gestes délégués
  (`useElementRefDelegation`), `useElementRefExists`, `ElementRefText`.
- `lib/staticRichText.tsx`, `components/RichTextViewer.tsx` — ID du texte en liens.
- `components/parameters/ParamRefText.tsx`, `components/system/ExcelView.tsx`,
  `components/system/WordView.tsx` — champs `text` / `textarea` en lecture.
- `index.css` — style `.element-ref`.
- Écrans : `routes/campaign.$campaignId.tsx` (test, exigence, campagne d'origine ;
  `openRequirement` retiré), `routes/campaign.new.tsx`, `components/campaign/TestPickerModal.tsx`,
  `CampaignCarryPanel.tsx`, `ReqInstancePicker.tsx`, `components/RunParamsInfo.tsx`,
  `components/impact/RevalidationList.tsx`, `components/parameters/ParameterEditDialog.tsx`
  (confirmation et « Utilisé par »), `components/dashboard/DrillDownModal.tsx`,
  `components/dashboard/ResultTable.tsx` (cellule = ID existant → lien, sinon ID du texte),
  `routes/constellation.tsx`.
- Tableau : message « <ID> est masqué par le filtre » (§3.4).

## Comportement

- Un ID Polenta exact d'un élément existant, écrit dans un richtext / texte en lecture, est un
  lien (popup, clic, Ctrl+clic) ; ID inexistant, collé à une lettre ou un chiffre, en code ou
  dans un lien Markdown : texte.
- Constellation et analyse d'impact : le clic simple garde le geste de l'écran (recentrer le
  graphe, fiche de l'élément) ; Ctrl+clic et aperçu suivent la règle commune.

## Divergences avec le design

- Message « masqué par le filtre » : vue Tableau seulement (le Document n'a pas de filtre par
  colonne et masque les éléments hors filtre texte sans ligne de repli) — hors critères de la
  spec.
- `SearchPanel` / `SearchResultsDoc`, listes `/requirements`, `/tests`, `CampaignListView`,
  `ComplianceMatrix` : ID propre de la ligne, non convertis (spec §2.1). Les ID du texte des
  résultats de recherche le sont (viewer partagé).

## Mises à jour SPEC

- `SPEC-REQ-requirements.md` §2.1 (`displayIdField`), §3.2g (nouveau : ID d'élément dans le
  texte), §6.2 (nouveau : ID affiché dans les liens).
- `SPEC-SYSTEM-VIEW.md` §Liens d'élément (nouveau), ligne « Retour (lien interne) » de la
  toolbar, §Configuration des champs (onglet « Popup »).
- `SPEC-INDEX.md` : colonnes `MAJ` → GH229 pour ces sections.
- `SPEC-ELECTRON-DESKTOP.md` §19.x, `SPEC-TESTS.md`, `SPEC-MCP-SERVER.md` : relus, sans écart
  (routes et onglets inchangés ; `displayIdField` passe par le schéma d'objet déjà décrit côté
  MCP, documenté dans `AGENTS.md`).

## Tests

- Unitaires : `lib/elementRefs.gh229.test.ts` (L4, L5).
- e2e : `e2e-web/gh229-element-refs.spec.ts` (N9/L4 richtext, N8 campagne, N7 ID affiché + L3
  par IPC).

## Comment tester manuellement

1. Tableau des exigences, colonnes de liens affichées : clic sur un ID de test → Tableau des
   tests sur ce test (ligne et arbre sélectionnés) ; Précédent revient. Ctrl+clic → nouvel
   onglet, l'onglet source est intact.
2. Survoler un ID 0,5 s : popup ; ⚙️ → onglet « Popup » → cocher Énoncé : la popup l'affiche.
3. Modèle de données → type → « ID affiché dans les liens » = Titre : les liens montrent le titre.
4. Écrire « voir SYS-0001 » dans un richtext : lien en lecture.
5. Filtre texte actif excluant la cible, puis clic sur son ID depuis un autre type : message
   « masqué par le filtre ».
6. Fiche campagne : ID du test, de l'exigence d'instance, campagne d'origine → liens.

## Correctif après test sur PH2 (validation)

Sur un gros projet, un lien (ou un clic dans l'arbre) sélectionnait bien l'élément dans l'arbre
mais la vue Tableau restait en haut : le rendu complet des lignes (transition) n'aboutissait
jamais, la ligne cible n'existait pas. Les lignes jusqu'à la cible du goto / de l'ancrage sont
désormais rendues tout de suite (`renderedRowCount`, `ExcelView`). La cause du rendu complet
jamais atteint, présente aussi sans GH229, est suivie dans #246. Vérifié sur une copie de PH2
(Tableau et Document, lien et arbre).
