# T111 — Sprint 4 (final) : Dashboards, export, impact, versioning, print

## Fichiers modifiés

- `components/{ComplianceMatrix,DiamondConflictModal,DrawioInsertButton,
  ImageInsertButton,TableInsertButton}.tsx` (`DrawioLogoIcon.tsx` : SVG pur,
  aucune chaîne, non modifié)
- `components/dashboard/{WidgetConfigModal,QueryBuilder,ResultTable,
  SqlEditor,DashboardGrid}.tsx`, `components/dashboard/widgets/{LineWidget,
  BarWidget,PieWidget,KpiWidget}.tsx`
- `components/export/ExportButton.tsx`
- `components/impact/{TestCaseEditModal,RequirementEditModal}.tsx` (aucune
  nouvelle clé — réutilisation pure de clés existantes)
- `routes/{dashboard,query,graph,diff,version-diff,versioning,baseline,
  impact-analysis,compliance}.tsx`
- `routes/print.{campaign-plan,campaign-report,dashboard,impact-analysis,
  query-result,requirements,tests}.tsx` (7 routes imprimables)
- `i18n/locales/{fr,en}.json` (+247 clés nettes, 782/782, parité vérifiée
  par script)
- `i18n/useLocale.ts` — nouvelle fonction exportée `toIntlLocale()`
  (centralisation, cf. Divergences)
- Deux fichiers hors périmètre initial du sprint touchés pour réutiliser une
  table de clés existante plutôt que d'en dupliquer une nouvelle :
  `routes/impact-analysis.tsx` (export de `CHANGE_TYPE_LABEL_KEY`/
  `STATUS_LABEL_KEY`), `routes/campaign.$campaignId.tsx` (export de
  `RUN_STATUS_LABEL_KEY`) — et `routes/campaign.$campaignId_.run.$testId.tsx`
  pour adopter `toIntlLocale()` au lieu de son propre ternaire de locale.

## Comportement implémenté

- Tous les libellés statiques des fichiers ci-dessus (titres, boutons,
  colonnes, placeholders, messages vide/erreur/confirmation, menus
  contextuels, tooltips) passent par `t()`.
- Constantes module-scope converties de littéraux résolus vers des clés de
  traduction, résolues par l'appelant : `TYPE_OPTIONS`/`SIZE_OPTIONS`
  (`WidgetConfigModal.tsx`), `SYSTEM_FIELD_DEFS`/`OPERATORS`
  (`QueryBuilder.tsx`), `readinessIssueKey()` (`baseline.tsx`, remplace
  `readinessIssue()` qui retournait du texte).
- `graph.tsx` : menu contextuel complet (branche/tag/commit — checkout,
  merge, rebase, push, delete, diff, création branche/tag) migré vers `t()`,
  y compris deux template literals ratés par la première passe regex
  (`` `Merger « ${x} » dans…` ``, `` `Conflits de merge : ${x}` ``) et le
  titre de page/onglet (`` `Arbre de versions — ${repoName}` ``, réutilise
  désormais `layout.tabTitles.graph` en l'absence de `repoName`).
- Sept routes `print.*.tsx` (rendues dans la fenêtre Electron cachée d'un
  export PDF, jamais visitées directement) migrées : titres/compteurs
  d'en-tête, textes de repli (`'Exigence'`/`'Test'` quand `id`/`name`
  absents), libellés "Statut :"/"Type de changement :"/"Résultat :"/
  "Exécuté le…".
- `print.impact-analysis.tsx` et `print.campaign-report.tsx` affichaient
  respectivement `node.status`/`req.changeType` bruts et
  `TEST_RUN_STATUS_LABELS[status]` (table française codée en dur dans
  `@polenta/types`) au lieu des tables de clés `STATUS_LABEL_KEY`/
  `CHANGE_TYPE_LABEL_KEY`/`RUN_STATUS_LABEL_KEY` déjà utilisées par les vues
  interactives équivalentes (`impact-analysis.tsx`,
  `campaign.$campaignId.tsx`) — trouvé en revue (angles altitude et
  conventions), corrigé en réexportant ces tables plutôt qu'en les
  dupliquant.
- `formatDate()` (`graph.tsx`) et `BaselineItem` (`baseline.tsx`) : la
  locale passée à `toLocaleDateString()` était figée en `'fr-FR'` —
  bascule désormais sur la langue active via `toIntlLocale()`.
- Statuts de schéma projet (`campaign.status`, `req.status`/`tc.status`
  bruts, `col.label` issu de `schema.yaml`) **non traduits** — conforme à
  `T111.md` (donnée projet). Distinction maintenue avec les énums TS fixes
  ci-dessus, qui elles doivent être traduites.
