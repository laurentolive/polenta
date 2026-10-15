# GH93 — Sprint 1 : contrat, stockage, exécution, modèles, MCP

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `packages/types/src/suivi-params.ts` (nouveau) | déclaration (`QueryParameterDef`, `validateParameterDecls`), format des valeurs (`normalizeParamValue`), résolution (`resolveRunParams` : clé non déclarée, défaut, « Tous » explicite, obligatoire), sélecteurs d'un dashboard (`dashboardSelectors`, `selectorKey`, `paramsForQuery`), affichage (`paramValueText`, `labelText`, `noneText`) |
| `packages/types/src/graph.ts` | `PolentaHost.params`, `GraphParamValue` |
| `packages/types/src/script.ts` | `ScriptRunRequest.params` / `parameters`, `ScriptErrorKind` `params`, `buildHost(…, params)` |
| `packages/types/src/dashboard.ts`, `suivi-format.ts` | `SavedQuery.parameters` / `parametersError`, `StoredQuery.parameters`, lecture brute dans `ReadQuery` |
| `packages/types/src/suivi-templates.ts` | `QueryTemplate.parameters()`, options `campaignAtDisplay` (entrées, avancement), `periodAtDisplay` (avancement), `componentAtDisplay` / `objectTypeAtDisplay` (liste filtrée) ; `queryCode` renvoie la déclaration ; empreinte `queryCodeForHash` (script + déclaration) |
| `apps/desktop/src/main/services/saved-queries.service.ts` | déclaration écrite / relue / validée (`parametersError`), `[PARAMS_INVALID]`, portée conservée, déclaration invalide jamais écrasée en silence |
| `…/suivi.service.ts` | `run` : déclaration (requête ou fournie) + `resolveRunParams` → `params` au moteur ; erreurs `format` / `params` ; `renderTemplate` renvoie la déclaration |
| `…/script-engine.service.ts`, `script-sandbox.ts` | `params` dans l'hôte et la clé de partage ; hôte gelé |
| `…/dashboards.service.ts` | `.pref` `suiviParamValues` : `getParamValues` / `setParamValues` (normalisées), suivi au changement de portée, retrait à la suppression |
| `…/suivi-store.util.ts`, `suivi-validation.util.ts` | `applyQueryTemplate` (déclaration), code `PARAMS_INVALID` |
| `…/dashboard-seed.service.ts` | seed Campagnes : `campaignAtDisplay` sur les six requêtes |
| `…/ipc/index.ts`, `web-server/channel-policy.ts`, `packages/api-client` | canaux `dashboards:param-values-get` / `-set` ; DTO `parameters` ; `renderTemplate` |
| `mcp-server/tools/queries.tools.ts`, `suivi-common.ts`, `suivi-script.tools.ts`, `agents-md.template.ts` | `parameters` (create / update / run ad hoc / test_script), `params` (run_query / test_script), `PARAMS_INVALID`, convention `polenta.params` |
| `resources/dashboard-lib/polenta.d.ts` (+ `manifest.json` v2) | régénéré |
| `scripts/demo-lave-linge/generate.mjs` | écrit `parameters` |
| Tests | `suivi-params.test.ts` (nouveau, 26 tests), `script-engine.test.ts`, `dashboard-library.service.test.ts` |

## Comportement implémenté

- Une requête déclare des paramètres (6 types) ; le script et la transformation lisent
  `polenta.params` (gelé). Valeurs validées par le main ; défaut appliqué si non fourni ; « Tous /
  Toutes » = `null` explicite ; `required` sans valeur → erreur `params`.
- Modèles : « campagne choisie à l'affichage » (filtres de campagne ignorés quand une campagne est
  choisie), « période choisie à l'affichage », « composant / type d'objet choisi à l'affichage ».
- Seed Campagnes : sélecteur « Campagne » commun aux six requêtes ; sans valeur, résultats identiques
  (corpus de non-régression inchangé).
- Valeurs choisies mémorisées par utilisateur et par dashboard dans le `.pref` (canaux prêts pour la
  barre du sprint 2).
- MCP : déclaration et valeurs ; erreurs `PARAMS_INVALID` / `SCRIPT_ERROR` (`kind: params`).

L'interface (barre, éditeur de déclaration, impression, docx) arrive au sprint 2 : d'ici là, les
widgets s'exécutent avec les défauts (« Toutes »).

## Divergences par rapport au design

- Corpus (`suivi-corpus.test.ts`) non étendu : les cas « campagne choisie » / « période » sont
  couverts par des tests des modèles exécutés dans le bac à sable sur un graphe minimal
  (`suivi-params.test.ts`), plus lisibles qu'une référence JSON.
- `paramsForQuery` ne transmet pas à une requête une valeur d'énumération qu'elle ne déclare pas
  (sélecteur partagé = union des valeurs) : la requête retombe sur son défaut (constat de revue).

## Revue de code (`/code-review`)

Corrigés : énumération partagée / valeur retirée (ci-dessus) ; valeurs effacées seulement après la
suppression réussie du dashboard ; schéma MCP de période à borne unique ; `update_query` MCP sur une
déclaration lue invalide → `PARAMS_INVALID` (même en `dryRun`).
Non retenus : type d'objet / campagne identifiés sans le repo (même limite que la valeur fixée
actuelle des modèles) ; code généré modifié sans changement de version de modèle et hôte gelé (pas
de rétrocompatibilité, version GH74 non publiée) ; « Tous » → valeur fixée du modèle (spec §5) ;
validation répétée MCP / service (redondance sans effet).

## Tests

- `pnpm vitest run` (desktop) : 50 fichiers, 591 tests verts ; `tsc` sans erreur.
- e2e web : voir commentaire de l'issue.

## Tester manuellement (avant le sprint 2, via MCP)

1. `test_script` avec `parameters: [{ name: 'campaign', kind: 'campaign', label: 'Campagne' }]`,
   `params: { campaign: '<CAMP-…>' }` et le script
   `export default (data, polenta) => data.campaigns.filter((c) => c.id === polenta.params.campaign).map((c) => ({ id: c.id }))`.
2. `create_query` avec `template: { id: 'campaign-timeline', params: { campaignAtDisplay: true } }` →
   `query.yaml` porte `parameters` ; `run_query { queryId, params: { campaign } }` → série d'une seule
   campagne.
3. Nouveau seed Campagnes (supprimer `campaignsSeed` du `.pref` et le dashboard Campagnes privé) :
   affichage identique à avant (barre au sprint 2).
