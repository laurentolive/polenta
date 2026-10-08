import type { McpServerLaunchConfig } from '../../mcp-server/mcp-json.template'

/**
 * GH44 — ce qui dépend de l'hôte d'exécution des services (process Electron du desktop, serveur
 * MCP headless, serveur web avec un conteneur par utilisateur), injecté au lieu d'être lu
 * directement depuis `electron` / `keytar` (specs/GH44-design.md §3.1).
 */

/** Stockage des jetons de forge — keytar sur le desktop, session serveur sur le web. */
export interface TokenStore {
  get(account: string): Promise<string | null>
  set(account: string, token: string): Promise<void>
  delete(account: string): Promise<boolean>
}

export interface HostContext {
  /** Équivalent de `app.getPath('userData')` : auth.json, app-settings.json, workspace.json, merge-drafts/. */
  userDataDir: string
  tokenStore: TokenStore
  /** Ouvre une URL dans le navigateur du poste (Device Flow GitHub) — absent hors desktop. */
  openExternal?: (url: string) => Promise<void>
  /**
   * Comment lancer le serveur MCP de ce poste, écrit dans `.mcp.json` (T122). Absent hors desktop :
   * `.mcp.json` n'est alors ni créé ni régénéré — sur le web, le chemin du serveur n'a pas de sens
   * pour les postes des utilisateurs. `AGENTS.md`, contenu du repo, reste écrit partout.
   */
  mcpServerLaunch?: () => McpServerLaunchConfig
}
