# T111 — Sprint 3 : Vue Système (exigences, tests, campagnes)

## Fichiers modifiés

- `components/system/{ExcelView,WordView,ElementTree,SystemView,EditView,
  CampaignListView,LinkCombobox,RichTextToolbar}.tsx`
- `components/{StepsTable,TestParamFields,FilterOptionsToggle,RichTextField}.tsx`
  (`DynamicField.tsx`/`RichTextViewer.tsx` : aucune chaîne française en dur trouvée,
  non modifiés)
- `routes/{req.$reqId,req.new,requirements,test.$testId,test.new,tests,
  campaign.$campaignId,campaign.$campaignId_.execute.$testId,
  campaign.$campaignId_.run.$testId,campaign.new}.tsx`
- `i18n/locales/{fr,en}.json` (+~230 clés nettes après consolidation, 535/535,
  parité vérifiée par script)
- Deux fichiers hors périmètre Sprint 3 touchés pour une consolidation de clé
  dupliquée : `components/schema/objectTypeEditor.tsx`,
  `components/sidebar/version/VersionRepoFolder.tsx` (`sidebar.version.yes`/`no`
  → `common.yes`/`no`, changement bénin confirmé par la revue — les deux clés
  étaient déjà traduites, seule leur adresse change)

## Comportement implémenté

- Tous les libellés statiques des fichiers ci-dessus (titres, boutons, colonnes,
  placeholders, messages vide/erreur/confirmation, tooltips) passent par `t()`.
- Constantes module-scope stockant des libellés d'énumérations internes fixes
  (pas de la donnée schema.yaml) converties en tables de clés, résolues par
  l'appelant : `RUN_STATUS_LABEL_KEY` (`TestRunStatus`), `STEP_RESULT_LABEL_KEY`/
  `GLOBAL_RESULT_LABEL_KEY` (`StepResultValue`/`TestRunResult`, dupliqués sur deux
  routes execute/run — mêmes clés réutilisées), `labelKeyForSystem()`
  (`EditView.tsx`, remplace `labelForSystem()` qui retournait du texte).
- `campaign.$campaignId_.run.$testId.tsx` : la locale passée à
  `toLocaleDateString()` était figée en `'fr-FR'` — bascule désormais sur
  `i18n.language` (`'en-US'`/`'fr-FR'`), sinon la date du run restait toujours en
  français même en UI anglaise.
- Statuts de schéma projet (`req.status`, `tc.status`, `campaign.status` bruts,
  `s.label ?? s.name`) **non traduits** — conforme à `T111.md` (donnée projet).
- Large réutilisation de clés existantes plutôt que duplication : `common.*`
  (cancel/delete/loading/yes/no/creating/unknownError/projectNotLoaded/
  valuePlaceholder — ce dernier trio ajouté ce sprint), `system.shared.*`
  (clickToEdit/clickToNavigate/deleteTitle/deleteCount/inlineCode/codeBlock —
  partagés entre ExcelView/WordView/ElementTree/LinkCombobox/RichTextField/
  RichTextToolbar), `layout.viewHeader.back`, `requirementsPage.titleLabel`,
  `testsPage.preconditions`/`postconditions`, `system.wordView.stepsHeading`,
  `system.stepsTable.action`/`expectedResult`, `schema.editor.colLabel`.

## Divergences par rapport au design

Aucune divergence de périmètre. Deux classes de correctifs appliqués pendant le
sprint, trouvés par la revue multi-angle avant commit :

