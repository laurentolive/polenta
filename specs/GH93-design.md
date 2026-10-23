# GH93 — Design technique

> Entrée : `specs/GH93.md` (spec validée). Code de référence : `main` @ 8f23cbf.

## 0. Vue d'ensemble

```
query.yaml / .pref ── parameters: QueryParameterDef[] ──┐
                                                        ▼
renderer : useDashboardParams ──(valeurs par widget)──► suivi:run { …, params, parameters? }
   ▲  ParamBar (sélecteurs)                                   │
   │  .pref suiviParamValues[dashboardId]                      ▼
   └── dashboards:param-values-get/-set           SuiviService.run → resolveRunParams (validation,
                                                   défauts, required) → ScriptEngineService.run
                                                   → host.params (gelé) → script + transformation
```

Principes :
- **Logique pure partagée** dans `@polenta/types` (`suivi-params.ts`) : validation d'une
  déclaration, validation / résolution des valeurs, regroupement des sélecteurs d'un dashboard,
  libellés d'affichage. Utilisée par le main, le MCP et le renderer.
- **Le main fait foi pour l'exécution** (format, clés déclarées, `required`, défauts) ; le renderer
  fait l'**existence** des valeurs (« Valeur introuvable ») car il a les listes d'options et doit
  afficher l'état du sélecteur.
- Les valeurs choisies ne vivent que dans le `.pref` (jamais commité) : aucune écriture dans
  `dashboard.yaml`.

---

## 1. Types partagés (`packages/types/src/`)

### 1.1 `graph.ts` — contrat (ajout, v1 conservée)

```ts
/** Valeur d'un paramètre choisi à l'affichage (GH93). */
export type GraphParamValue = string | { from: string | null; to: string | null } | null
export interface PolentaHost {
  …
  /** Paramètres déclarés par la requête, valeurs choisies à l'affichage (GH93) : une clé par
   *  paramètre déclaré, `null` si aucune valeur. Toujours présent (`{}` sans paramètre). */
  params: Readonly<Record<string, GraphParamValue>>
}
```
`polenta.d.ts` régénéré (`scripts/generate-graph-dts.ts`).

### 1.2 `suivi-params.ts` (nouveau, pur)

```ts
export type QueryParameterKind = 'campaign' | 'component' | 'objectType' | 'enum' | 'text' | 'period'
export interface QueryParameterDef {
  name: string
  kind: QueryParameterKind
  label: { fr: string; en: string } | string
  values?: { value: string; label: { fr: string; en: string } | string }[]
  default?: GraphParamValue
  required?: boolean
}
export const PARAM_TEXT_MAX = 1000

/** Erreurs de déclaration (nom invalide / dupliqué, kind inconnu, enum sans valeurs, défaut hors
 *  format) ; `[]` si valide. */
export function validateParameterDecls(raw: unknown): { decls: QueryParameterDef[]; errors: string[] }
/** Format d'une valeur pour un kind (string non vide ; enum ∈ values ; text ≤ 1000, trim ;
 *  period { from, to } AAAA-MM-JJ, from ≤ to, `{null,null}` → null). Renvoie la valeur normalisée. */
export function normalizeParamValue(def: QueryParameterDef, v: unknown): { ok: true; value: GraphParamValue } | { ok: false; reason: string }
/** Valeurs passées au script : clés non déclarées → erreur ; absente → default → null ;
 *  required sans valeur → erreur. */
export function resolveRunParams(decls: QueryParameterDef[], given: Record<string, unknown> | undefined):
  { ok: true; params: Record<string, GraphParamValue> } | { ok: false; message: string; missing?: string[] }

/** Clé d'un sélecteur : `${name}:${kind}`. */
export function selectorKey(d: Pick<QueryParameterDef, 'name' | 'kind'>): string
export interface DashboardSelector { key: string; name: string; kind: QueryParameterKind; label; values?; default: GraphParamValue; required: boolean; widgetIds: string[] }
/** Sélecteurs d'un dashboard (ordre widgets puis déclarations ; libellé / values du 1er ; enum :
 *  union ; default : 1er valide ; required si l'un l'exige). */
export function dashboardSelectors(widgets: { id: string; queryId: string }[], declsOf: (queryId: string) => QueryParameterDef[] | undefined): DashboardSelector[]
/** Libellé lisible d'une valeur (impression, docx) — résolution des titres fournie par l'appelant. */
export function paramValueText(sel: DashboardSelector, v: GraphParamValue, locale: 'fr' | 'en', titleOf?: (kind, id) => string | undefined): string
```

