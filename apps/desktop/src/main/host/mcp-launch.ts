import { app } from 'electron'
import * as path from 'path'
import type { McpServerLaunchConfig } from '../../mcp-server/mcp-json.template'

/**
 * Résout comment lancer le serveur MCP Polenta pour le repo produit courant (T122
 * sprint 4 — specs/T122-design.md §6.2). Le résultat est écrit tel quel dans
 * `.mcp.json` (`mcpServers.polenta`) : `command`/`args`/`env` que le client MCP
 * exécutera avec le repo produit comme cwd — `--repo .` désigne donc toujours le bon
 * repo, quel que soit l'endroit d'où l'utilisateur a installé Polenta (convention
 * standard des clients MCP : ils lancent la commande depuis le dossier où vit
 * `.mcp.json`).
 *
 * Deux branches selon `app.isPackaged` :
 *
 * - **Dev** (checkout du monorepo source, `pnpm dev`) : `node <tsx-cli> <source
 *   .ts> --repo .` — suppose un `node` sur le PATH du poste (déjà requis pour
 *   `pnpm`/le développement de ce repo), et résout les chemins depuis
 *   `app.getAppPath()` (répertoire de `apps/desktop` en dev — API Electron dédiée à
 *   cet usage).
 * - **Packagé** (app installée via `electron-builder`) : le bundle autonome
 *   `resources/mcp-server/index.cjs` (produit par `pnpm build:mcp-server`, copié par
 *   `extraResources`, cf. `electron-builder.yml`) est lancé avec le binaire Electron
 *   packagé lui-même, en mode `ELECTRON_RUN_AS_NODE=1` — évite toute dépendance à un
 *   Node.js système sur le poste utilisateur final (souvent absent d'une machine qui
 *   n'a qu'installé l'app Polenta, contrairement à un poste de développement).
 *
 * Vérifié manuellement (cf. specs/T122-sprint4.md) : le bundle esbuild + le
 * lancement via `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe
 * out/mcp-server/index.cjs --repo <path>` démarrent bien un serveur MCP fonctionnel —
 * reproduit le mécanisme packagé sans nécessiter un build `electron-builder` complet
 * (non exécuté dans cet environnement, cf. limitations documentées dans
 * `specs/T122-sprint4.md`).
 */
export function resolveMcpServerLaunchConfig(): McpServerLaunchConfig {
  if (app.isPackaged) {
    const bundlePath = path.join(process.resourcesPath, 'mcp-server', 'index.cjs')
    return {
      command: process.execPath,
      args: [bundlePath, '--repo', '.'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    }
  }

  const appRoot = app.getAppPath() // `apps/desktop` en dev (electron-vite dev)
  const tsxCli = path.join(appRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const mcpServerEntry = path.join(appRoot, 'src', 'mcp-server', 'index.ts')
  return {
    command: 'node',
    args: [tsxCli, mcpServerEntry, '--repo', '.'],
  }
}
