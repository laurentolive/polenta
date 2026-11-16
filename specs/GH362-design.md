# GH362 — Design

Un seul sprint : uniquement de l'exposition MCP de méthodes de service existantes.

## Fichiers

| Fichier | Changement |
|---|---|
| `apps/desktop/src/mcp-server/tools/versions.tools.ts` | + `create_version`, `copy_version`, `update_version`, `include_in_version`, `remove_from_version`, `set_version_impact`, `get_version_release_preview`, `release_version` |
| `apps/desktop/src/mcp-server/tools/validations.tools.ts` | + `create_validation`, `update_validation`, `decide_validation`, `confirm_validation_decision`, `reject_validation_decision`, `cancel_validation` |
| `apps/desktop/src/mcp-server/container.ts` | commentaires « lecture seule » / « jamais signées » mis à jour |
| `apps/desktop/src/main/services/agents-md.template.ts` | liste des outils, `AGENTS_MD_TEMPLATE_VERSION` + 1 (régénération à l'ouverture) |
| `apps/desktop/src/main/services/milestone-d-coverage.gh271.test.ts` | le test « aucun outil de release » devient « aucun outil de signature » |
| `apps/desktop/src/mcp-server/gh362.test.ts` (nouveau) | scénarios de `GH362-tests.md` via le conteneur MCP et les handlers enregistrés |
| `specs/SPEC-MCP-SERVER.md` §4.8, §4.10 ; `specs/SPEC-INDEX.md` | mise à jour en fin de sprint |

## Décisions

- **Erreurs** : les services lèvent `VersionError` / `ValidationError` dont le message commence par le code
  (`TAG_EXISTS: …`). Le SDK MCP (1.29) attrape toute exception d'un handler et renvoie
  `{ isError: true, content: [message] }` : pas d'enveloppe spécifique, même comportement que les outils
  d'issues.
- **Fraîcheur** : `VersionsService` et `ValidationsService` relisent leurs fichiers, mais `SchemaService` et les
  index sont en cache : chaque écriture passe par `freshComponentRepoResolver` (invalidation du repo visé).
  *Corrigé au sprint 1 (revue).*
- **Auteur du commit de release** : `McpAuthService` (config git du repo, sinon `--user`). *Ajouté au sprint 1.*
- **Résultat des écritures** : l'objet écrit (`ProductVersion` / `Validation`) ; pour les décisions, l'entrée
  de l'exigence (comme `propose_validation_decision`) ; `release_version` renvoie la version figée.
- **`set_version_impact.status`** : `z.enum(IMPACT_ANALYSIS_STATUSES)` — l'agent voit la liste dans le schéma
  de l'outil.
- **Pas de `status` dans `update_validation`** : le seul changement de statut est `cancel_validation`.
- `repoOf` reste dupliqué par fichier comme aujourd'hui (trois copies identiques) : factorisation dans un
  `component-repo.ts` commun, appelée par les trois fichiers d'outils.

Alternative rejetée : un outil générique `set_version_status` qui appellerait `release` quand le statut cible
est released — il masquerait le caractère irréversible et le paramètre `tag`.
