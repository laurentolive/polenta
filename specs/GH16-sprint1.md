# GH16 — Sprint 1 (unique) : tools MCP de gestion des liens

> Issue [#16](https://github.com/laurentolive/polenta/issues/16) — spec `specs/GH16.md`,
> design `specs/GH16-design.md`, tests `specs/GH16-tests.md`.

## Fichiers modifiés

| Fichier | Modification |
|---|---|
| `apps/desktop/src/mcp-server/tools/links.tools.ts` | **nouveau** — `list_links`, `create_links`, `delete_links` |
| `apps/desktop/src/main/services/link-validation.util.ts` | **nouveau** — `validateLinkEntries`, `matchesRefs` |
| `apps/desktop/src/main/services/requirements-index.service.ts` | `reloadLinks`, `createLinks`, `deleteLinks` (verrou `withKeyLock` par repo), `newLinkId()` factorisé |
| `apps/desktop/src/main/services/requirements.service.ts` | façades des 3 méthodes |
| `apps/desktop/src/mcp-server/container.ts` | expose `reqIndex`, `testsIndex` |
| `apps/desktop/src/mcp-server/index.ts` | `registerLinkTools` |
| `apps/desktop/src/main/services/agents-md.template.ts` | tools de liens documentés, version 1 → 2 |
| `apps/desktop/src/renderer/components/system/linkUtils.ts` | commentaire croisé (règle `matchesRefs` dupliquée côté main) |
| `specs/SPEC-MCP-SERVER.md`, `specs/SPEC-INDEX.md` | voir « Mises à jour SPEC » |

## Comportement implémenté

Conforme à la spec et au design : 3 tools, validation stricte en 5 règles, `dryRun` par
défaut sur les écritures, catégorie déduite du dossier de stockage, résolution
workspace-wide avec `--workspace`, invalidation + nouvel essai unique sur ID introuvable,
relecture disque de `links.yaml` avant chaque opération, écriture unique par lot,
`createdBy: 'mcp'`.

## Divergences par rapport au design

1. **Contrôle de doublon refait sous verrou** (issu de la revue `/code-review`) : le
   design acceptait la course entre validation et écriture. `createLinks` relit le fichier
   sous verrou et écarte toute entrée devenue doublon ; il retourne un tableau aligné sur
   l'entrée (`ObjectLink | null`) au lieu de `ObjectLink[]`, et le tool reporte les `null`
   en `DUPLICATE_LINK`. Deux `create_links` concurrents du même lien → un seul écrit.
2. **`delete_links`** : un lien trouvé à la validation mais disparu au moment de
   l'écriture (supprimé par l'app) est reporté `LINK_NOT_FOUND` ; `summary.ok` reflète les
   suppressions réelles.
3. `reloadLinks` lève aussi sur un contenu non vide sans tableau `links` (garde ajoutée au
   design avant le sprint).

## Mises à jour SPEC

- `SPEC-MCP-SERVER.md` §1 — `dryRun` par défaut étendu à `create_links`/`delete_links`.
- `SPEC-MCP-SERVER.md` §3 — `McpContainer` expose `reqIndex`/`testsIndex`.
- `SPEC-MCP-SERVER.md` §4.4 — **nouvelle section** « Liens » : contrats des 3 tools,
  règles de validation, relecture disque, verrou et contrôle de doublon sous verrou.
- `SPEC-MCP-SERVER.md` §5.2 — `AGENTS_MD_TEMPLATE_VERSION` passée à 2.
- `SPEC-MCP-SERVER.md` §7 — limitation mono-repo pour `create_links` ; fenêtre de course
  inter-process résiduelle sur `links.yaml`.
- `SPEC-MCP-SERVER.md` §8 — 3 fichiers ajoutés.
- `SPEC-INDEX.md` — ligne SPEC-MCP-SERVER : mots-clés liens, MAJ → GH16.

## Vérifications

- `pnpm --filter desktop run typecheck` : 0 erreur. `build:mcp-server` : bundle OK.
- `/code-review` (medium) : 1 constat (doublon possible en concurrence) → corrigé (divergence 1).
- Scénarios `GH16-tests.md` exécutés avec un **vrai client MCP stdio** (script Node,
  `@modelcontextprotocol/sdk/client`) contre le bundle, sur une copie jetable du workspace
  `handstickProduct` (+ 2 linkTypes de test : `derives` requirement→requirement,
  `planned` campaign→test) :
  - OK : 1–8, 10–25 (mode workspace et mono-repo), 26 (YAML invalide et YAML sans
    tableau `links` : erreur de protocole, fichier intact), 28, + concurrence.
  - 27 : vérifié sur le gabarit (marqueur version 2, les 3 tools cités) ; la régénération
    à l'ouverture repose sur le mécanisme existant (`ensureVersionedFile`), non rejoué dans
    l'app.
  - **9 non exécuté** (affichage dans l'app ouverte en parallèle) : à vérifier à la main.

## Tester manuellement

1. Dans un projet ouvert dans l'app, avec Claude Code connecté via `.mcp.json` : demander
   `create_links` d'un lien `verification` test → exigence (sans puis avec
   `dryRun: false`).
2. Vérifier que le lien apparaît dans la vue édition de l'exigence sans redémarrer l'app
   (scénario 9), puis `delete_links` et vérifier qu'il disparaît.
3. Rouvrir le projet : `AGENTS.md` régénéré en version 2 mentionne les tools de liens.
