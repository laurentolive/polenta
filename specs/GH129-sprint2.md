# GH129 — Sprint 2 : CLI, outil MCP, affichage, specs

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `apps/desktop/src/cli/index.ts`, `cli/import-results.ts`, `cli/dev-entry.ts` (nouveaux) | CLI `polenta <commande>`, sous-commande `import-results` (arguments, sortie texte / `--json`, codes 0/1/2) |
| `apps/desktop/src/main/services/results-import-files.util.ts` (nouveau) | chemins et motifs → fichiers (`tinyglobby`), commun CLI / MCP |
| `apps/desktop/src/main/services/plain-text-markdown.util.ts` (nouveau) | `plainTextToMarkdown` sorti de `export/campaign-execution-import.ts` (réexporté là) : l'import JUnit ne tire plus ExcelJS dans les bundles |
| `apps/desktop/src/main/services/results-import.service.ts`, `junit-report.util.ts` | `displayBase` (fichiers relatifs dans le rapport) ; corrections de revue (ci-dessous) |
| `apps/desktop/src/mcp-server/tools/results-import.tools.ts` (nouveau), `mcp-server/index.ts` | outil `import_test_results` |
| `apps/desktop/src/main/services/agents-md.template.ts` | v11 : ligne sur l'outil |
| `apps/desktop/scripts/build-mcp-server.ts` | options esbuild communes ; 2ᵉ bundle `out/mcp-server/polenta-cli.cjs` ; `import.meta.url` fourni par bannière (fdir, via tinyglobby) |
| `.github/workflows/release.yml` | asset `polenta-cli.cjs` à chaque release |
| `apps/desktop/package.json`, `vitest.config.ts` | script `cli` ; tests de `src/cli` inclus |
| `ExecutionHistoryGrid.tsx`, `campaign.$campaignId_.run.$testId.tsx`, locales fr/en | origine « import JUnit », badge « Importé depuis JUnit » (`data-testid="run-origin-badge"`) |
| `packages/types/src/results-import.ts` | avertissement `tested_version_ignored` |
| tests : `src/cli/cli.gh129.test.ts`, `e2e-web/gh129-junit-import.spec.ts` ; ajouts dans les tests du sprint 1 | scénarios 20–25 |
| specs : `SPEC-TESTS.md` §3.2 / §3.5 (réécrit) / §7, `SPEC-MCP-SERVER.md` §4.11, §8, §9 (nouveau), `SPEC-TECH-stack.md` §9, `SPEC-AUDIT.md` §3.5 (résolu), `SPEC-INDEX.md` (MAJ → GH129), `GH129.md` §3.1 | voir § Mises à jour SPEC |

## Comportement implémenté

- `node polenta-cli.cjs import-results --repo <dir> --junit <fichier|motif> … [--campaign] [--tested-version]
  [--executed-by] [--workspace] [--dry-run] [--json]` : spec §4. stdout ne porte que le résumé (garde
  stdout du serveur MCP) ; usage et erreurs sur stderr.
- Outil MCP `import_test_results` (`dryRun` par défaut, testeur par défaut = `--user` du serveur) : spec §5.
- Bundle : Node.js seul, vérifié sans Electron (`node out/mcp-server/polenta-cli.cjs`, Node 24 système,
  Windows) ; ni `require("keytar")` ni ExcelJS dans le bundle.

## Divergences par rapport au design

- `plainTextToMarkdown` déplacé dans son propre module : l'importer depuis l'import du classeur tirait
  ExcelJS et `unzipper` (dépendance optionnelle `@aws-sdk/client-s3` introuvable) dans le bundle MCP.
- Bannière `import.meta.url` ajoutée aux deux bundles (fdir, dépendance de tinyglobby, appelle
  `createRequire(import.meta.url)`, vide en CJS) — non prévu au design.
- Fichiers affichés relatifs au dossier courant (CLI) / au repo (MCP) — option `displayBase`.
- Section CLI de SPEC-MCP-SERVER numérotée §9 (après §8 Fichiers) plutôt qu'un fichier de spec dédié.
- Le compteur `imported` compte des runs (un par test et entrée), les autres des `<testcase>` :
  libellé texte « runs imported », documenté.

## Revue de code (`/code-review medium 319`)

10 constats ; corrigés : BOM UTF-8 refusé (1), `campaign.id` au lieu de l'ID saisi pour le réimport (2),
`FieldWriteError` levée par `execute` → refus de ce seul résultat au lieu d'arrêter l'import (3), fichier
existant contenant `[ ]` / `( )` pris tel quel (5), `--tested-version` sans campagne → avertissement
`tested_version_ignored` (6), libellé du compteur (7), CLI sans commande : usage sur stderr (8), erreur XML
récupérable (`&` non échappé) acceptée, seul `fatalError` arrête (9), options esbuild partagées (10).
Non corrigé, documenté (SPEC-TESTS §3.5, `GH129.md` §3.1) : (4) réimporter un sous-ensemble des fichiers
d'un import agrégé donne une autre date, donc un nouveau run.

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-TESTS.md` §3.2 | `origin: junit-import`, `duration` du rapport |
| `SPEC-TESTS.md` §3.5 | réécrit : import JUnit sans interface (correspondance, verdicts, agrégation, campagne, réimport, codes) ; JSON Polenta retiré |
| `SPEC-TESTS.md` §7 | décision « TestRun isolés » complétée du rattachement explicite `--campaign` |
| `SPEC-MCP-SERVER.md` §4.11, §8, §9 | outil `import_test_results`, fichiers, CLI |
| `SPEC-TECH-stack.md` §9 | ligne « CLI » (asset de release) |
| `SPEC-AUDIT.md` §3.5 | marqué résolu |
| `SPEC-INDEX.md` | MAJ → GH129 (TESTS §2–3, MCP-SERVER, TECH-stack §9, AUDIT) ; mots-clés junit, import-results, import_test_results, automationId, cli |

## Vérifications

- `pnpm typecheck` : OK (4 tâches). `pnpm lint` : aucune tâche définie (comme sur `main`).
- `pnpm test` : desktop 150 fichiers / 1632 tests, admin-service 119 (+3 ignorés), merge-core 79 — tous verts.
- e2e (ports 8961 / 8962 / 8963 / 8960) après `pnpm build:web` : `gh129-junit-import` (2), `gh196-run-fields`,
  `gh197-execution-history` (2), `gh256-execute-version` — 6/6.
- Bundles : `node out/mcp-server/polenta-cli.cjs import-results` sur un projet de test (dry run, écriture,
  réimport, `--json`, motif vide → 2, arguments manquants → 2, sans commande → 2 et rien sur stdout) ;
  `out/mcp-server/index.cjs` démarre et liste `import_test_results` (`tools/list` sur stdio).
- Non lancé : suite e2e complète (niveau 3, au merge) ; bundle sur Linux (runner de CI) ; build
  `electron-builder` complet ni workflow `release.yml` (pas de release publiée).

## Comment tester manuellement

```
pnpm --filter @polenta/desktop build:mcp-server
node apps/desktop/out/mcp-server/polenta-cli.cjs import-results --repo <projet> --junit "<dossier>/*.xml" --dry-run
```
Un type de test du projet doit déclarer un champ `automationId` (texte) ; un test dont la valeur vaut
`classname.name` (ou `name`) d'un `<testcase>` reçoit un run. Sans `--dry-run`, le run apparaît dans
la section « Exécutions » du test (origine « import JUnit ») ; avec `--campaign CAMP-xxxx`, sur la page
de la campagne avec le badge « Importé depuis JUnit ».