- **Bug de shadowing `t`** : dans `campaign.$campaignId.tsx`, un
  `filteredAvailable.map(t => ...)` nommait sa variable de boucle `t`, masquant
  le `t` de traduction du composant parent — `t('campaignPage.alreadyPresent', …)`
  à l'intérieur de cette fermeture tentait d'appeler un `TestCase` comme une
  fonction (`tsc` : `TS2349 This expression is not callable`). Renommé en
  `availableTest`. `pnpm typecheck` a immédiatement révélé l'erreur — aucune
  autre occurrence du même risque trouvée après audit de tous les
  `.map(t =>`/`.find(t =>` du diff (aucun n'appelle `t()` dans sa fermeture).
- **Récidive de l'anti-pattern de pluralisation** (déjà trouvé et corrigé en
  Sprint 2) : les deux modales de confirmation de suppression (`ElementTree.tsx`,
  `ExcelView.tsx`, code dupliqué à l'identique entre les deux fichiers) choisissaient
  entre deux clés à texte complet (`deleteSingle`/`deleteMultiple`) via un
  ternaire `length > 1`, au lieu du mécanisme `_one`/`_other` d'i18next préconisé
  par `T111-design.md`. Fusionné en une seule clé `system.shared.deleteCount`
  pluralisée sur `count`.

Cinq clés dupliquant du texte identique sous des chemins différents, trouvées
par la revue (angle reuse), consolidées avant commit :
`system.excelView.clickToEdit`/`system.wordView.clickToEdit` → `system.shared.clickToEdit` ;
`system.editView.colName` → réutilise `system.wordView.colName` ;
`system.fieldConfig.colLabel` → réutilise `schema.editor.colLabel` (clé Sprint 1
déjà utilisée par `objectTypeEditor.tsx` pour le même concept de colonne).

Deux findings PLAUSIBLE jugés non actionnables après examen — préservation du
texte visible existant plutôt que fusion de clé :
- `requirementsPage.saving`/`save` ("Sauvegarde…"/"Sauvegarder") vs. le
  couple `common.save`("Enregistrer")/`*.saving`("Enregistrement…") utilisé
  ailleurs — les deux mots français coexistaient déjà avant ce sprint (texte
  d'origine transcrit fidèlement, pas une régression introduite ici) ; fusionner
  les clés changerait silencieusement le texte affiché, hors périmètre d'une
  extraction pure.
- `system.filterOptionsToggle.caseSensitive` ("Sensible à la casse") vs.
  `sidebar.search.caseSensitive` ("Respecter la casse") — même raisonnement,
  formulations déjà distinctes avant ce sprint dans les deux composants.
Finding PLAUSIBLE sur la prolifération de `useTranslation()` dans les
sous-composants de ligne/cellule (ExcelView/WordView/ElementTree) jugé non
actionnable : pattern déjà validé comme idiomatique react-i18next par la revue
du Sprint 2 elle-même (lecture de contexte peu coûteuse) ; threader `t` en prop
à travers de nombreuses couches serait une régression de cohérence avec le
reste du code base pour un bénéfice non mesuré.

## Revue

`/code-review` (effort high, 8 angles, exécutés en parallèle) sur le diff complet
du sprint (~1090 lignes, 26 fichiers). Angles A, B, C : aucun finding (après
vérification exhaustive — parité JSON, couverture des tables de clés
d'énumération, intégrité des interpolations, absence de traduction accidentelle
de donnée métier). Angles reuse et altitude : findings CONFIRMED corrigés
(ci-dessus). Angles simplification, efficiency, conventions : findings PLAUSIBLE
examinés, non actionnés pour les raisons documentées ci-dessus.

`pnpm typecheck` propre après les correctifs (a révélé puis validé la correction
du bug de shadowing `t`). Script de contrôle : parité des clés `fr.json`/`en.json`
(535/535, aucune divergence), JSON valide dans les deux fichiers, aucune référence
résiduelle aux clés supprimées lors de la consolidation.

## Comment tester manuellement

1. `pnpm --filter @polenta/desktop dev` (ou `pnpm build` + lancer l'exécutable
   packagé).
2. Basculer en anglais depuis le panneau Compte.
3. Ouvrir un composant avec des exigences/tests dans la Vue Système, basculer
   entre vues Excel/Document/Édition : vérifier l'absence de chaîne française
   restante (en-têtes de colonne, boutons, tooltips, menus contextuels).
4. Supprimer un dossier contenant plusieurs éléments dans l'arbre (Excel ou
   Document) : la modale de confirmation doit afficher "These elements will be
   deleted." (EN, pluriel) / "Cet élément sera supprimé." (FR, singulier) selon
   le nombre d'éléments sélectionnés — vérifier spécifiquement avec 1 élément
   puis plusieurs.
5. Créer une exigence/test/campagne (`req.new`, `test.new`, `campaign.new`) :
   vérifier labels, placeholders, boutons Créer/Annuler traduits.
6. Dans une campagne active, exécuter un test (`campaign.$campaignId/execute`)
   puis consulter son résultat (`.../run`) : vérifier les libellés de statut
   (Passé/Échoué/Bloqué/Incomplet/Ignoré/Non exécuté) traduits, et que la date
   d'exécution du run bascule de format français à anglais avec la langue.
7. Non testé interactivement dans cette session (pas d'affichage Electron
   attachable dans ce bac à sable) — vérification statique uniquement
   (typecheck, parité JSON, revue de code multi-angle). Attend validation
   manuelle humaine avant Sprint 4.
