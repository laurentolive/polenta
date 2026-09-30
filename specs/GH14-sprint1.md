# GH14 — Sprint 1 (unique)

## Fichiers modifiés

- `apps/desktop/src/renderer/components/sidebar/ReorderableSidebarSection.tsx` — prop
  `fillHeight` remplacé par `collapsed` / `onToggleCollapsed`. L'en-tête devient un bouton
  chevron + libellé (`aria-expanded`), le « + » reste à part. Une section repliée ne rend
  que son en-tête (et la modale de suppression éventuelle). Une section dépliée prend
  `flex-1 min-h-0`.
- `apps/desktop/src/renderer/components/sidebar/DashboardPanel.tsx` — suppression des
  onglets à icônes (`activeTab`, `PieChart` / `SearchIcon`). Les deux sections sont rendues
  ensemble. L'état `collapsed` est persisté en `localStorage['polenta:suiviCollapsed']`
  (lecture et écriture en `try/catch`, valeur invalide → deux sections dépliées). Une
  section se déplie automatiquement quand l'élément actif de l'URL figure dans sa liste.
- `apps/desktop/src/renderer/routes/query.tsx` — retrait de la carte « Requêtes
  sauvegardées » (liste, filtre, suppression, erreur) et de sa modale de confirmation.
  Historique en pleine largeur. Imports nettoyés (`Trans`, `Trash2`, `Lock`, `Users2`).
- `apps/desktop/src/renderer/i18n/locales/{fr,en}.json` — retrait de
  `sidebar.dashboard.dashboardsTab`, `queryPage.savedQueriesCount`,
  `queryPage.savedQueriesCountFiltered`, `queryPage.noSavedQuery`,
  `queryPage.deleteQueryConfirmTitle` et `queryPage.deleteQueryConfirmBody`.

## Comportement implémenté

Conforme à `GH14.md` et `GH14-design.md`.

## Ajout en validation — séparateur redimensionnable

Demandé à la validation du sprint (initialement hors scope dans `GH14.md`) :
- `ReorderableSidebarSection` : nouveau prop optionnel `flexGrow` (défaut 1). Une section
  dépliée a le style `flex: <flexGrow> 1 0%`.
- `DashboardPanel` : les deux sections sont regroupées dans un conteneur
  (`sectionsRef`). Un séparateur `role="separator"` (`h-1`, `cursor-row-resize`, surligné
  au survol) n'est rendu que si les deux sections sont dépliées. Le glissement calcule
  le ratio `split` à partir de la position verticale du pointeur dans le conteneur,
  borné à 140 px minimum par section. Il suit le même principe que la poignée de
  largeur de la sidebar dans `AppLayout` (listeners `mousemove`/`mouseup` sur
  `document`). Un double-clic rétablit 0,5. Le ratio est persisté en
  `localStorage['polenta:suiviSplit']`, avec repli sur 0,5 si la valeur est invalide.
- Tests : scénarios S1–S5 ajoutés dans `GH14-tests.md`.

## Divergences par rapport au design

- **Dépliage automatique restreint aux éléments listés** (issu de la revue de code). Le
  design prévoyait de déplier la section Requêtes dès qu'un `queryId` est présent. Or
  l'historique de la vue Requêtes navigue aussi avec `queryId = <id d'historique>` :
  la section se serait dépliée sans rien surligner, et le choix de l'utilisateur aurait
  été écrasé dans `localStorage`. Désormais, le dépliage n'a lieu que si l'id figure
  dans la liste de la section. L'effet dépend de booléens (et pas des listes), pour
  qu'un simple refetch ne rouvre pas une section que l'utilisateur vient de replier.
  Scénario L1 de `GH14-tests.md` scindé en L1 / L1b.

## Vérifications

- `tsc --noEmit -p apps/desktop/tsconfig.json` : 0 erreur.
- ESLint : pas de configuration pour `apps/desktop` (ESLint 9 sans `eslint.config.*`).
  Rien à exécuter.
- Pas de tests automatiques renderer dans le projet.
- `/code-review` (medium) : 1 constat (dépliage sur id d'historique), corrigé (voir
  ci-dessus).
- `grep` : plus d'occurrence de `dashboardsTab`, `fillHeight`, `savedQueriesCount`,
  `noSavedQuery` ou `deleteQueryConfirm` dans `renderer/`. Les occurrences restantes
  d'`activeTab` sont sans rapport (`schema.tsx`, barre d'onglets).

## Mises à jour SPEC

- `SPEC-DASHBOARDS.md §1` — la vue d'ensemble mentionne les sections repliables et
  précise que les requêtes sauvegardées ne sont listées que dans le panneau latéral.
  Aucune ligne `§1` dans `SPEC-INDEX.md`, donc pas de colonne MAJ à mettre à jour.
- `SPEC-DASHBOARDS.md §6` — nouveau paragraphe « Disposition (GH14) » : sections
  empilées repliables, partage de hauteur, persistance `polenta:suiviCollapsed`,
  dépliage automatique sur élément listé, suppression uniquement depuis le panneau.
  `SPEC-INDEX.md` : MAJ → GH14.
- `specs/T92.md` : non modifié (historique d'un ticket clos). Le format d'en-tête
  `section-label` qu'il définit est conservé.

## Tester manuellement

1. `pnpm dev` depuis le worktree `../polenta-official-GH14`, ouvrir un projet, puis
   l'activité **Suivi**.
2. Dérouler les scénarios N1–N8 et L1–L10 de `GH14-tests.md`. Points clés :
   - replier/déplier chaque section, vérifier le partage de hauteur, puis redémarrer
     l'app : l'état est conservé ;
   - vue Requêtes : plus de carte « Requêtes sauvegardées », Historique pleine largeur ;
   - Requêtes repliée + sauvegarde d'une nouvelle requête → la section se déplie sur
     la requête ; Requêtes repliée + clic sur une entrée d'historique → reste repliée.
3. Test L8 : dans DevTools, `localStorage.setItem('polenta:suiviCollapsed','xx')`, puis
   recharger : les deux sections sont dépliées, sans erreur.
