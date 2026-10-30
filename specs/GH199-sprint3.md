# GH199 — Sprints 1 à 3 : analyse d'impact dans le change

Résumé commun aux trois sprints (commits `591d945`, `0b580c7`, `2674f69`).

## Fichiers modifiés

- Types : `packages/types/src/change.ts` (analyse, `range`, lignes d'impact), `graph.ts`, `export.ts`,
  `traceability.ts` ; `impact-analysis.ts` supprimé ; `zod-schemas` : schéma d'acquittement retiré.
- Main : **`change-analysis.util.ts`** (racines = listes du change, sinon exigences du composant ;
  arbres §4.6 ; une ligne par élément ; « n'est plus atteint » ; campagnes en cours concernées ;
  `pruneImpacted`) ; `changes.service.ts` (analyse live, figée au statut terminal, effacée à la
  réouverture ; change `range` à bornes tag / SHA, éléments changés en `modified`, snapshot à `to`) ;
  `traceability.service.ts` (flux élément unique, acquittements et analyses entre baselines
  retirés ; `listLegacyAcks`, diff des éléments entre deux refs) ; IPC, `channel-policy`,
  `api-client` ; export xlsx / modèle / PDF sur l'analyse d'un change ; graphe (`range`,
  `analysis`, `polenta.d.ts`) ; MCP `get_change` avec l'analyse.
- Renderer : `ChangeAnalysisSection` (mode, bornes, live / figée, complétude, arbres, campagnes,
  export, levée du flag) ; `ImpactTrees` et `RevalidationControls` extraits de l'ancienne vue ;
  `CreateChangeButton` / `change.new` (« Demande » ou « Sur l'existant ») ; « Analyser l'impact » sur
  une exigence / un test ; routes `/changes/revalidation` et `/changes/local`, Constellation dans le
  panneau Changements ; vue Analyse d'impact, `ImpactPanel`, `VersionImpactSelector`,
  `ImpactAnalysisContext` supprimés ; historique : « Acquittements d'impact (anciens) ».
- Tests : `change-analysis.gh199.test.ts` ; `traceability.impact-report.gh13.test.ts` supprimé ;
  e2e `gh199-change-analysis.spec.ts` ; gh145, gh56, gh83, gh183, gh198, t173 portés sur la vue
  Changements.

## Divergences

Aucune avec le design. Conformément à la décision du 2026-10-29 (spec §5, §11), les analyses
`impact-analyses/` existantes sont abandonnées : ni lecture ni conversion (la fonction n'était pas
encore utilisée par le client). Les `impact-acks/` restent lisibles (Q8).

## Mises à jour SPEC

| Section | Modification |
|---|---|
| SPEC-TRACEABILITY §4 | réécrit : analyse dans le change ; flux élément unique et analyses entre baselines retirés |
| SPEC-REQ §10 | « Analyser l'impact » ouvre / propose un change ; acquittements anciens en lecture |
| SPEC-DASHBOARDS §2 | graphe : `range`, `analysis` du change |
| SPEC-MCP-SERVER §4.7 | `get_change` renvoie l'analyse |

## Comment tester manuellement

`specs/GH199-tests.md` scénario 13 : nouveau change « Sur l'existant » entre une baseline et un
commit (éléments changés listés en « modified », arbres calculés à la borne `to`) ; export de
l'analyse (xlsx, PDF).
