# GH201 — Sprint 3 : MCP en lecture, SPEC

## Fichiers modifiés

- `apps/desktop/src/mcp-server/tools/versions.tools.ts` (nouveau) — `list_versions`, `get_version`,
  `get_version_backlog` (lecture seule) ; enregistrés dans `mcp-server/index.ts` (le conteneur MCP porte
  `versions` depuis le sprint 1).
- `apps/desktop/src/main/services/agents-md.template.ts` — outils de version listés dans `AGENTS.md`.
- SPEC (voir ci-dessous) et `specs/MILESTONE-D.md` §3 (état de livraison).

## Mises à jour SPEC

| Section | Modification |
|---|---|
| `SPEC-REQ-requirements.md` §2.1 | catégorie `version` citée |
| `SPEC-REQ-requirements.md` §11 (nouvelle) | versions : type, fichier, cycle de vie, passage released, backlog, page, statut de design |
| `SPEC-MCP-SERVER.md` §4.8 (nouvelle) | outils de lecture des versions |
| `SPEC-DASHBOARDS.md` §2 | contrat v1 : `versions`, `designVersion`, manifeste v11 |
| `SPEC-TEMPLATES.md` §3.1 | catégorie `version`, statuts par défaut |
| `SPEC-TECH-stack.md` §4.1 | `versions/<ID>.yaml` distinct des instantanés `versions/<REQ>/vN.yaml` |
| `SPEC-FORKS-BRANCHES-BASELINES.md` §5.1 | tag de version poussé (≠ tags de baseline locaux) |
| `SPEC-THEMING.md` §3.3 | type version `chart-4` |
| `SPEC-ELECTRON-DESKTOP.md` §19.3, §19.8b, §20.3 | routes, sous-panneau Produit, règles `VERSION_TYPE_INVALID` |
| `SPEC-INDEX.md` | lignes ci-dessus → MAJ `GH201`, ligne SPEC-REQ §11 ajoutée |

`SPEC-TRACEABILITY §4` (analyse) non modifié : relève de #245.

## Comment tester manuellement

Serveur MCP sur un projet ayant des versions : `list_versions`, `get_version { id }`,
`get_version_backlog` — mêmes données que la page et le backlog de l'application.
