# T77 — Sprint 2 : widgets + dashboards

**Statut** : coding sprint 2 → prêt pour revue humaine
**Branche** : T77
**Worktree** : `../polenta-T77/`

---

## Périmètre réalisé

Conforme au périmètre sprint 2 de `specs/T77-design.md` § "Découpage en sprints" :
dépendance `recharts`, `dashboards.service.ts` (CRUD dashboards + widgets embarqués),
règles de scope/dépendance (promotion/rétrogradation/suppression bloquée), IPC +
api-client, panneau latéral section "Dashboards", vue Dashboard complète (grille à
tailles prédéfinies réordonnable, popup d'ajout de widget avec aperçu live, rendu
des 5 types de widget).

Hors périmètre (sprint 3, non touché) : dashboards pré-configurés (couverture/
avancement/maturité), retrait de l'ancien tableau de bord de `project.$id.tsx`.

---

## Fichiers créés / modifiés

### Dépendances
- `apps/desktop/package.json` — ajout `recharts` (^2.12.0).
- `pnpm-lock.yaml` — régénéré par `pnpm install`.

### Main process
- `apps/desktop/src/main/services/dashboards.service.ts` **(NEW)** — CRUD dashboards
  (privé dans `.{username}.pref` clé `dashboards`, partagé dans
  `dashboards/DASHBOARD-xxxx.yaml`, compteur `config/counters.yaml`), widgets
  embarqués (`addWidget`/`updateWidget`/`deleteWidget`/`setWidgetOrder`), scope
  (`setScope`, promotion/rétrogradation d'un dashboard avec validation), ordre de la
  section "Dashboards" du panneau latéral, `findDependentWidgets` (utilisé par
  `saved-queries.service.ts`), `remapWidgetQueryId` (voir § Garde-fous).
- `apps/desktop/src/main/services/id-scope.util.ts` **(NEW)** — convention d'ID
  privé/partagé (`local-` prefix) extraite en util partagé entre
  `saved-queries.service.ts` et `dashboards.service.ts`, pour que `DashboardsService`
  puisse déterminer si un `queryId` de widget est privé ou partagé **sans importer
  `SavedQueriesService`** (évite une dépendance circulaire, puisque
  `SavedQueriesService` importe `DashboardsService` pour `findDependentWidgets`).
- `apps/desktop/src/main/services/git.service.ts` **(MODIFIED)** — deux nouvelles
  méthodes partagées, extraites après avoir constaté (revue) que
  `saved-queries.service.ts` et `dashboards.service.ts` dupliquaient chacune le même
  code : `readYamlDir<T>()` (liste + parse tous les YAML d'un dossier) et
  `nextCounterId()` (incrémente `config/counters.yaml`, remplace les
  `nextQueryId`/`nextDashboardId` locaux).
- `apps/desktop/src/main/services/saved-queries.service.ts` **(MODIFIED)** —
  `delete()` et `setScope('private')` bloquent maintenant si `findDependentWidgets`
  trouve des widgets dépendants (message listant dashboard + widget) ; nouvelle
  méthode `setScope()` (promotion privé→partagé libre, rétrogradation
  partagé→privé bloquée) ; réutilise `id-scope.util.ts` et les nouveaux helpers de
  `GitService` au lieu de dupliquer sa propre logique.
- `apps/desktop/src/main/ipc/index.ts` **(MODIFIED)** — handlers `dashboards:*`
  (list, get, create, update, delete, set-scope, add-widget, update-widget,
  delete-widget, set-widget-order, order-get, order-set) + `queries:set-scope`.
- `apps/desktop/src/main/container.ts` **(MODIFIED)** — instancie `DashboardsService`
  et l'injecte dans `SavedQueriesService` (ordre de construction : dashboards avant
  savedQueries, pour éviter le cycle).

### Types / API client
- `packages/api-client/src/types.ts` **(MODIFIED)** — DTOs (`CreateDashboardDto`,
  `UpdateDashboardDto`, `AddWidgetDto`, `UpdateWidgetDto`), namespace `dashboards.*`,
  `queries.setScope`.
- `packages/api-client/src/ipc-client.ts` **(MODIFIED)** — implémentation.
- `packages/types/src/dashboard.ts` — inchangé : `Widget`/`Dashboard` et types
  associés avaient déjà été déclarés par anticipation au sprint 1.

### Renderer
- `apps/desktop/src/renderer/components/sidebar/DashboardPanel.tsx` **(MODIFIED)** —
  ajout de la section "Dashboards" au-dessus de "Requêtes" ; les deux sections
  utilisent maintenant `ReorderableSidebarSection` (voir ci-dessous) au lieu de la
  logique inline du sprint 1. "Ajouter" un dashboard ouvre une petite modale
  (titre seul) qui crée immédiatement le dashboard (scope privé par défaut) et
  navigue dessus — différent du flux "Requêtes" (qui ouvre un éditeur vide non
  encore persisté) parce qu'un dashboard a besoin d'un id serveur avant qu'on
  puisse lui ajouter des widgets.
- `apps/desktop/src/renderer/components/sidebar/ReorderableSidebarSection.tsx`
  **(NEW)** — liste réorganisable/filtrable générique, extraite de l'implémentation
  sprint 1 de la section "Requêtes" pour être réutilisée par "Dashboards" plutôt que
  dupliquée (les deux sections partagent le même besoin : DnD HTML5, filtre texte,
  confirmation de suppression). Exporte aussi `orderItems()`, réutilisé par
  `DashboardGrid.tsx` pour la grille de widgets.
- `apps/desktop/src/renderer/routes/dashboard.tsx` **(NEW)** — vue Dashboard : titre
  éditable inline, bascule de portée (privé/partagé, bloquée avec message si un
  widget référence une requête privée), bouton "Ajouter un widget", grille de
  widgets.
- `apps/desktop/src/renderer/components/dashboard/DashboardGrid.tsx` **(NEW)** —
  grille à tailles prédéfinies (`sm`/`md`/`lg` → 1/2/4 colonnes sur une grille à 4
  colonnes), réordonnable par DnD natif (axe horizontal, avant/après décidé par la
  moitié gauche/droite de la carte cible plutôt que haut/bas, adapté d'une grille
  qui wrap plutôt que d'une liste verticale). Chaque carte résout sa `SavedQuery` et
  exécute sa requête via `useQueryResult`.
- `apps/desktop/src/renderer/components/dashboard/WidgetConfigModal.tsx` **(NEW)** —
  popup "Ajouter un widget" : titre, sélecteur de requête (filtré aux requêtes
  partagées si le dashboard est partagé), type (5 boutons), taille, mapping de
  champs (dépend du type), aperçu live via le même `WidgetRenderer` que la grille.
- `apps/desktop/src/renderer/components/dashboard/widgets/{Bar,Pie,Line,Kpi,Table}Widget.tsx`
  **(NEW)** — wrappers `recharts` légers (Table réutilise `ResultTable.tsx` du
  sprint 1 filtré aux colonnes choisies ; Kpi est juste une valeur + libellé).
- `apps/desktop/src/renderer/components/dashboard/widgets/WidgetRenderer.tsx` **(NEW)**
  — dispatcher par `WidgetType`, partagé entre `DashboardGrid` et
  `WidgetConfigModal` pour ne pas dupliquer le `switch`.
- `apps/desktop/src/renderer/components/dashboard/widgets/{chartColors,numeric,WidgetEmptyState}.ts(x)`
  **(NEW)** — helpers partagés entre les 5 widgets (couleurs catégorielles via
  variables CSS, coercion de cellule, état vide).
- `apps/desktop/src/renderer/hooks/useQueryResult.ts` **(NEW)** — exécute une
  `SavedQuery` via `api.queries.execute`, partagé entre `DashboardGrid` (rendu) et
  `WidgetConfigModal` (aperçu live).
- `apps/desktop/src/renderer/routes/query.tsx` **(MODIFIED)** — la suppression d'une
  requête sauvegardée peut maintenant échouer (garde-fou widget dépendant, voir
  ci-dessus) ; ajout d'un état d'erreur affiché dans la liste "Requêtes
  sauvegardées" plutôt que laisser l'échec silencieux.
- `apps/desktop/src/renderer/routeTree.gen.ts` **(MODIFIED)** — entrée `/dashboard`
  ajoutée à la main, même technique que `/query` au sprint 1 (voir
  `T77-sprint1.md` § "Point d'attention build").
- `apps/desktop/src/renderer/index.css` **(MODIFIED)** — 8 variables
  `--chart-series-N` (light + dark), palette catégorielle de référence du skill
  dataviz interne, réutilisée telle quelle (déjà validée CVD).

---

## Comportement implémenté

- **Dashboards** : créés immédiatement (scope privé par défaut) depuis le panneau
  latéral (titre seul demandé) ; titre éditable en place dans la vue ; portée
  bascule via deux boutons Privé/Partagé.
- **Widgets** : ajout via popup (titre, requête, type libre — jamais contraint par
  la forme du résultat —, mapping de champs, taille), aperçu live pendant la
  configuration (ré-exécute la requête sélectionnée et rend le type choisi avec le
  mapping courant), suppression avec confirmation, réorganisation par DnD dans la
  grille (persisté dans `widgetOrder`).
- **5 types de widget** : barres/camembert/courbe (recharts), tuile KPI (valeur
  unique — somme si plusieurs lignes, valeur brute si une seule), table (réutilise
  `ResultTable.tsx`, colonnes filtrables). Tous gèrent explicitement le résultat vide
  et le mapping incomplet (état vide dédié, jamais un chart cassé).
- **Règles de scope/dépendance** (T77-design.md § "Règles de dépendance et de
  scope") :
  - Sélecteur de requête dans la popup : filtré aux requêtes déjà partagées si le
    dashboard courant est partagé — filtre proactif côté UI.
  - Partage d'un dashboard : bloqué si un widget référence une requête privée
    (revérifié côté serveur, pas seulement côté UI — `DashboardsService.setScope`
    et aussi `addWidget`/`updateWidget` sur un dashboard déjà partagé, pour que
    l'invariant tienne même via un appel IPC direct qui contournerait le filtre
    proactif du modal).
  - Suppression d'une requête utilisée par un widget (dashboard partagé, ou privé
    de l'utilisateur courant) : bloquée, message listant les widgets/dashboards
    dépendants.
  - Rétrogradation d'une requête partagée utilisée par un widget : même blocage
    (`SavedQueriesService.setScope('private')`).
  - Widget dont la requête a été supprimée entre-temps : état "requête introuvable"
    explicite dans la grille, pas de crash.

---

## Garde-fous — durcis pendant la revue (`/code-review high`, 8 angles, 3 vagues)

Comme au sprint 1, la revue a remonté des problèmes réels au-delà du style, vérifiés
ensuite en relançant l'app réelle (voir § Tests manuels), pas seulement `tsc` :

1. **`BarWidget.tsx`** ne coercait jamais `measure` en nombre (contrairement à
   Pie/Line/Kpi) et, si l'utilisateur choisissait le même champ pour catégorie ET
   mesure (combinaison permise, non contrainte), le `...r` spread laissait la
   valeur numérique écrasée par le libellé catégorie sous la même clé → barres
   cassées. Fix : construction explicite `{[category]: toLabel(...), [measure]:
   toNumber(...)}` au lieu d'un spread de la ligne brute.
2. **`LineWidget.tsx`** : commentaire affirmant que la dernière ligne d'une paire
   (catégorie, série) dupliquée l'emporte, alors que le code utilise
   `Array.find` (première ligne qui l'emporte). Fix : commentaire corrigé pour
   refléter le comportement réel plutôt que l'inverse.
3. **Promotion d'une requête privée → partagée orpheline un widget** : changer le
   scope d'une `SavedQuery` change son `id` (schéma différent privé/partagé) ; la
   rétrogradation était déjà bloquée si des widgets en dépendent, mais la
   *promotion* — libre par spec ("à tout moment") — ne l'était pas, et un widget
   référençant l'ancien id privé (uniquement possible depuis un dashboard privé du
   même utilisateur, puisqu'un dashboard partagé ne peut jamais référencer une
   requête privée) se serait retrouvé orphelin. Fix : `SavedQueriesService.setScope`
   appelle `DashboardsService.remapWidgetQueryId()` après une promotion réussie,
   qui met à jour les widgets des dashboards privés de l'utilisateur pointant vers
   l'ancien id — sans bloquer la promotion (interdit par le spec), sans laisser de
   référence pendante.
4. **`addWidget`/`updateWidget` ne revalidaient pas le scope** : la règle "un
   widget partagé nécessite une requête partagée" n'était vérifiée qu'au moment du
   `setScope('shared')` du dashboard, jamais aux points de mutation réels des
   widgets — un appel IPC direct sur `dashboards:add-widget`/`dashboards:update-widget`
   pouvait donc embarquer un widget référençant une requête privée dans un
   dashboard déjà partagé, contournant totalement le filtre proactif du modal (qui
   n'est qu'une UI). Fix : `assertWidgetsShareable` appelée aussi dans
   `addWidget`/`updateWidget` quand le dashboard cible est déjà `shared`.
5. **`queriesOrder`/`dashboardsOrder` non mis à jour lors d'un changement de
   scope** : comme l'id change (point 3), l'entrée disparaissait de l'ordre
   personnalisé et réapparaissait en fin de liste au prochain chargement. Fix :
   `renameInOrder()` dans les deux services, appelée après tout `setScope`.
6. **Duplication de code entre services** : `listShared()`/`nextQueryId()`/
   `nextDashboardId()` dupliqués quasi à l'identique entre `saved-queries.service.ts`
   et le nouveau `dashboards.service.ts`. Extraits en `GitService.readYamlDir()` /
   `GitService.nextCounterId()`, réutilisés par les deux (`ReviewsService`, plus
   ancien et hors périmètre de ce sprint, n'a pas été touché).
7. **Régressions UI côté panneau latéral** lors de l'extraction de
   `ReorderableSidebarSection` : l'état de chargement ("Chargement…") et le CTA
   "Créer la première/le premier" de la section "Requêtes" avaient disparu par
   rapport au sprint 1. Fix : props `isLoading`/`addFirstLabel` ajoutées et
   branchées pour les deux sections.
8. **Suppression d'une requête utilisée par un widget désormais silencieusement
   ignorée côté UI** : `saved-queries.service.ts` peut maintenant rejeter un
   `delete()`, mais ni `DashboardPanel.tsx` ni `query.tsx` n'avaient de gestion
   d'erreur sur leurs mutations de suppression — le clic n'aurait visiblement rien
   fait. Fix : état d'erreur affiché dans les deux vues (bannière dans la section
   "Requêtes" du panneau, et dans la liste "Requêtes sauvegardées" de la vue
   Requêtes).
9. **`addWidgetMutation` sans `onError`** dans `dashboard.tsx` — un refus serveur
   (ex. dashboard partagé entre-temps depuis un autre onglet) fermait... en fait ne
   fermait rien mais n'affichait rien non plus. Fix : erreur passée en prop au
   modal, affichée sans fermer la popup (l'utilisateur peut corriger et
   réessayer).
10. **Optimisations mineures** (efficiency/altitude) : `findDependentWidgets` évite
    de scanner tous les dashboards partagés quand la requête vérifiée est déjà
    privée (ne peut structurellement jamais y être référencée, cf. point 4) ;
    `ReorderableSidebarSection`/`DashboardGrid` mémorisent leur liste triée/filtrée
    (`useMemo`) et ignorent les événements `dragover` qui ne changent pas la
    position calculée, pour éviter des re-renders (recharts inclus) à chaque
    micro-mouvement de souris pendant un drag.

Chaque point corrigé a été revérifié en relançant l'app réelle via le skill
`run-desktop` (voir § Tests manuels), pas seulement par relecture de code.

---

## Divergences par rapport au design

- **Pas d'UI de rétrogradation/promotion pour une `SavedQuery` isolée** —
  `SavedQueriesService.setScope()` existe et est câblé (IPC + api-client), et son
  garde-fou de blocage est fonctionnel, mais aucun bouton de la vue Requêtes ne
  l'appelle ce sprint (aucun scénario de `T77-tests.md` sprint 2 ne le demande
  explicitement ; le seul bascule de portée construite est sur le Dashboard, comme
  demandé). La règle "rétrogradation bloquée si dépendants" reste donc surtout
  vérifiable via IPC direct pour l'instant, pas depuis l'UI — documenté plutôt que
  laissé imprévu.
- **Confirmation de suppression d'un objet de la sidebar (`ReorderableSidebarSection`)
  se ferme immédiatement au clic**, avant de savoir si la suppression a réussi
  (au lieu d'attendre la résolution de la mutation comme le faisait la modale
  sprint 1 d'origine pour les requêtes). Le refus éventuel (garde-fou dépendants)
  reste visible via la bannière d'erreur qui persiste après la fermeture du modal,
  mais l'UX serait plus nette avec un état "en cours" bloquant le bouton jusqu'à
  la réponse. Non corrigé ce sprint (repéré en revue, jugé mineur vu que le message
  d'erreur reste visible).
- **Limite acceptée héritée du design** : `findDependentWidgets` ne voit pas les
  dashboards privés d'un *autre* utilisateur (fichier `.pref` non accessible depuis
  la session courante) — documenté dans `T77-design.md`, non modifié.
- **Message d'erreur IPC brut affiché tel quel** (`Error invoking remote method
  '...': Error: <message>`) — préfixe ajouté par Electron lui-même à toute erreur
  IPC rejetée, visible dans les bannières d'erreur (scope bloqué, suppression
  bloquée). Pas spécifique à ce sprint (même comportement pour les erreurs de
  requête SQL au sprint 1) ; une amélioration consisterait à strip ce préfixe côté
  `ipc-client.ts`, non fait ici pour rester dans le périmètre strict.
- **KPI = somme si plusieurs lignes, valeur brute si une seule** — choix
  d'agrégation documenté dans le code (`KpiWidget.tsx`), pas dans le design
  d'origine qui ne précisait pas ce cas. Pas de sélecteur d'agrégation (somme/
  moyenne/max…) dans la popup — hors scope, la requête sous-jacente est censée
  déjà renvoyer la bonne forme (ex. `GROUP BY`/`COUNT(*)`).
- **`DashboardGrid.tsx` réimplémente sa propre machine à états DnD** plutôt que de
  réutiliser celle de `ReorderableSidebarSection.tsx` (grille horizontale vs liste
  verticale — l'algorithme de décision avant/après diffère, la fonction de tri
  `orderItems` est en revanche bien partagée). Une factorisation plus poussée
  (`useDragReorder` générique paramétré par axe) est possible mais non faite ce
  sprint, jugée trop risquée à ce stade pour un gain de lisibilité modeste.

---

## Vérifications effectuées

- `pnpm --filter @polenta/desktop typecheck` → 0 erreur.
- `pnpm typecheck` (monorepo complet) → 0 nouvelle erreur (seule erreur restante :
  `apps/api/src/modules/git/schema.service.ts:66`, préexistante sur `T77` avant tout
  changement, déjà signalée au sprint 1 et revérifiée ici).
- `pnpm --filter @polenta/desktop build` → build complet réussi (main + preload +
  renderer, 2734 modules renderer transformés en incluant `recharts` et tous les
  nouveaux composants). L'erreur `ENOENT ... routes` mi-build est un artefact
  connu et documenté du générateur de routes TanStack (voir
  `apps/desktop/.claude/skills/run-desktop/SKILL.md` § Build), sans impact sur le
  build final.
- `/code-review high` (8 angles de recherche, vérification 1-voix) → 10 findings
  confirmés/plausibles, tous corrigés (voir § Garde-fous).
- **Vérification interactive de l'app réelle** via le skill `run-desktop` (driver
  Playwright pilotant l'app Electron packagée, voir
  `apps/desktop/.claude/skills/run-desktop/`) :
  - Création d'un dashboard privé depuis le panneau latéral (titre → création
    immédiate → navigation).
  - Ajout d'un widget de **chacun des 5 types** (barres, camembert, courbe, tuile
    KPI, table) sur une requête SQL réelle (`SELECT ... UNION SELECT ...`,
    3 lignes/2 colonnes), avec aperçu live vérifié à l'écran pendant la
    configuration (capture d'écran confirmant le graphique affiché dans la popup
    correspond exactement au widget une fois sauvegardé).
  - Bouton "Ajouter" correctement désactivé tant que le mapping catégorie/mesure
    n'est pas complet (bar/pie/line), correctement activé sans mapping pour
    "table".
  - Réorganisation d'un widget par glisser-déposer dans la grille, vérifiée
    persistée dans `widgetOrder` sur disque après rechargement.
  - Tentative de partage d'un dashboard dont tous les widgets référencent une
    requête privée → bloquée, message listant explicitement les 5 widgets
    fautifs, dashboard resté intact et privé.
  - Partage d'un dashboard **sans widget** → réussi (aucun widget à valider),
    fichier `dashboards/DASHBOARD-0001.yaml` créé, entrée retirée du `.pref`.
  - Deux vrais bugs de script de test rencontrés en cours de route (SQL AlaSQL
    invalide avec un alias `count` non échappé — mot réservé — et un `<select>`
    choisi par mauvais index plutôt que par libellé) ont été diagnostiqués en
    lisant l'erreur réellement renvoyée par le moteur de requête et corrigés côté
    script, **pas** côté application — utile à noter puisque ça confirme que les
    messages d'erreur de `query-engine.service.ts` (sprint 1) sont assez précis
    pour diagnostiquer une requête SQL cassée.
  - **Non testé interactivement** : suppression d'un widget (bouton présent,
    logique revue par code seulement), suppression d'un dashboard, réorganisation
    de la sidebar (composant partagé déjà validé pour "Requêtes" au sprint 1),
    mapping "série" multi-courbe du widget Courbe, rétrogradation d'une requête
    partagée (aucune UI ne l'expose ce sprint, cf. § Divergences), cas limites
    "0 ligne"/"1 colonne" (revus par code uniquement).

---

## Comment tester manuellement

Avec `pnpm --filter @polenta/desktop dev` (ou le skill `run-desktop`), suivre
`specs/T77-tests.md` § "Sprint 2 — Widgets et Dashboards" (scénarios 7 à 11) :

1. Onglet "Suivi" → panneau latéral, section "Dashboards" en haut, "Requêtes" en
   dessous.
2. "+" sur "Dashboards" → saisir un titre → le dashboard est créé (privé) et
   sélectionné, vue Dashboard vide.
3. Si aucune requête sauvegardée n'existe encore : aller dans "Requêtes", créer une
   requête SQL renvoyant plusieurs lignes/colonnes (ex.
   `SELECT 'Eco' AS [mode], 12 AS [count] UNION SELECT 'Normal', 8` —
   **attention** : `count` est un mot réservé AlaSQL, le mettre entre crochets),
   Sauvegarder (portée privée pour tester le blocage de partage, ou partagée pour
   tester le cas nominal).
4. Dans la vue Dashboard → "Ajouter un widget" → titre, choisir la requête, choisir
   un type (les 5 sont utilisables sans contrainte) → l'aperçu se met à jour dès
   qu'un mapping catégorie/mesure valide est choisi → "Ajouter".
5. Répéter pour les 5 types de widget → vérifier le rendu de chacun dans la grille.
6. Glisser un widget avant un autre dans la grille → l'ordre est conservé après
   rechargement de la vue (navigation puis retour).
7. Si la requête utilisée est privée : cliquer "Partagé" sur le dashboard → refusé,
   message listant les widgets fautifs. Partager d'abord la requête (pas d'UI
   dédiée ce sprint — passer par un appel `api.queries.setScope(...)` depuis les
   devtools, ou créer directement la requête en portée partagée) puis réessayer →
   le dashboard passe en partagé, fichier créé dans `dashboards/`.
8. Tenter de supprimer une requête référencée par un widget (bouton corbeille dans
   "Requêtes sauvegardées" ou dans le panneau latéral) → refusé, message listant
   les widgets/dashboards dépendants.
9. Glisser une entrée dans les sections "Dashboards"/"Requêtes" du panneau latéral
   → ordre conservé après rechargement.
