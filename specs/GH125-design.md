# GH125 — Design : paramètres choisis par widget

Spec : `specs/GH125.md` (décisions D1–D4 du 2026-11-07). Un seul sprint.

## 1. Fichiers et changements

### 1.1 Logique pure — `packages/types/src/suivi-params.ts`

- Inchangés : `validateParameterDecls`, `resolveRunParams`, `normalizeParamValue`, `selectorKey`,
  `paramsForQuery` (valeurs `name:kind` → `polenta.params`), `paramValueText`.
- Nouveau `widgetSelectors(decls)` : sélecteurs d'**une** requête (ordre de déclaration, valeurs
  `enum` de cette seule déclaration) — implémenté par `dashboardSelectors([{ id, queryId }], …)`
  pour ne pas dupliquer le code. `dashboardSelectors` reste (vue `/query`, D4) ; son commentaire
  « barre du dashboard » est corrigé.
- Type `DashboardSelector` conservé (nom historique ; utilisé par la vue `/query` et les widgets).
- Nouveau type `WidgetParamValues = Record<string /* widgetId */, Record<string /* name:kind */, GraphParamValue>>`.

### 1.2 Main — `DashboardsService` (`dashboards.service.ts`)

- `.pref` : nouvelle clé `suiviWidgetParamValues` (`dashboardId → widgetId → name:kind → valeur`,
  D2). L'ancienne `suiviParamValues` n'est jamais lue ; elle est supprimée à chaque écriture de
  valeurs (`writeParamValues`).
- `getParamValues(repo, user, dashboardId): WidgetParamValues` (valeurs nettoyées par
  `cleanParamValues`, widget sans valeur omis).
- `setParamValues(repo, user, dashboardId, widgetId, values | null)` : remplace les valeurs du
  widget ; `null` ou vide → entrée du widget retirée (dashboard retiré s'il n'en reste aucune, clé
  retirée si vide).
