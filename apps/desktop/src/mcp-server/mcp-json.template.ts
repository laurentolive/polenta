/**
 * Contenu de `.mcp.json` écrit à la racine de tout projet Polenta (T122 sprint 4) —
 * convention standard des clients MCP (Claude Code, Cursor…) : une entrée
 * `mcpServers.<name>.{command,args,env?}` que le client lance lui-même (stdio) dès
 * qu'il ouvre ce dossier.
 *
 * Ce fichier ne dépend PAS d'`electron` (contrairement à la résolution de la commande
 * de lancement elle-même, `main/services/mcp-launch.util.ts`, qui a besoin
 * d'`app.isPackaged`) — cohérent avec le reste de `src/mcp-server/`, qui ne doit rien
 * importer d'`electron` (cf. specs/T122-design.md §2.1 : le process MCP tourne hors
 * Electron). `mcp-launch.util.ts` construit la valeur `McpServerLaunchConfig` et la
 * passe à `buildMcpJsonContent` — la dépendance à `electron` reste côté appelant
 * (`main/services/workspace.service.ts`), jamais dans ce fichier.
 */

/**
 * Version courante du gabarit `.mcp.json`. Le champ `_polentaTemplateVersion` du
 * fichier généré est comparé à cette constante par
 * `WorkspaceService.ensureAgentFiles()` (même mécanisme que
 * `AGENTS_MD_TEMPLATE_VERSION` — absent ou antérieur → régénéré ; égal → fichier
 * inchangé). Les clients MCP ignorent les clés inconnues à la racine de `.mcp.json`,
 * donc ce champ ne perturbe pas la découverte des tools.
 */
export const MCP_JSON_TEMPLATE_VERSION = 1

export interface McpServerLaunchConfig {
  command: string
  args: string[]
  env?: Record<string, string>
}

/** Construit le contenu texte de `.mcp.json` à partir de la commande de lancement résolue. */
export function buildMcpJsonContent(launch: McpServerLaunchConfig): string {
  const doc = {
    _polentaTemplateVersion: MCP_JSON_TEMPLATE_VERSION,
    mcpServers: {
      polenta: {
        command: launch.command,
        args: launch.args,
        ...(launch.env ? { env: launch.env } : {}),
      },
    },
  }
  return JSON.stringify(doc, null, 2) + '\n'
}

/**
 * Extrait `_polentaTemplateVersion` d'un `.mcp.json` existant, ou `undefined` si
 * absent/JSON invalide/pas un nombre (fichier pré-T122, ou modifié à la main sans ce
 * champ — auquel cas une régénération est déclenchée, cf. `ensureAgentFiles`).
 */
export function extractMcpJsonVersion(raw: string): number | undefined {
  try {
    const parsed = JSON.parse(raw) as { _polentaTemplateVersion?: unknown }
    return typeof parsed._polentaTemplateVersion === 'number' ? parsed._polentaTemplateVersion : undefined
  } catch {
    return undefined
  }
}

/**
 * GH447 — chemins absolus de la commande de lancement (`command` et `args` de `mcpServers.polenta`).
 * Le fichier est commité mais la commande est propre au poste qui l'a écrit (exécutable installé, ou
 * dossier d'extraction temporaire d'un ancien build portable) : un chemin absent sur ce poste rend le
 * fichier périmé. Les arguments relatifs (`.`) et les options sont ignorés.
 */
export function extractMcpJsonAbsolutePaths(raw: string, isAbsolute: (p: string) => boolean): string[] {
  try {
    const parsed = JSON.parse(raw) as { mcpServers?: { polenta?: { command?: unknown; args?: unknown } } }
    const server = parsed.mcpServers?.polenta
    const values = [server?.command, ...(Array.isArray(server?.args) ? server.args : [])]
    return values.filter((v): v is string => typeof v === 'string' && isAbsolute(v))
  } catch {
    return []
  }
}
