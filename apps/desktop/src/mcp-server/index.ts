#!/usr/bin/env node
/**
 * Point d'entrée du serveur MCP stdio Polenta (T122 sprint 1).
 *
 * Process Node.js autonome, indépendant du process Electron principal — ne construit
 * jamais de `BrowserWindow`, n'appelle `app.whenReady()` nulle part. Scoping "un repo
 * fixe par instance" (cf. specs/T122.md) : `--repo` est obligatoire, `--workspace` est
 * optionnel (mode mono-repo si absent, cf. specs/T122-design.md §2.3).
 *
 * stdout est réservé au protocole MCP (JSON-RPC sur stdio) — tout message de
 * diagnostic va sur stderr, jamais sur stdout, sous peine de casser un client MCP
 * strict.
 *
 * Usage :
 *   pnpm --filter desktop run mcp-server -- --repo <path> [--workspace <path>]
 * ou via variables d'environnement :
 *   POLENTA_REPO_PATH=<path> POLENTA_WORKSPACE_DIR=<path> pnpm --filter desktop run mcp-server
 * (CLI prioritaire si les deux mécanismes sont fournis.)
 */

import * as fs from 'fs'
import * as path from 'path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpContainer } from './container'
import { registerSchemaTools } from './tools/schema.tools'
import { registerReadTools } from './tools/read.tools'
import { registerBulkImportTools } from './tools/bulk-import.tools'
import { registerSchemaMutationTools } from './tools/schema-mutation.tools'
import { registerLinkTools } from './tools/links.tools'

interface ParsedArgs {
  repo?: string
  workspace?: string
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo' && argv[i + 1] !== undefined) {
      result.repo = argv[++i]
    } else if (argv[i] === '--workspace' && argv[i + 1] !== undefined) {
      result.workspace = argv[++i]
    }
  }
  return result
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const repoPathArg = args.repo ?? process.env.POLENTA_REPO_PATH
  const workspaceDirArg = args.workspace ?? process.env.POLENTA_WORKSPACE_DIR

  if (!repoPathArg) {
    console.error(
      '[mcp-server] repoPath manquant — passez --repo <path> ou définissez POLENTA_REPO_PATH.',
    )
    process.exit(1)
    return
  }

  const repoPath = path.resolve(repoPathArg)
  if (!fs.existsSync(repoPath)) {
    console.error(`[mcp-server] repoPath introuvable : ${repoPath}`)
    process.exit(1)
    return
  }

  const workspaceDirResolved = workspaceDirArg ? path.resolve(workspaceDirArg) : undefined
  const workspaceDirExists = workspaceDirResolved !== undefined && fs.existsSync(workspaceDirResolved)
  if (workspaceDirResolved && !workspaceDirExists) {
    console.error(`[mcp-server] avertissement : workspaceDir introuvable (${workspaceDirResolved}), repli en mode mono-repo.`)
  }

  const container = createMcpContainer(repoPath, workspaceDirExists ? workspaceDirResolved : undefined)

  const server = new McpServer({ name: 'polenta-mcp-server', version: '0.1.0' })
  registerSchemaTools(server, container)
  registerReadTools(server, container)
  registerBulkImportTools(server, container)
  registerSchemaMutationTools(server, container)
  registerLinkTools(server, container)

  const transport = new StdioServerTransport()
  await server.connect(transport)

  console.error(
    `[mcp-server] démarré — repo: ${repoPath}${container.workspaceDir ? `, workspace: ${container.workspaceDir}` : ''}`,
  )
}

main().catch((err: unknown) => {
  console.error('[mcp-server] erreur fatale au démarrage :', err)
  process.exit(1)
})
