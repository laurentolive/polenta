# GH129 — Scénarios de test

Référence : `specs/GH129.md` §7 (critères d'acceptation, numérotés CAn ci-dessous).

## Unitaires — `junit-report.util` (`junit-report.gh129.test.ts`)

1. Fichier pytest (racine `testsuites`, propriétés `requirement` par testcase, `failure`, `error`,
   `skipped`) → verdicts PASS/FAIL/BLOCKED/SKIPPED, durée, `executedAt` de la suite, exigences (CA1).
2. Fichier e2Unit (racine `testsuite`, propriétés de suite, `name="T01 Titre"`) → résultats, propriétés
   de suite recopiées (CA1).
3. `timestamp` sans fuseau → lu en UTC ; absent → `executedAt` indéfini.
4. Suites imbriquées : `timestamp` et propriétés de la suite la plus proche.
5. XML mal formé, racine inconnue → `fatal`.
6. Message tronqué à 2 000 caractères ; entités et CDATA décodés.

## Unitaires — service (`results-import.gh129.test.ts`, repo temporaire)

7. `automationId` = `classname.name` puis `name` → run écrit, `origin: junit-import`, verdict,
   `stepResults: []`, durée arrondie ; `skipped` → aucun run (CA2).
8. Deux tests avec le même `automationId` → `ambiguous`, aucun run, `exitCode` 1 (CA3).
9. Secours `requirement` : un seul test sans `automationId` couvrant l'exigence (lien dans un sens puis
   dans l'autre) → run + `mapped_by_requirement` ; deux candidats → `ambiguous` ; ID inconnu →
   `unknown_requirement` (CA4).
10. Deux fichiers, même test → un run, verdict le pire, une ligne de notes par source (CA5).
11. `--campaign` : entrée mise à jour, `campaignEntry`, campagne `in_progress` ; test hors campagne →
    `not_in_campaign` ; deux entrées départagées par `requirementId` (CA6).
12. Campagne clôturée / inconnue → `ResultsImportError`, aucun fichier modifié (CA6).
13. Repo avec version sélectionnable : sans version → `tested_version_required` ; avec → `testedConfig`
    dans le run ; texte inconnu → `tested_version_undocumented` (CA7).
14. Dry run : même rapport qu'en écriture, aucun fichier écrit (CA8).
15. Réimport → `alreadyImported`, aucun run, `exitCode` 0 (CA9).
16. Aucun type ne déclare `automationId` → `no_automation_field` + tout non mappé.
17. Champ d'exécution `required` → `required_field_missing`, les autres importés.
18. Test d'un nœud `readonly` → `readonly_node`.
19. `executedBy` : option, sinon `user.name` git, sinon vide.

## Unitaires — CLI (`cli.gh129.test.ts`)

20. Arguments : `--repo` manquant, option inconnue, `--junit` absent → code 2 et message stderr (CA10).
21. Motif sans fichier → code 2 ; plusieurs `--junit` et motifs combinés.
22. Sortie texte (compteurs, une ligne par non importé) et `--json` (objet = rapport) ; codes 0/1/2 (CA10).

## Unitaires — MCP (`results-import.tools.gh129.test.ts`)

23. `dryRun` par défaut : rien d'écrit ; `dryRun: false` écrit ; même objet que la CLI ; erreur
    globale → `isError` (CA13).

## Bundle (manuel scripté, sprint 2)

24. `pnpm build:mcp-server` puis `node out/mcp-server/polenta-cli.cjs import-results --repo <fixture>
    --junit <xml> --dry-run` avec Node système, sans Electron : exit 0/1 attendu, résumé (CA12, Windows ;
    Linux non vérifiable ici).

## e2e (`e2e-web/gh129-junit-import.spec.ts`)

25. Run `origin: junit-import` rattaché à une campagne : badge « Importé depuis JUnit » sur la page du
    run, colonne Origine « import JUnit » dans la section Exécutions du test, verdict affiché sans étape
    (CA14).

## Non automatisés

- CA11 (aucun commit) : couvert indirectement (le service n'appelle aucune méthode git d'écriture) —
  vérifié par revue, pas de test dédié.
- CA12 sur Linux : à vérifier à la première release (runner CI).