### 1.3 `dashboard.ts`, `suivi-format.ts`, `script.ts`

- `SavedQuery` : `parameters: QueryParameterDef[]` (toujours présent, `[]` par défaut) +
  `parametersError?: string` (déclaration lue invalide → exécution refusée, `kind: 'format'`).
- `StoredQuery` / `ReadQuery` : `parameters?` ; `readQueryRecord` le lit sans le valider (la
  validation est dans le service, qui renseigne `parametersError`).
- `ScriptRunRequest` : `params?: Record<string, GraphParamValue>` ; `parameters?:
  QueryParameterDef[]` (déclaration fournie avec un `script` ad hoc, ou qui remplace celle de la
  requête enregistrée dans l'éditeur `/query` non sauvegardé).
- `ScriptErrorKind` : + `'params'` (clé non déclarée, valeur hors format, `required` manquant).
- `buildHost(client, contract, now, drill, params = {})`.

### 1.4 `suivi-templates.ts`

- `QueryTemplate.parameters(params): QueryParameterDef[]` (déclaration générée, déterministe).
- `queryCode()` → `{ script, parameters, template }` ; empreinte = `hashableText(queryCodeForHash(script, parameters))`
  avec `queryCodeForHash = parameters.length ? script + '\n\0\n' + stableJson(parameters, 2) : script`
  (requête sans paramètre : empreinte inchangée).
- Nouveaux paramètres de modèle (`kind: 'boolean'`, rendus par `TemplateForm` existant) :

| Modèle | Paramètre de modèle | Déclaration générée | Code généré |
|---|---|---|---|
| `campaign-entries` | `campaignAtDisplay` « Campagne choisie à l'affichage » | `{ name: 'campaign', kind: 'campaign', label: Campagne / Campaign }` | `const chosen = polenta.params.campaign` ; `chosen` → `data.campaigns.filter((c) => c.id === chosen)`, sinon filtre actuel ; `entryStatuses` toujours appliqué |
| `campaign-timeline` | `campaignAtDisplay` ; `periodAtDisplay` « Période choisie à l'affichage » | `campaign` ; `{ name: 'period', kind: 'period', label: Période / Period }` | idem pour `campaignIds` ; `from: period && period.from || undefined`, `to` idem |
| `filtered-list` | `componentAtDisplay`, `objectTypeAtDisplay` | `{ name: 'component', kind: 'component' }`, `{ name: 'objectType', kind: 'objectType' }` | `const comp = polenta.params.component ?? P.component`, `const ref = polenta.params.objectType ?? P.objectTypeRef` ; la catégorie suit le type choisi |

  Ces options retirées des `params` stockés si fausses (`pick`) ; version des modèles inchangée (1)
  — pas de rétrocompatibilité (spec §5).

---

## 2. Main

### 2.1 `saved-queries.service.ts`

- `CreateSavedQueryDto` / `UpdateSavedQueryDto` : `parameters?: QueryParameterDef[]`. Avec
  `template` : déclaration générée, `parameters` fourni → erreur. Sans : `validateParameterDecls`,
  erreur → `throw` (message listant les erreurs).
- Écriture : `parameters` dans `query.yaml` / objet `.pref` (omis si vide). `setScope` transporte
  `parameters`.
- Lecture (`toQuery`) : `validateParameterDecls` → `parameters` valides ou `parametersError`.
  `computeState` reçoit `queryCodeForHash(script, parameters)` (déclaration éditée = personnalisé).
- `suivi-store.util.ts` : `applyQueryTemplate` renvoie aussi `parameters`.

### 2.2 `suivi.service.ts` — `run`

Après résolution de la requête : `decls = req.parameters ?? query?.parameters ?? []` (script ad
hoc sans `parameters` → `[]`) ; `query.parametersError` → `fail('format', …)` ; `resolveRunParams(decls,
req.params)` → échec → `fail('params', message)` ; sinon `engine.run(…, { …, params })`.

### 2.3 `script-engine.service.ts`, `script-sandbox.ts`

- `ScriptRunCode.params` → `buildHost(…, params)`.
- `shareKey` += `JSON.stringify(params)` (clés triées : `stableJson`).
- Sandbox : `__call` / `__callT` gèlent l'hôte parsé (`globalThis.__freeze(JSON.parse(hostJson))`)
  — `params` (et son objet `period`) non modifiable par le script.

### 2.4 `dashboards.service.ts` — valeurs choisies

- `.pref` : `suiviParamValues?: Record<dashboardId, Record<selectorKey, GraphParamValue>>`.
- `getParamValues(repoPath, username, dashboardId)` / `setParamValues(repoPath, username,
  dashboardId, values | null)` (`null` = Réinitialiser → clé supprimée). Valeurs normalisées par
  `normalizeParamValue` selon le kind porté par la clé (hors format → ignorée) ; pas de
  vérification d'existence.
- `setScope` (id change) : clé renommée ; `delete` : clé retirée.
- Sur une branche en lecture seule : autorisé (écrit le `.pref` seulement) — pas de garde.

### 2.5 IPC et politique web

| Canal | Signature | Politique |
|---|---|---|
| `dashboards:param-values-get` | `(repoPath, username, dashboardId) → Record<string, GraphParamValue>` | comme `dashboards:get` |
| `dashboards:param-values-set` | `(repoPath, username, dashboardId, values \| null) → void` | comme `dashboards:order-set` (écriture du `.pref`) |

`suivi:run` inchangé en signature (`req.params`, `req.parameters`). `queries:create/update` :
`parameters`. `preload` / `api-client` / `channel-policy.ts` (listes et index `[0]`) mis à jour.

### 2.6 `dashboard-seed.service.ts`

`CAMPAIGN_SEED_QUERIES` : `campaignAtDisplay: true` sur les six requêtes. Aucune reprise des seeds
existants (spec §6).

### 2.7 Exports

- `dashboard.docx.ts` et `template/template-data-campaign.ts` (gabarit) : payload `{ dashboard,
  widgetResults, parameters?: { label: string; value: string }[] }` → paragraphe « Paramètres » sous
  le titre (docx direct) ; `parameters` exposé au gabarit (`{#parameters}{label} : {value}{/parameters}`).
- `query-result.xlsx.ts` : inchangé (lignes déjà calculées avec les valeurs affichées).

---

## 3. Renderer

| Fichier | Changement |
|---|---|
| `hooks/useDashboardParams.ts` (nouveau) | entrée : dashboard, requêtes ; lit `param-values-get`, options (`useCampaignOptions` étendu au statut, `useSuiviObjectTypes` → composants et types) ; calcule `selectors` (`dashboardSelectors`), `values` résolues (choix utilisateur → `default` → `null`), `invalid` (valeur introuvable dans les options → traitée comme absente), `paramsFor(widget)` (valeurs des seuls paramètres de sa requête) et `missingFor(widget)` (`required` sans valeur) ; `setValue(key, v)` (optimiste + `param-values-set`), `reset()` |
| `components/dashboard/ParamBar.tsx` (nouveau) | barre sous le titre : un `ParamInput` par sélecteur, « Réinitialiser » ; message « Valeur introuvable : … » ; rien si aucun sélecteur ; `printMode` → texte « Libellé : valeur » (pas de contrôles) |
| `components/dashboard/ParamInput.tsx` (nouveau) | 6 kinds : `select` (campagne `ID — titre (statut)`, composant, type d'objet, enum ; option « Tous / Toutes » sauf `required`), `text` (validation Entrée / blur, `maxLength` 1000), `period` (deux `input type=date`, `from > to` refusé avec message) |
| `hooks/useScriptRun.ts` | `widgetRunOptions(…, params)` : `req.params` + `JSON.stringify(params)` dans la clé ; un changement de valeur ne change que la clé des widgets concernés |
| `DashboardGrid.tsx` | props `paramsFor`, `missingFor` ; widget `missing` → carte « Choisir <libellé> » sans exécution ; drill-down : `request` porte `params` |
| `DrillDownModal.tsx` | `request.params` transmis (clé `widget-drilldown` inclut la requête, donc les valeurs) |
| `routes/dashboard.tsx` | `useDashboardParams` ; `ParamBar` entre l'en-tête et la grille ; export docx : `widgetRunOptions(…, paramsFor(w))` + `parameters` (libellés via `paramValueText`) ; `WidgetConfigModal` reçoit `paramsFor` |
| `routes/print.dashboard.tsx` | même hook (lit les valeurs du `.pref` de `username`) ; `ParamBar printMode` sous le titre ; widgets `missing` comptés comme rendus |
| `WidgetConfigModal.tsx` | prop `paramsForQuery(queryId)` : exécution des colonnes et aperçu avec les valeurs courantes du dashboard |
| `routes/query.tsx` | état local `paramValues` ; `ParamBar` (sans mémorisation) au-dessus du résultat, valeurs initiales = défauts ; mode modèle : déclaration générée affichée en lecture seule (renvoyée par `suivi:render-template`) ; mode script : `ParameterDeclEditor` ; exécution `{ script, parameters, params }` ; sauvegarde avec `parameters` ; erreurs de déclaration affichées avant sauvegarde |
| `components/dashboard/ParameterDeclEditor.tsx` (nouveau) | liste éditable : nom, kind, libellé (texte unique), valeurs (`enum`, une par ligne `valeur=libellé`), défaut, obligatoire ; ajouter / supprimer / monter / descendre ; erreurs `validateParameterDecls` en ligne |
| `suivi:render-template` | renvoie aussi `parameters` pour une requête |
| i18n `fr` / `en` | barre, kinds, « Tous / Toutes », « Choisir {{label}} », « Valeur introuvable », erreurs `params`, éditeur de déclaration, en-tête impression / docx |

---

## 4. Serveur MCP et AGENTS.md

| Outil | Changement |
|---|---|
| `create_query` / `update_query` | `parameters` (zod reprenant `QueryParameterDef`, validé par `validateParameterDecls` → `PARAMS_INVALID`) ; avec `template` → `INVALID_INPUT` ; l'aperçu (`dryRun`) exécute avec les défauts (un `required` sans défaut → aperçu en erreur `params`, avertissement non bloquant) |
| `run_query` | `params` ; `parameters` accepté seulement avec `script` ; erreurs `params` → `SCRIPT_ERROR` avec `kind: 'params'` |
| `test_script` | `parameters`, `params` |
| `list_queries` | `parameters` déjà dans `SavedQuery` |
| `get_data_contract` | convention : `polenta.params`, déclaration dans la requête, exemple « une campagne » |
| `agents-md.template.ts` | section Suivi : idem |

---

## 5. Démo et corpus

- `scripts/demo-lave-linge/generate.mjs` : écrit `parameters` dans `query.yaml` (depuis
  `queryCode`) ; dashboard Campagnes de la démo avec `campaignAtDisplay` ; projet de démo régénéré.
- Corpus (`suivi-corpus.test.ts`) : exécution sans `params` (= « Toutes ») → références de lignes
  inchangées ; ajout de cas « campagne choisie » et « période » pour la démo (nouvelles références).

---

## 6. Décisions et alternatives

| Décision | Alternatives rejetées | Raison |
|---|---|---|
| Déclaration dans la définition de la requête | annotations dans le JS, export `params` du module | connue sans exécuter ; éditable par formulaire ; MCP simple |
| Clé de sélecteur `name:kind` | `name` seul | deux requêtes au même nom mais de types différents ne se corrompent pas |
| Existence vérifiée dans le renderer, format dans le main | tout dans le main | le main n'a pas besoin des listes d'options ; le renderer doit de toute façon afficher l'état |
| Valeurs dans `.pref` par dashboard | URL, `localStorage` | spec (par utilisateur, persistant, client web compris) |
| Options booléennes des modèles | enum « Fixé / Choisi à l'affichage » | rendu existant de `TemplateForm`, code généré lisible |
| Empreinte = script + déclaration | script seul | modifier la déclaration doit aussi détacher du modèle |
| Hôte gelé dans la sandbox | copie non gelée | spec (§2) ; coût négligeable |
| Version des modèles inchangée | v2 | rien de publié (spec §5) |

---

## 7. Découpage en sprints

### Sprint 1 — Contrat, stockage, exécution, modèles, MCP
- `@polenta/types` : `suivi-params.ts`, `graph.ts` (`params`), `script.ts`, `dashboard.ts`,
  `suivi-format.ts`, `suivi-templates.ts` (déclarations générées, options d'affichage, empreinte).
- Main : `SavedQueriesService`, `SuiviService.run`, `ScriptEngineService`, sandbox, `DashboardsService`
  (valeurs `.pref`), IPC + preload + api-client + `channel-policy`, seed Campagnes.
- MCP : outils §4, `get_data_contract`, AGENTS.md.
- Démo régénérée, corpus étendu, `polenta.d.ts`.
- Tests unitaires (`suivi-params`, modèles, services, moteur, MCP).
- L'app reste fonctionnelle : sans barre, les widgets s'exécutent avec les défauts (« Toutes »).

### Sprint 2 — Interface, exports, e2e, SPEC
- Renderer §3 (barre, hook, grille, drill-down, popup widget, `/query` + éditeur de déclaration,
  impression, export docx / gabarit).
- e2e web `gh93-params.spec.ts`.
- Mises à jour SPEC (`SPEC-DASHBOARDS` §2, §3, §5, §6, §7.0, §7.1 ; `SPEC-MCP-SERVER` ;
  `SPEC-INDEX`), tutoriel `docs/tutoriels/06-suivi.md`.
