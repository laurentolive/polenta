# GH399 — Scénarios de test

Fixtures :
- un type de test dédié, avec un `runField` « Banc » ;
- une campagne C1 **ouverte** : TA-1 exécuté (R1) ;
- une campagne C2 **clôturée** : TA-1 exécuté deux fois (R2 remplacée par R3) ;
- une exécution isolée R4 ;
- une issue dont l'origine est R1 ;
- un run R5 dont les notes citent l'ID de R1 et un ID inexistant (`<TA-1>-run-9999`).

## Unitaires

| # | Cible | Attendu |
|---|-------|---------|
| U1 | `history(repo, { runId: R3 })` | Une ligne, R3, avec campagne C2 et entrée ; aucune entrée en attente ; `runFieldDefs` du type. |
| U2 | `history(repo, { runId: R2 })` | La ligne R2 marquée `superseded`. |
| U3 | `history(repo, { runId: 'X-run-0001' })`, test inconnu | Aucune ligne. |
| U4 | `runIds(repo)` | Tous les ID d'exécution du repo, avec leur test. |
| U5 | `runPage(row)` | Campagne ouverte : `execute` ; campagne close : `run` ; exécution isolée, retirée, remplacée ou campagne introuvable : `null`. |

## E2E web (`e2e-web/gh399-run-preview.spec.ts`)

| # | Scénario | Attendu |
|---|----------|---------|
| E1 | Section Exécutions de TA-1 : survol de l'entrée de R1 | Popup `element-preview` avec l'ID de R1, le test, le verdict, la campagne C1 et l'entrée. |
| E2 | Onglet Popup de la vue Exécutions (type du test) : cocher « Banc », puis survoler R1 | La popup affiche « Banc » et sa valeur. |
| E3 | Clic sur l'entrée de R1 (C1 ouverte) | Page d'exécution. |
| E3b | Clic sur l'entrée de R3 (C2 clôturée) | Relecture. |
| E4 | R2 (remplacée) et R4 (isolée) | Popup présente avec le badge ou la mention. Le clic ne change pas l'URL. |
| E5 | Page de C1 : survol de la pastille de résultat de l'entrée | Popup de R1. |
| E6 | Fiche de l'issue (vue Édition) | R1 est un lien avec popup. |
| E7 | Document de la vue Exécutions, fiche de R5 | L'ID de R1 dans les notes est un lien avec popup. `<TA-1>-run-9999` reste du texte, et TA-1 n'y est pas lié. |
| E8 | Échap pendant la popup | Popup fermée. |

## Manuel

- Vue Validation : date d'une exécution dépliée (popup et navigation).
- Client desktop Electron.
- Exécution d'un test de composant vue depuis le produit.
