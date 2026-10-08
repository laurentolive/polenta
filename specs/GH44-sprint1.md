# GH44 — Sprint 1 : découplage du desktop

Périmètre : `specs/GH44-design.md` §3. Aucun changement de comportement attendu sur le desktop.

## Fichiers modifiés

Créés :
- `main/host/host-context.ts` : `HostContext` (`userDataDir`, `tokenStore`, `openExternal?`,
  `mcpServerLaunch?`), `TokenStore`.
- `main/host/electron-host.ts` : `KeytarTokenStore`, `createElectronHostContext()`.
- `main/host/platform-host.ts` : `PlatformHost` (`kind`, `broadcast`, `exportTemplateExamplesDir`).
- `main/host/print-renderer.ts` : `PrintRenderer` + `PRINT_ROUTE_BY_KIND` (partagé).
- `main/host/electron-print.ts` : `electronPrintRenderer`.
- `main/ipc/registry.ts` : `HandlerRegistry`.
- `main/ipc/file-ops.ts` : `importFileIntoRepo`, `saveExport`, `saveExecutionSheet`,
  `findAvailableFileName`, tables MIME.
- `main/ipc/desktop-only.handlers.ts` : `ipcMainRegistry`, `electronPlatformHost`,
  `registerDesktopOnlyHandlers` (17 channels : dialogues, shell, `app:set-title|get-version|open-release-page`,
  `update:*`, `auth:device-flow-*`, `export:save|show-in-folder|open-file`,
  `campaigns:execution-sheet-export|preview`, `image:pick-file`, `drawio:open-external`).

Déplacés (`git mv`) :
- `services/pdf.util.ts` → `host/electron-pdf.ts`
- `services/export/template/drawio-snapshot.ts` → `host/electron-drawio-snapshot.ts`
- `services/mcp-launch.util.ts` → `host/mcp-launch.ts`

Modifiés :
- `main/ipc/index.ts` : `registerIpcHandlers(c)` → `registerHandlers(r, c, platform)`, 179 handlers
  partagés via `r.handle`, plus aucun import `electron`.
- `main/ipc/pref.handlers.ts` : `registerPrefHandlers(r)`.
- `main/container.ts` : `createContainer(host, print): Container`, synchrone, sans `UpdateService`
  ni enregistrement.
- `main/index.ts` : assemble hôte Electron + `registerHandlers` + `UpdateService` + channels
  desktop-only.
- Services : `auth` (`HostContext`, plus de `keytar`/`electron`), `app-settings` et
  `merge-resolution` (`userDataDir`), `workspace` (`HostContext`, `.mcp.json` conditionné par
  `mcpServerLaunch`), `export` (`PrintRenderer`).
- `mcp-server/container.ts` : `mcpHostContext` headless (accès `userData`/jetons → erreur explicite).
- Commentaires renvoyant aux fichiers renommés (renderer, template-export).

## Comportement implémenté

Desktop strictement identique : même ensemble de 198 channels enregistrés qu'avant (vérifié par
comparaison avec `main`), même emplacement des données (`userData`), mêmes dialogues. Le noyau
`createContainer` + `registerHandlers` ne dépend plus d'Electron : il peut être instancié par
utilisateur côté serveur (S2) avec un autre `HostContext` / `PlatformHost` / `PrintRenderer`.

`grep "from 'electron'" src/main/services` → `net-proxy.ts` (best-effort, toléré par le shim) et
`update.service.ts` (desktop only) uniquement.

## Divergences par rapport au design

- `features.writeAgentFiles` remplacé par `HostContext.mcpServerLaunch?` : seul `.mcp.json`
  (binaire MCP du poste) est conditionné, `AGENTS.md` reste écrit partout. Cela sort aussi
  `mcp-launch` (qui lit `app.isPackaged`) du noyau. Design mis à jour (§3.1).
- Extractions `file-ops` regroupées : `importFileIntoRepo(…, 'images' | 'diagrams')`, `saveExport`,
  `saveExecutionSheet` ; pas d'extraction pour la lecture base64 d'image (faite par le navigateur en
  web) ni pour l'aperçu du classeur (appel de service direct). Design mis à jour (§3.2).
- Device Flow : lève une erreur explicite si l'hôte n'a pas `openExternal` (au lieu de continuer
  silencieusement).
- `SPEC-ELECTRON-DESKTOP.md` cite encore `registerIpcHandlers` (§2, §11) : mis à jour au sprint
  final avec les autres sections (design §6.5).

## Mises à jour SPEC

Aucune (sprint non final).

## Vérifications

- `pnpm typecheck` (desktop) : 0 erreur.
- `pnpm build` (electron-vite) et `pnpm build:mcp-server` : OK. Le code PDF reste dans
  `out/main/index.js` (résolution du preload depuis `__dirname`), l'instantané drawio dans un chunk.
- `pnpm --filter @polenta/merge-core test` : 34/34.
- Lancement de l'app buildée (25 s) : démarrage, réouverture du dernier workspace et indexation
  sans erreur.
- `/code-review` : 10 constats, tous traités (dont un commentaire mal encodé et un import
  `electron` résiduel via `mcp-launch`).

## Comment tester manuellement

Dérouler S1-1 à S1-8 de `specs/GH44-tests.md` sur `pnpm dev` (desktop) :
connexion PAT + Device Flow, insertion image/drawio (hors repo puis dans le repo), exports
Word/Excel/PDF + gabarit avec drawio, classeur d'exécution export/import, écriture externe, merge
GH37 avec abandon/reprise, auto-update / « Afficher dans le dossier » / « Ouvrir dans draw.io »,
serveur MCP (`pnpm mcp-server` et bundle).

> Lancement depuis le terminal de VS Code : `ELECTRON_RUN_AS_NODE=1` y est hérité et fait démarrer
> Electron en mode Node (`app` indéfini). Le désactiver (`env -u ELECTRON_RUN_AS_NODE`) — sans
> rapport avec ce sprint.
