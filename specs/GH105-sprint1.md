# GH105 — Sprint 1 (main) : agrégation des liens sur le workspace, écriture côté source

Périmètre : `specs/GH105-design.md` D1–D7. Rien de visible dans l'UI à ce stade : le renderer
appelle toujours `linkCreate` / `linkDelete` sans `workspaceDir` (comportement antérieur) et
n'utilise pas encore les nouveaux channels (sprint 2).

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `packages/types/src/requirement.ts` | `WorkspaceObject`, `WorkspaceLink` (`storedIn`, `readonly`), `LinkWriteErrorCode` |
| `packages/types/src/schema.ts` | `WorkspaceLinkType` (`definingRepo`), `LinkRefScope` |
| `apps/desktop/src/main/services/workspace-links.service.ts` (nouveau) | `WorkspaceLinksService` : `listObjects`, `listLinks`, `linkTypes`, `plan`, `createLinks` / `createLink`, `deleteLinks` / `deleteLink` ; `LinkWriteError` |
| `apps/desktop/src/main/services/link-validation.util.ts` | `matchesRefs(obj, refs, scope?)` (D2), `refScopeOf`, `validateLinkEntries(…, declaredBy?)` renvoie `ownerId` ; codes = `LinkWriteErrorCode` |
| `apps/desktop/src/main/ipc/index.ts` | `links:objects`, `links:list`, `links:types` ; `requirements:link-create` / `link-delete` : 3e argument `workspaceDir` optionnel ; `Container.workspaceLinks` |
| `apps/desktop/src/main/container.ts`, `apps/desktop/src/mcp-server/container.ts` | instance `WorkspaceLinksService` (avec campagnes pour la résolution) |
| `apps/desktop/src/mcp-server/tools/links.tools.ts` | `list_links` / `create_links` / `delete_links` sur le service : liens de tout le workspace (`storedIn`, `readonly`), écriture côté source, `READONLY_REPO` |
| `apps/desktop/src/main/services/agents-md.template.ts` | stockage d'un lien dans le repo de sa source |
| `apps/desktop/src/web-server/channel-policy.ts` | 3 channels exposés, `ROOT_ARGS` `[0, 1]` ; `link-create` / `link-delete` `[0, 2]` |
| `packages/api-client/src/{types,ipc-client}.ts` | `api.links.{objects, list, types}` ; `linkCreate` / `linkDelete` avec `workspaceDir` |
| `…/workspace-links.service.test.ts`, `…/link-validation.util.test.ts` (nouveaux) | 24 tests (fixture 3 repos de `GH105-tests.md`) |

## Comportement implémenté

- **Lecture** : objets (exigences, tests) et liens de tous les repos du workspace, lus en
  parallèle et fusionnés racine d'abord (id en double : premier gardé, `console.warn`) ; chaque
  lien porte `storedIn` et `readonly`. Types de lien : union par nom, racine prioritaire, avec
  `declaredBy` (ref → repos qui la déclarent).
- **Création** : validation commune MCP / UI (`validateLinkEntries`) avec résolution des refs par
  repo ; le lien est écrit dans le repo de l'objet côté `sourceRefs` ; refus `READONLY_REPO` si ce
  repo est épinglé (HEAD détaché), monté sous un nœud `readonly` du repo racine, ou si l'objet est
  dans un nœud `readonly` de son propre schéma.
- **Suppression** : dans le repo qui stocke le lien ; refus `READONLY_REPO` si ce repo est en
  lecture seule.
- **Erreurs** : `LinkWriteError`, message préfixé par le code (`READONLY_REPO: …`) — seul le
  message traverse l'IPC ; le renderer (S2) l'analysera.
- **Sans `workspaceDir`** : un seul repo, comme avant (IPC historique inchangée).

## Divergences par rapport au design

1. **Channels `links:*`** au lieu de `workspace:*` : le namespace `workspace:` (et `api.workspace`)
   sert déjà à la gestion des projets, avec `workspaceDir` en premier argument.
2. **Sens inverse accepté** (D4.3 prévoyait un refus) : comme `create_links` l'a toujours fait, une
   entrée valide seulement dans le sens inverse est acceptée, le sens fourni conservé, et le lien
   est stocké dans le repo de l'objet côté `sourceRefs` (`ownerId`). Le stockage reste donc
   toujours « côté source » au sens du type de lien.
3. **Doublon contrôlé sur tout le workspace** (la spec dit « dans `S` ») : plus strict, évite
   d'avoir la même paire stockée dans deux repos. Le re-contrôle sous verrou au moment de
   l'écriture ne porte que sur le repo de stockage (un doublon créé au même instant dans un autre
   repo par un autre process reste possible ; il serait affiché une fois par id, pas dédoublonné
   par paire).
4. **Campagnes** résolues dans la table de validation (régression évitée pour les liens MCP vers
   une campagne, GH16) ; jamais candidates dans `listObjects` (hors scope spec).

## Revue de code (`/code-review`)

Corrigés : calculs répétés dans `plan()` (contexte du workspace et schémas lus une fois), deux
agrégateurs d'objets fusionnés (`collectObjects`), lectures par repo en parallèle, regroupement
par repo linéaire (`pushTo`), message `READONLY_REPO` distinct pour un nœud `readonly`.

Conservés (conformes à la spec / au design validés) : refus d'un objet source dans un nœud
`readonly` même si son repo est modifiable (spec §2) ; règle de collision `root::` (D2 : si le repo
qui définit le type de lien déclare la ref, seuls ses objets correspondent).

Écarté : « repos composants non surveillés » — `WorkspaceService.openWorkspace()` démarre le
watcher sur chaque repo de l'arbre, l'index des composants est invalidé sur écriture externe.

## Vérifications

- `pnpm -r typecheck` : OK (pas de config ESLint dans le dépôt).
- `pnpm test` : desktop 624/624, merge-core 38/38 (dont `channel-policy.test.ts`).

## Comment tester manuellement (MCP, sans UI)

Sur PH2, serveur MCP lancé sur `handstickProduct` avec le workspace :
1. `list_links` : les liens de `handstickProduct` apparaissent avec `storedIn` ; ceux d'un repo
   épinglé avec `readonly: true`.
2. `create_links` `dryRun: true`, `implements` `PRODUCT_REQ-xxxx` → `HMI_PH2_REQ-0001` :
   `wouldCreate[0].storedIn` = `handstickProduct`.
3. Même entrée en sens inverse : accepté, même `storedIn`.