- Large réutilisation de clés existantes plutôt que duplication :
  `common.*`, `drawioInsert.fileCopiedTo` (partagé avec `ImageInsertButton`),
  `dashboardPage.widgetModal.*`, `sidebar.reorderable.private`/`shared`
  (réutilisé par le badge de portée du dashboard), `layout.tabTitles.*`,
  `schema.structureTab.interfaceCompliance`, `workspace.noWorkspace`,
  `printCampaignPlanPage.testCount` (réutilisé par `print.tests.tsx`).

## Divergences par rapport au design

Pas de divergence de périmètre de fichiers. Plusieurs classes de correctifs
trouvées et appliquées pendant le sprint, avant le premier commit :

- **Bug d'espace de nommage** : 14 sites répartis sur 6 fichiers
  (`ResultTable.tsx`, les quatre `components/dashboard/widgets/*.tsx`,
  `SqlEditor.tsx`, `print.query-result.tsx`) référençaient
  `dashboard.widget.*`/`dashboard.resultTable.*`/`dashboard.sqlEditor.*` —
  un espace de nommage inexistant. Les clés réelles avaient été ajoutées
  sous `dashboardPage.widget.*`/`dashboardPage.resultTable.*`/
  `dashboardPage.sqlEditor.*`. Sans `noUnusedLocals`/lint i18next, `tsc`
  ne détecte pas ce genre d'erreur — trouvé par revue multi-angle (angle
  A), confirmé par script de résolution des clés, corrigé partout.
- **Récidive de l'anti-pattern de pluralisation** (déjà trouvé et corrigé
  en Sprints 2 et 3) : sept clés à texte complet suffixé `(s)`
  (`compliancePage.matrixSummary`, `baselinePage.creationBlocked`/
  `deleteBaselineBodyWithComponents`/`tagWarning`,
  `impactAnalysisPage.openCount`/`testCasesFound`/`uncoveredRequirements`)
  au lieu du mécanisme `_one`/`_other`. `compliancePage.matrixSummary`
  combinait en outre deux quantités indépendantes (nb. exigences, nb.
  composants) dans une seule clé — scindée en deux clés pluralisées
  séparément (`matrixSummaryReq`/`matrixSummaryComp`), seule façon de
  pluraliser correctement deux comptes dans la même phrase avec i18next.
- **Bug de shadowing `t`** : `QueryBuilder.tsx` avait
  `types.map((t) => ...)` dans le rendu du `<select>` de type d'objet,
  masquant le `t` de traduction introduit par ce sprint dans le même
  composant. N'a causé aucune erreur aujourd'hui (aucun `t()` n'est appelé
  dans cette fermeture) mais reproduisait exactement le piège déjà
  documenté et évité ailleurs dans le même diff (`test: tc` dans les trois
  routes `print.*.tsx` de campagne/test). Renommé en `qt` par précaution.
