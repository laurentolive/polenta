# GH362 — Sprint 1

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `apps/desktop/src/mcp-server/tools/versions.tools.ts` | + `create_version`, `copy_version`, `update_version`, `include_in_version` (`notFound`), `remove_from_version`, `set_version_impact`, `get_version_release_preview`, `release_version` |
| `apps/desktop/src/mcp-server/tools/validations.tools.ts` | + `create_validation`, `update_validation`, `decide_validation`, `confirm_validation_decision`, `reject_validation_decision`, `cancel_validation` ; aucun outil de signature |
| `apps/desktop/src/mcp-server/tools/component-repo.ts` (nouveau) | `componentSchema`, résolution du repo d'un composant (factorisée depuis les trois fichiers d'outils), `freshComponentRepoResolver` (relit schéma et index avant une écriture) |
| `apps/desktop/src/mcp-server/tools/issues.tools.ts` | utilise la résolution commune |
| `apps/desktop/src/mcp-server/container.ts` | `McpAuthService` : auteur des commits / tags MCP = config git du repo, sinon `--user` ; commentaires mis à jour |
| `apps/desktop/src/main/services/auth.service.ts` | auteur par défaut extrait en `protected defaultAuthor()` (surchargé par le MCP), comportement de l'app inchangé |
| `apps/desktop/src/main/services/agents-md.template.ts` | liste des outils ; gabarit v12 (régénéré à l'ouverture des projets) |
| `apps/desktop/src/main/services/mcp-writes.gh362.test.ts` (nouveau) | 10 tests (scénarios 1 à 12 de `GH362-tests.md` + revue) |
| `apps/desktop/src/main/services/milestone-d-coverage.gh271.test.ts` | liste d'outils attendue ; « aucun outil de signature » |

## Divergences par rapport au design

Issues de la revue de code (`/code-review`) :
- **Auteur du commit de release** : dans le process MCP, `auth.json` est inaccessible ; sans config git locale,
  commit et tag étaient signés « Polenta User ». Ajout de `McpAuthService` (repli sur `--user`).
- **Fraîcheur** : le design disait « rien à invalider » ; faux pour `SchemaService` (cache) et les index.
  Les écritures passent par `freshComponentRepoResolver`.
- `include_in_version` renvoie `notFound` (le service ignore un ID introuvable sans erreur).
- `release_version` sans tag calcule le tag suggéré sans refaire les contrôles de `releasePreview`.
- Descriptions précisées : `components` remplacé (pas fusionné) ; valeur « en attente » selon l'outil.

Points de revue non corrigés, documentés :
- Course inter-process app / MCP lors d'un `release_version` (SPEC-MCP-SERVER §7) — même classe que les
  courses déjà documentées.
- Une décision prise ou confirmée par le MCP porte `decidedBy` = `--user` (ou `local`), sans marqueur MCP
  dans l'entrée (choix de la spec §4).
- Pas de test `READONLY_REPO` par outil : le contrôle est dans les services (`assertWritable`), testé par GH201 / GH204.

## Mises à jour SPEC

- `SPEC-MCP-SERVER.md` §4.8 (outils d'écriture des versions), §4.10 (validations sans signature), §7 (auteur
  du commit de release, course inter-process).
- `SPEC-REQ-requirements.md` §11.2 (écriture interface et MCP), §13 (MCP : tout sauf la signature).
- `SPEC-INDEX.md` : lignes SPEC-MCP-SERVER, SPEC-REQ §11 et §13 → GH362.

## Vérifications

- `pnpm typecheck` : OK. `pnpm test` : tout vert. Lint : aucune tâche `lint` ni configuration eslint dans le
  repo (rien à lancer).
- Pas d'e2e : aucun changement de renderer, d'IPC ni de serveur web.

## Comment tester manuellement

Depuis un agent connecté au MCP du projet de démo (après réouverture du projet, `AGENTS.md` passe en v12) :
1. `create_version` → `include_in_version` (exigences du backlog) → commit dans l'app →
   `get_version_release_preview` → `release_version` : la version apparaît released dans l'app, avec son tag.
2. `create_validation` sur cette version → `decide_validation` sur chaque exigence → la vue Validation montre
   les décisions ; la signature se fait dans l'app (aucun outil MCP ne la propose).
3. `cancel_validation` : la validation passe annulée.
