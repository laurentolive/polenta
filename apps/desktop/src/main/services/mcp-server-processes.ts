import { execFileSync } from 'child_process'
import * as path from 'path'

/**
 * GH293 — serveurs MCP lancés depuis l'installation courante. Un client MCP (Claude Desktop, Claude
 * Code…) les lance avec notre exécutable en mode node (`.mcp.json`, host/mcp-launch.ts) : ce ne sont
 * pas nos enfants, ils survivent à la fermeture de l'application et verrouillent `Polenta.exe` et
 * `resources\`, ce qui fait échouer le désinstalleur de l'ancienne version (`uninstallFailed: 2`).
 *
 * Windows seulement : ailleurs, remplacer un fichier ouvert ne bloque pas la mise à jour.
 */

export interface ProcessInfo {
  pid: number
  commandLine: string
}

/** Le nom de l'exécutable passe par l'environnement : une marque peut y mettre une apostrophe.
 * Sortie forcée en UTF-8 : le chemin d'installation peut contenir des accents. */
const LIST_PROCESSES_SCRIPT = [
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8;',
  'ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process',
  '| Where-Object { $_.Name -eq $env:POLENTA_MCP_EXE_NAME }',
  '| Select-Object @{n="pid";e={$_.ProcessId}}, @{n="commandLine";e={$_.CommandLine}})',
].join(' ')

export function parseProcessList(stdout: string): ProcessInfo[] {
  const parsed: unknown = JSON.parse(stdout)
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  return rows.flatMap((row: { pid?: unknown; commandLine?: unknown }) =>
    typeof row?.pid === 'number' && typeof row.commandLine === 'string'
      ? [{ pid: row.pid, commandLine: row.commandLine }]
      : [],
  )
}

/** Le chemin complet du bundle écarte les processus auxiliaires d'Electron (même exécutable, à ne
 * pas tuer avant la fermeture) et les serveurs d'une autre installation. */
export function selectMcpServerPids(processes: ProcessInfo[], bundlePath: string, ownPid: number): number[] {
  const normalize = (value: string) => value.replace(/\\/g, '/').toLowerCase()
  const bundle = normalize(bundlePath)
  return processes
    .filter((p) => p.pid !== ownPid && normalize(p.commandLine).includes(bundle))
    .map((p) => p.pid)
}

/** Synchrone : doit pouvoir s'exécuter dans `will-quit`, juste avant le lancement de l'installeur.
 * Une détection impossible (PowerShell bloqué…) ne doit pas empêcher la mise à jour. */
export function findMcpServerPids(execPath: string, resourcesPath: string, ownPid: number = process.pid): number[] {
  if (process.platform !== 'win32') return []
  try {
    const stdout = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', LIST_PROCESSES_SCRIPT],
      {
        encoding: 'utf8',
        timeout: 10_000,
        windowsHide: true,
        env: { ...process.env, POLENTA_MCP_EXE_NAME: path.basename(execPath) },
      },
    )
    return selectMcpServerPids(parseProcessList(stdout), path.join(resourcesPath, 'mcp-server', 'index.cjs'), ownPid)
  } catch (err) {
    console.warn('[update] détection des serveurs MCP impossible :', err)
    return []
  }
}

export function stopProcesses(pids: number[]): void {
  for (const pid of pids) {
    try {
      process.kill(pid)
    } catch (err) {
      // Déjà terminé, ou refusé : l'installeur tranchera.
      console.warn(`[update] arrêt du serveur MCP ${pid} impossible :`, err)
    }
  }
}
