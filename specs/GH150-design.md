# GH150 — Design : outils MCP de modification et paramètres

Spec : `specs/GH150.md`. Un seul sprint.

## Fichiers

| Fichier | Changement |
|---|---|
| `apps/desktop/src/main/services/update-validation.util.ts` (nouveau) | Validation pure d'une entrée `update_*` contre l'objet existant et son type : statut connu (`isUnknownStatus`, GH149), clés de `fields` déclarées, valeurs d'`enum` / `multi_enum`, puis, sur l'objet fusionné, `required` et `EARS` (`isFilled` / `isEarsCompliant` de `field-checks.util.ts`). Calcule aussi l'aperçu `{ champ: { before, after } }`. |
| `apps/desktop/src/main/services/field-merge.util.ts` (nouveau) | `mergeFields(existing, patch)` : fusion partielle, une clé à `null` est retirée. |
| `requirements.service.ts`, `tests.service.ts` | `update()` utilise `mergeFields` à la place du spread (une clé `null` venue de l'appli est aujourd'hui écrite `null` : à vérifier en Dev qu'aucun écran n'envoie `null` en voulant le garder ; sinon, réserver le retrait au MCP par une option `removeNullFields`). |
| `apps/desktop/src/mcp-server/tools/update.tools.ts` (nouveau) | `update_requirements`, `update_tests`. Même squelette que `bulk-import.tools.ts` : `dryRun` par défaut `true`, écriture en série, best-effort, résultat `{ dryRun, summary, updated, preview, errors }`. |
| `apps/desktop/src/mcp-server/tools/parameters.tools.ts` (nouveau) | `list_parameters`, `set_parameters`, `delete_parameter`, branchés sur `ParametersService`. |
| `apps/desktop/src/mcp-server/container.ts` | Instancie `ParametersService` (dépendances déjà présentes : `git`, index, `schema`, `revalidation`, `workspaceTree` ; `PolentaRepoService` est déjà créé localement, à exposer). `reqRefs` non fourni : les références `{req.<champ>}` restent littérales, sans effet sur l'écriture. |
| `apps/desktop/src/mcp-server/server.ts` (ou point d'enregistrement des tools) | Enregistre les deux nouveaux modules. |
| `apps/desktop/src/main/services/agents-md.template.ts` | Liste les 5 outils, retire le repli « écrire le YAML à la main » pour ces cas ; version du gabarit +1. |
| `specs/SPEC-MCP-SERVER.md`, `specs/SPEC-INDEX.md` | Sprint final : nouveaux tools, colonne `MAJ` → GH150. |

## Écriture d'une entrée `update_*` (`dryRun: false`)

1. `title` / `fields` / (tests) `preconditions`, `postconditions`, `steps`, `equipment` présents →
   `service.update(repoPath, id, dto, workspaceDir)`.
2. `status` présent et différent → exigences : `RequirementsService.transition()` (version +1 en
   sortie d'approbation, revalidation T172) ; tests : `TestsService.update({ status })` (revalidation
   T172 déjà là). Écart constaté : pour un test, quitter l'approbation n'incrémente pas la version,
   contrairement aux exigences. **Hors périmètre**, signalé à la validation (nouveau ticket si voulu).
3. `history` : `source: mcp` déjà posé par le `HistoryService` du conteneur MCP.

Une erreur à l'étape 2 après réussite de l'étape 1 laisse le contenu écrit : l'entrée est rapportée
en erreur avec `partial: true` (best-effort, cohérent avec `bulk_import_*`).

## `modificationComment`

Accepté par `update_*` (décision 2) et transmis dans le DTO. **Constat** : le champ existe dans
`UpdateRequirementSchema` mais aucun service ne le conserve aujourd'hui (ni fichier, ni historique).
Le persister (ex. dans l'entrée d'historique) touche le format `history` (GH77) : à trancher à la
validation du design — l'exposer quand même (il sera ignoré) ou attendre un ticket dédié.

## Paramètres

- `repo` : nom de montage ; résolu via `ParametersService.list()` (`repoName`), absent = repo ouvert.
  Repo `readonly` → erreur `READONLY_REPO` (même code que les liens).
- `set_parameters` `dryRun: true` : `{ name, action, before, after }` + éléments approuvés qui seraient
  marqués (`usages()` filtré sur les approuvés, uniquement si `value` / `unit` changent).
- `delete_parameter` : appel direct à `ParametersService.delete` ; `deleted: false` → résultat
  `{ deleted: false, usages }` (pas une exception).

## Alternatives écartées

- Réutiliser `bulk_import_*` avec un `id` : mélange création et modification, validation différente.
- Écrire les YAML dans l'outil : c'est précisément ce que le ticket veut supprimer.
