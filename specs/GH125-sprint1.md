# GH125 — Sprint 1 (unique) : paramètres choisis par widget

## Fichiers modifiés

- `packages/types/src/suivi-params.ts` : `widgetSelectors`, type `WidgetParamValues`.
- `packages/types/src/export.ts` : `DashboardExportPayload.widgetParameters` remplace `parameters`.
- `packages/api-client/src/{types,ipc-client}.ts` : `getParamValues` → `WidgetParamValues`,
  `setParamValues(…, widgetId, values)`.
- `apps/desktop/src/main/services/dashboards.service.ts` : clé `.pref` `suiviWidgetParamValues`
  (dashboard → widget → `name:kind`), ancienne `suiviParamValues` jamais lue et retirée à la
  première écriture ; `renameInOrder` déplace le bloc du dashboard ; `deleteWidget` / `delete`
  retirent les valeurs ; `widgetId` obligatoire.
- `apps/desktop/src/main/ipc/index.ts` : `dashboards:param-values-set` prend `widgetId`.
- `apps/desktop/src/main/services/export/dashboard.docx.ts`, `template/template-data-campaign.ts` :
  valeurs sous le titre de chaque widget ; `widgets[].parameters` ; `parameters` racine vide (D3).
- `apps/desktop/resources/export-templates/Référence des balises.html` : balise `{{#parameters}}`
  par widget, racine dépréciée.
- `apps/desktop/src/renderer/lib/suiviParamValues.ts` : `storedChoices` par widget sans purge,
  `differsFromDefault` (D1).
- `apps/desktop/src/renderer/hooks/useDashboardParams.ts` : API par widget (`forWidget`,
  `paramsForEdit`, `describeAll`).
- `apps/desktop/src/renderer/components/dashboard/ParamBar.tsx` : `WidgetParamSelectors` (en-tête
  du widget, impression) ; `ParamBar` gardée pour la vue `/query` (D4), ids de contrôle préfixés.
- `apps/desktop/src/renderer/components/dashboard/DashboardGrid.tsx` : sélecteurs dans la carte,
  glisser désactivé sous le pointeur des sélecteurs.
- `apps/desktop/src/renderer/routes/dashboard.tsx`, `print.dashboard.tsx` : plus de barre ; export
  et aperçu de configuration par widget.
- `apps/desktop/src/mcp-server/tools/{suivi-common,queries.tools}.ts` : descriptions.
- Tests : `suivi-params.test.ts`, `suiviParamValues.test.ts`, `e2e-web/gh93-params.spec.ts`
  (adapté), `e2e-web/gh125-widget-params.spec.ts` (nouveau).
- Docs : `docs/tutoriels/07-suivi.md`, `docs/tutorials/07-tracking.md`.

## Comportement implémenté

Conforme à `specs/GH125.md` (décisions D1–D4) : un sélecteur par paramètre déclaré dans l'en-tête de
chaque widget, valeur propre au widget mémorisée par utilisateur, aucune barre sur le dashboard,
icône Réinitialiser par widget visible hors défaut ou sur valeur introuvable, drill-down / aperçu /
impression / docx par widget, choix GH93 abandonnés. La clé des valeurs est dashboard + widget,
jamais `queryId` (compatibilité #67).

## Divergences par rapport au design

- `setParamValues` refuse un `dashboardId` / `widgetId` vide ou `__proto__` (`isPrefKey`), non prévu
  au design ; présence d'un widget testée par `hasOwnProperty` (pas la chaîne de prototypes).
- Un premier `/code-review` avait relu un diff sans rapport (le `main` local contient des merges non
  poussés) ; relancé sur la PR (`/code-review medium 315`). Corrigé à la suite :
  - e2e : les assertions sur le résultat d'un widget portent sur `widget-body` (nouveau `data-testid`
    du corps de la carte) — les options du sélecteur de l'en-tête citent les campagnes et rendaient
    `toContainText(<id>)` toujours vrai (`gh125-widget-params`, `gh93-params` « Valeurs ») ;
    `gh93-params` 4 / 6 remet aussi au défaut les deux autres widgets recentrés au test 1 ;
  - `deleteWidget` : nettoyage des valeurs du `.pref` au mieux (`try/catch`), le widget supprimé
    n'est plus signalé en échec si l'écriture du `.pref` échoue ;
  - Réinitialiser ne retire que les valeurs des paramètres déclarés (les valeurs d'un `name:kind` non
    déclaré restent, conformément à la spec §2.3) ;
  - verrou de glisser relâché au démontage des sélecteurs (pointerleave jamais reçu) ;
  - `forWidget` calculé une fois par widget (`useMemo`), plus à chaque appel ;
  - champs texte et période compacts dans l'en-tête, comme les listes.
- Écarté : borner le `.pref` en refusant un widget absent du dashboard ou en élaguant les ids
  inconnus. Les valeurs sont personnelles et peu nombreuses ; elles sont retirées à la suppression
  du widget ou du dashboard par l'utilisateur ; la spec garde volontairement les valeurs non
  déclarées ; refuser un widget inconnu imposerait une lecture du dashboard à chaque choix et
  casserait le cas d'un dashboard d'un format plus récent (widgets non lus). Restent orphelines les
  valeurs d'un widget supprimé par un autre utilisateur (ignorées).

## Mises à jour SPEC

- `SPEC-DASHBOARDS.md` §1 (aperçu), §3 (canaux `param-values-*` par widget), §5.1 (sélecteurs du
  widget, valeur par widget, ancienne clé abandonnée, vue `/query` inchangée), §6 (drill-down,
  aperçu, exports et impression par widget), §7.0 (`suiviWidgetParamValues`), §7.1 (sélecteur
  Campagne par widget du seed), §10 (hors scope GH93 mis à jour, hors scope GH125).
- `SPEC-MCP-SERVER.md` §4 (`delete_widget` retire les valeurs du widget).
- `SPEC-INDEX.md` : colonne MAJ → GH125 pour SPEC-MCP-SERVER §global et SPEC-DASHBOARDS §1–§3,
  §4–§6, §7, §8–§10.

## Vérifications

- Niveau 1 : `pnpm typecheck` OK (4 tâches) ; `pnpm lint` : aucune tâche de lint définie.
- Niveau 2 : `pnpm test` — merge-core 79, admin-service 119 (+3 ignorés), desktop 1598 tests / 147
  fichiers, tous verts ; `pnpm build:web` puis
  `npx playwright test e2e-web/gh125- e2e-web/gh93-` (ports 8940–8943) : 10 passed.
- Après les corrections de revue : `pnpm typecheck` OK ; tests touchés (`suivi-params.test.ts`,
  `suiviParamValues.test.ts`) 38 passed ; `pnpm build:web` puis e2e `gh125-` + `gh93-` : 10 passed.
- Non lancé : suite e2e complète (niveau 3, au merge), `test:e2e:desktop`.

## Tester manuellement

1. Vue Suivi → dashboard *Campagnes* : pas de barre en tête ; chaque widget affiche « Campagne :
   Toutes ».
2. Choisir une campagne sur *Avancement dans le temps* : seul ce widget change ; l'icône ↺ apparaît
   dans son en-tête ; clic → retour à *Toutes*.
3. Recharger : la valeur du widget est conservée.
4. Survoler un sélecteur puis tenter de glisser la carte : pas de déplacement ; glisser par le titre
   fonctionne.
5. Imprimer / exporter en docx : valeurs sous le titre des widgets paramétrés.
6. Modifier un widget recentré (crayon) : l'aperçu montre la campagne du widget.