- `renameInOrder` (changement de portée) déplace le bloc `suiviWidgetParamValues[oldId]` vers
  `newId` — les ids de widgets sont conservés par `setScope`. **Clé = dashboard + widget, jamais
  `queryId`** (compatibilité avec #67, qui remappe les `queryId`).
- `delete` : retire le bloc du dashboard (comme GH93). `deleteWidget` : après l'écriture du
  dashboard, retire les valeurs du widget (`writeParamValues(…, widgetId, null)`) — couvre l'app et
  le MCP `delete_widget` (même service).
- `remapWidgetQueryId` : inchangé (les valeurs ne dépendent pas de la requête).

### 1.3 IPC, web, client

- `dashboards:param-values-get (repoPath, username, dashboardId)` → `WidgetParamValues`.
- `dashboards:param-values-set (repoPath, username, dashboardId, widgetId, values)`.
- `channel-policy.ts` : liste inchangée (contrôle d'accès sur l'argument 0, inchangé).
- `packages/api-client` (`types.ts`, `ipc-client.ts`) : signatures mises à jour.

### 1.4 Renderer

- `lib/suiviParamValues.ts` : `effectiveValues` / `missingRequired` / `optionTitle` inchangés ;
  `storedChoices` ne purge plus les clés non déclarées (spec §2.3 : une valeur ignorée reprend effet
  si la déclaration revient) ; nouveau `differsFromDefault(selectors, values, invalid)` (D1 : vrai si
  une valeur effective ≠ défaut ou si une valeur est introuvable — le bouton efface l'avertissement).
- `hooks/useDashboardParams.ts` : lit `WidgetParamValues` du dashboard (une requête react-query),
  options chargées si un widget en a besoin. API par widget :
  `forWidget(widget) → { selectors, values, invalid, params, missing, canReset, setValue, reset,
  describe }` ; raccourcis `paramsFor(widget)`, `missingFor(widget)`, `describeAll()` (export :
  `widgetId → [{ label, value }]`) et `paramsForEdit(widgetId | undefined, queryId)` (aperçu de
  `WidgetConfigModal` : valeurs du widget modifié filtrées par la déclaration de la requête choisie,
  `{}` pour un nouveau widget → défauts appliqués par le main). `ready` inchangé.
- `components/dashboard/ParamBar.tsx` : la barre reste pour la vue `/query` (D4). `ParamInput` est
  exporté ; nouveau `WidgetParamSelectors` (même fichier) : rangée compacte « Libellé [contrôle] »,
  avertissement « Valeur introuvable » par sélecteur, icône Réinitialiser (`widget-param-reset`)
  si `canReset` ; en impression, lignes texte « Libellé : valeur » (`widget-params-print`).
- `DashboardGrid.tsx` : `WidgetCard` reçoit `paramUi` (sélecteurs + valeurs + callbacks) à la place
  de `params` / `missing` ; en-tête sur deux rangées (titre + actions, puis sélecteurs en
  `flex-wrap`). Glisser : la grille garde `dragLockedId` ; le pointeur sur la rangée des sélecteurs
  désactive `draggable` de la carte (sinon ouvrir une liste ou sélectionner du texte démarre un
  glisser).
- `routes/dashboard.tsx` : plus de `ParamBar` ; export docx : `widgetParameters: describeAll()` ;
  `WidgetConfigModal` : `paramsForQuery` = `paramsForEdit(editingWidget?.id, queryId)`.
- `routes/print.dashboard.tsx` : plus de `ParamBar` ; valeurs sous le titre de chaque widget.
- `routes/query.tsx` : inchangé.

### 1.5 Exports

- `DashboardExportPayload` (`packages/types/src/export.ts`) : `parameters` remplacé par
  `widgetParameters?: Record<widgetId, { label, value }[]>`.
- `export/dashboard.docx.ts` : paragraphes « **Libellé :** valeur » sous le titre de chaque widget.
- `template/template-data-campaign.ts` : `widgets[].parameters` ; `parameters: []` au premier
  niveau (D3, déprécié).

### 1.6 MCP et docs

- `mcp-server/tools/suivi-common.ts` : description du schéma `parameters` (« sélecteurs du widget »).
- Dernier sprint : SPEC-DASHBOARDS §5.1, §6, §7.0, §7.1, §10 ; SPEC-MCP-SERVER (mention) ;
  SPEC-INDEX (MAJ GH125) ; tutoriels `docs/tutoriels/07-suivi.md`, `docs/tutorials/07-tracking.md`.

## 2. Décisions techniques et alternatives rejetées

- **Réutiliser `dashboardSelectors` avec un seul widget** plutôt qu'écrire un second regroupement :
  même normalisation (défaut, `required`, valeurs `enum`) que la vue `/query`.
- **Une seule lecture des valeurs par dashboard** (`WidgetParamValues`) plutôt qu'un appel IPC par
  widget : `ready` reste global (une seule exécution par widget au chargement) et l'impression
  attend une seule lecture.
- **Pas de migration** des anciennes valeurs (spec §2.6) ; suppression de l'ancienne clé à la
  première écriture plutôt qu'à la lecture (une lecture n'écrit jamais le `.pref`).
- Rejeté : clé `dashboardId:widgetId` à plat — l'imbrication rend le déplacement au changement de
  portée et la suppression d'un dashboard triviaux.

## 3. Découpage

Un sprint : service + IPC + renderer + exports + tests unitaires + e2e (`gh93-params.spec.ts`
adapté, `gh125-widget-params.spec.ts`) + mises à jour SPEC et tutoriels.

## 4. Vérification

Niveau 1 pendant le dev ; niveau 2 en fin de sprint : `pnpm test`, `pnpm build:web`,
`npx playwright test e2e-web/gh125-` et `e2e-web/gh93-` (spec voisine modifiée), sur les ports
réservés de cette orchestration.
