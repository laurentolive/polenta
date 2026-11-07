# GH129 — Design : import JUnit sans interface (CLI et outil MCP)

Spec : `specs/GH129.md` (validée le 2026-11-07, Q1 à Q10 selon les recommandations).

## 1. Découpage

| Module | Fichier | Rôle |
|---|---|---|
| Lecture JUnit | `src/main/services/junit-report.util.ts` (nouveau) | XML → `JunitResult[]` (pur, pas d'E/S hors lecture de fichier) |
| Import | `src/main/services/results-import.service.ts` (nouveau) | correspondance, agrégation, contrôles, écriture via `TestsService.execute` / `CampaignsService.updateRun` ; un seul point d'entrée `importJunit(options)` → `ResultsImportReport` |
| Types | `packages/types/src/results-import.ts` (nouveau) | `ResultsImportReport`, raisons, avertissements — contrat commun CLI `--json` / outil MCP |
| CLI | `src/cli/index.ts`, `src/cli/args.ts` (nouveaux) | arguments, globs, sortie texte/JSON, code retour |
| Outil MCP | `src/mcp-server/tools/results-import.tools.ts` (nouveau) | `import_test_results` |
| Container | `src/mcp-server/container.ts` | + `TestedConfigService` (branché sur `tests`), + `resultsImport` ; la CLI réutilise ce container |
| Bundle | `scripts/build-mcp-server.ts` | 2ᵉ point d'entrée `src/cli/index.ts` → `out/mcp-server/polenta-cli.cjs` (même dossier : copié dans l'app installée par `extraResources`, sans changer `electron-builder.config.ts`) |
| Release | `.github/workflows/release.yml` | asset `apps/desktop/out/mcp-server/polenta-cli.cjs` |
| Run | `packages/types/src/test.ts`, `packages/zod-schemas/src/test.schema.ts`, `tests.service.ts` | `origin: 'excel-import' \| 'junit-import'` ; DTO `duration?` (secondes ≥ 0) |
| Affichage | `campaign.$campaignId_.run.$testId.tsx`, `ExecutionHistoryGrid.tsx`, locales | badge « Importé depuis JUnit », colonne Origine « import JUnit » |
| `AGENTS.md` | `src/main/services/agents-md.template.ts` | une ligne sur l'outil |

## 2. Lecture JUnit (`junit-report.util.ts`)

- Parseur : **`@xmldom/xmldom`** (déjà présent dans l'arbre de dépendances en 0.9.12, ajouté en
  dépendance directe à cette version) — gère entités, CDATA, commentaires, encodage. Alternative
  rejetée : parseur maison à expressions régulières (fragile sur CDATA / entités).