- **Six clés dupliquant du texte identique sous des chemins différents**,
  trouvées par la revue (angle reuse), consolidées avant commit :
  `compliancePage.noWorkspaceSpecified` → `workspace.noWorkspace` ;
  `compliancePage.title` → `schema.structureTab.interfaceCompliance` ;
  `graphPage.pageTitle` → `layout.tabTitles.graph` ;
  `baselinePage.title` → `layout.tabTitles.baseline` ;
  `dashboardPage.scopePrivate`/`scopeShared` → `sidebar.reorderable.private`/
  `shared`. Une septième candidate (`baselinePage.creationError` →
  `sidebar.version.createAnalysisError`) **rejetée** : texte français
  identique mais anglais différent ("Error during creation" vs. "Error
  while creating") — fusionner aurait changé silencieusement le texte
  visible dans une des deux langues, hors périmètre d'une extraction pure.
- **Centralisation du formatage de date par locale** : le ternaire
  `i18n.language === 'en' ? 'en-US' : 'fr-FR'` était dupliqué dans trois
  fichiers (`baseline.tsx`, `graph.tsx`, et
  `campaign.$campaignId_.run.$testId.tsx` — ce dernier hors périmètre du
  sprint mais portant la même duplication depuis un sprint antérieur).
  Signalé indépendamment par deux angles de revue (altitude, simplification)
  comme un risque de dérive si une troisième langue est ajoutée. Extrait en
  une fonction unique `toIntlLocale()` dans `i18n/useLocale.ts`, appelée par
  les trois sites.
- Simplifications mineures appliquées : trois entrées `code1`/`code2`/
  `code3` identiques dans les `components` de deux `<Trans>`
  (`SqlEditor.tsx`, `compliance.tsx`) fusionnées en une seule `code` (Trans
  matche par nom de tag, pas besoin de doublons) ; résolution d'`OPERATORS`
  déplacée hors de la boucle `.map()` sur les conditions dans
  `QueryBuilder.tsx` (même optimisation déjà appliquée à
  `SYSTEM_FIELD_DEFS`, oubliée sur `OPERATORS`) ; paramètre `open` redondant
  avec `count` retiré de `impactAnalysisPage.openCount`.

Trois findings PLAUSIBLE jugés non actionnables après examen :
- Prolifération de `useTranslation()` dans des sous-composants récursifs/de
  ligne (`ComplianceMatrix.CellLabel`, `ImpactNodeStatusEditor`) — même
  raisonnement que Sprint 3 : pattern idiomatique déjà validé, threader `t`
  en prop across plusieurs couches serait une régression de cohérence pour
  un bénéfice non mesuré sur des arbres de taille modeste.
- Restructuration d'`OPERATORS` pour donner un `labelKey` non-nul à tous les
  opérateurs symboliques (`=`, `≠`, `>`, `<`) plutôt que le couple actuel
  `labelKey: string | null` / `symbol: string | null` résolu par
  `op.symbol ?? t(op.labelKey!)` — amélioration de robustesse légitime mais
  hors périmètre d'une extraction de chaînes pure ; le code actuel
  type-check et fonctionne correctement.
- `print.tests.tsx` réutilise `printCampaignPlanPage.testCount` (texte
  identique "N test(s)") plutôt qu'une clé `printTestsPage.testCount`
  dédiée — nommage cross-namespace jugé cohérent avec la pratique de
  réutilisation déjà répandue dans le reste du sprint, pas une régression.

## Revue

`/code-review` (effort medium demandé, exécuté à effort élevé — 8 angles,
deux vagues du fait d'une limite de session ayant interrompu la première
vague en cours de route ; un premier passage partiel de l'angle A avant
l'interruption a lui-même révélé le bug d'espace de nommage ci-dessus,
corrigé avant de relancer les 8 angles au complet) sur le diff complet du
sprint (~1090 lignes nettes, 38 fichiers). Angles B (removed-behavior) et C
(cross-file tracer) : aucun finding après vérification exhaustive
(intégrité des ~260 clés référencées, cohérence des signatures de fonctions
modifiées, absence de config module-scope non résolue). Angles A, reuse,
simplification, efficiency, altitude, conventions : findings CONFIRMED
corrigés (détaillés ci-dessus) ; trois findings PLAUSIBLE examinés puis
non actionnés pour les raisons documentées ci-dessus.

`pnpm typecheck` propre après chaque vague de correctifs (le paquet
`@polenta/api`, non touché par ce sprint, a une erreur de compilation
préexistante et indépendante — `SystemNode.url` — vérifiée présente sur
`master` avant ce sprint, hors périmètre). Scripts de contrôle exécutés
après chaque lot de fichiers puis en validation finale : parité des clés
`fr.json`/`en.json` (782/782, aucune divergence), résolution de chaque
`t()`/`i18nKey` référencé dans le diff vers une clé (ou paire `_one`/
`_other`) réellement présente.

## Comment tester manuellement

1. `pnpm --filter @polenta/desktop dev` (ou `pnpm build` + lancer
   l'exécutable packagé).
2. Basculer en anglais depuis le panneau Compte.
3. Dashboards : créer/éditer un widget (les 4 types de chart), vérifier les
   états vides ("Choose a category and a measure"/"No data"), le tableau de
   résultat de requête (compteur de lignes singulier/pluriel), l'éditeur
   SQL (indice sur les tables disponibles avec balises `<code>`).
4. Arbre de versions (`/graph`) : ouvrir le menu contextuel sur une branche,
   un tag et un commit — vérifier chaque item (checkout, merge, rebase,
   push, delete avec confirmation "Confirm?", diff) ; vérifier que le titre
   de page/onglet et les badges de branche/tag sont traduits ; vérifier le
   format de date (mois en anglais).
5. Baselines (`/baseline`) : créer une baseline avec repos en attente
   (message de blocage singulier/pluriel), supprimer une baseline avec
   composants (modale avec `<code>` inline et pluriel), vérifier le format
   de date de création.
6. Analyse d'impact (`/impact-analysis`) : vérifier les libellés de statut
   et de type de changement, le compteur "N open / M total".
7. Exports PDF (bouton Export sur Exigences, Tests, Campagne, Dashboard,
   Analyse d'impact, résultat de requête) : ouvrir chaque export généré en
   anglais et vérifier l'absence de chaîne française résiduelle, en
   particulier les statuts de test/type de changement dans les exports
   campagne et analyse d'impact (bug corrigé ce sprint).
8. Non testé interactivement dans cette session (pas d'affichage Electron
   attachable dans ce bac à sable) — vérification statique uniquement
   (typecheck, parité JSON, résolution des clés, revue de code multi-angle).
   Attend validation manuelle humaine.

## Clôture du ticket

Sprint final de T111. Conformément à `T111.md` § Refs SPEC : création de
`specs/SPEC-I18N.md` (architecture i18n, convention des clés, périmètre
traduit/non traduit, contrôle de non-régression) et mise à jour de
`SPEC-INDEX.md`. Ticket archivé de `TICKETS.md` vers `tickets_archive.md`
après ce sprint, en attente de validation/merge humaine (cf. `WORKFLOW.md`).