- `parseJunit(xml: string, file: string): JunitResult[] | { fatal: string }` : racine `testsuites` ou
  `testsuite`, parcours récursif des `testsuite`, `timestamp` hérité de la suite la plus proche,
  propriétés de suite cumulées (la plus proche l'emporte), `testcase` → `{ file, suite, classname,
  name, verdict: 'PASS'|'FAIL'|'BLOCKED'|'SKIPPED', message, duration, executedAt?, requirements[],
  suiteProperties }`. `xmldom` signale les erreurs par `onError` : une erreur `error`/`fatalError` → fatal.
- `timestamp` : `Date.parse` ; sans fuseau (`2026-11-07T10:00:00`) → suffixe `Z` ajouté avant lecture.

## 3. Service d'import (`results-import.service.ts`)

```ts
interface ResultsImportOptions {
  repoPath: string; workspaceDir?: string
  files: string[]                // chemins déjà développés (globs : appelant)
  campaignId?: string; testedVersion?: string; executedBy?: string
  dryRun: boolean
}
importJunit(o): Promise<ResultsImportReport>   // erreurs globales : ResultsImportError (code)
```

Étapes :
1. Lecture de tous les fichiers (illisible / fatal → `ResultsImportError('file_unreadable' | 'invalid_xml')`).
2. Index : `workspaceLinks.listObjects(root, ws)` (exigences et tests de tous les repos, `readonly`
   par repo) ; pour chaque repo de test, `testsIndex.invalidate` puis `tests.findAll` (champs) ;
   liens `workspaceLinks.listLinks(root, ws, fresh = true)` ; schéma de chaque repo pour
   `isRefInReadonlyNode` et pour savoir si un type `test` déclare `automationId`.
   Process sans watcher : tout est relu (comme les autres outils MCP).
3. Campagne (si `campaignId`) : `campaigns.get` (inconnue → `campaign_not_found`, clôturée →
   `campaign_closed`) ; version : `testedConfig.resolve(root, { version }, ws, { required: true })`
   avant toute écriture (`TestedVersionError` → `tested_version_required`) ; `undocumented` dans la
   copie → avertissement. Copie calculée une fois, réutilisée : non, `execute` la recalcule (même
   valeur, `HEAD` inchangé) — rien n'est ajouté à `execute`.
4. Correspondance par résultat (§2.1–§2.3 de la spec) → clé `repo|testId|entryId?`.
5. Agrégation (§2.4) : verdict pire (`FAIL` > `BLOCKED` > `PASS`), date max, durée somme, notes.
6. Contrôles avant écriture, identiques en dry run : idempotence (runs existants
   `origin: junit-import`, même `executedAt` normalisé ISO, même `campaignEntry`), nœud readonly,
   champs d'exécution (`prepareRunFields(typeDef, { result, stepResults: [] })` — refus →
   `required_field_missing`), approbation (`campaigns.approvalPredicate`) → avertissement.
7. Écriture (si `!dryRun`) séquentielle : `tests.execute(repo, id, { stepResults: [], result,
   executedAt, executedBy, duration, notes, origin: 'junit-import', campaignEntry?, requirementId?,
   testedVersion? }, ws)` puis `campaigns.updateRun(...)` avec `executedAt` / `executedBy`. Erreur
   inattendue → arrêt, `ResultsImportError('write_failed')` portant le rapport partiel.

`executedBy` : option, sinon `user.name` lu par isomorphic-git (`getConfig`, racine trouvée par
`findRoot` : un projet Polenta peut être un sous-dossier, comme `polenta/` dans fan-demo), sinon vide.
Le container MCP passe `--user` en défaut pour l'outil.

Notes du run : `plainTextToMarkdown` (déjà utilisé par l'import du classeur) sur les lignes
`fichier · suite · classname.name · verdict · message`, puis `propriété = valeur` des suites.

### 3.1 Rapport

```ts
interface ResultsImportReport {
  dryRun: boolean
  files: string[]
  counts: { results; imported; alreadyImported; skipped; unmapped; ambiguous; rejected }
  imported: Array<{ testId; repo?; entryId?; runId?; result; sources: string[] }>
  notImported: Array<{ file; testcase; reason: 'unmapped'|'ambiguous'|'not_in_campaign'|'readonly_node'|'required_field_missing'; candidates?; field? }>
  warnings: Array<{ code: 'mapped_by_requirement'|'unknown_requirement'|'no_timestamp'|'test_not_approved'|'tested_version_undocumented'|'no_automation_field'; file?; testcase?; testId?; detail? }>
  exitCode: 0 | 1
}
```
`alreadyImported` est compté par cas de test agrégé ; `skipped` par `<testcase>`.

## 4. CLI

`polenta-cli.cjs <commande> …` ; `import-results` seule commande ; `--help`. Analyse d'arguments
maison (même style que `mcp-server/index.ts`, pas de dépendance). Globs développés par
**`tinyglobby`** (déjà dans l'arbre, 0.2.17, ajouté en direct ; `fs.glob` exige Node 22) relativement
au dossier courant ; chemin sans métacaractère → pris tel quel (absent → erreur 2). Premier import :
garde stdout (`console.log/info/debug` → stderr, comme `stdout-guard.ts`) : les services journalisent,
stdout ne porte que le résumé. Sortie texte en anglais (Q9). Codes : 0/1 du rapport, 2 sur
`ResultsImportError` ou argument invalide. Marque : `__POLENTA_BRAND__` comme le serveur MCP ; en dev,
`src/cli/dev-entry.ts` (même mécanisme que `mcp-server/dev-entry.ts`) et script `pnpm cli`.

## 5. Outil MCP

`import_test_results` : `{ files: string[], campaignId?, testedVersion?, executedBy?, dryRun = true }` ;
chemins relatifs résolus depuis `repoPath` ; globs développés comme la CLI. Rapport en
`jsonToolResult` ; `ResultsImportError` → `errorToolResult(message)`.

## 6. Décisions et alternatives rejetées

- Réutiliser `createMcpContainer` pour la CLI plutôt qu'un container dédié : même graphe de services,
  construction paresseuse (aucun worker lancé, aucun `keytar` : seul `electron-host.ts` l'importe et il
  n'est pas dans ce graphe). Vérifié au build : le bundle ne doit pas contenir `require("keytar")`
  hors du chemin `external` jamais atteint.
- Pas de nouveau champ de run pour l'idempotence (spec §3.1) : `origin` + `executedAt` + `campaignEntry`.
- `stepResults: []` (Q8) : `execute` accepte une liste vide ; l'écran d'un run sans étape affiche le
  verdict global (vérifié en e2e).
- Tests de composants submodules : chaque repo est traité avec son propre `repoPath` dans
  `execute` (le test y est indexé) ; `--campaign` ne concerne que le repo ouvert (GH255).

## 7. Sprints

- **Sprint 1** — types, DTO/`origin`/`duration`, `junit-report.util.ts`, `results-import.service.ts`,
  container ; tests unitaires (parseur, correspondance, agrégation, campagne, idempotence, dry run).
- **Sprint 2** — CLI + bundle + release, outil MCP, `AGENTS.md`, badge / colonne Origine, e2e
  `gh129-junit-import.spec.ts`, mises à jour SPEC (TESTS §3.2/§3.5/§7, MCP-SERVER, TECH-stack §9),
  SPEC-AUDIT §3.5.
