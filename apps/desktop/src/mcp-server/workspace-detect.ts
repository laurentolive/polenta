import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { repoKey } from '../main/services/schema-refs.util'

/**
 * GH447 — workspace du repo ouvert, quand `--workspace` n'est pas donné. Le `.mcp.json` généré ne
 * passe que `--repo .` (chemin propre au poste, fichier commité) : sans cette détection, le serveur
 * tournait en mode mono-repo et ne voyait aucun composant en repo séparé.
 *
 * Workspace reconnu : le dossier parent porte `.polenta/workspace.yaml` et son `rootRepo` désigne ce
 * repo ; ou le repo lui-même porte un `workspace.yaml` `selfContained`. Tout autre cas : `undefined`
 * (mode mono-repo, comme avant).
 */
export function detectWorkspaceDir(repoPath: string): string | undefined {
  const parent = path.dirname(repoPath)
  const outer = readWorkspaceConfig(parent)
  if (outer?.rootRepo && repoKey(path.join(parent, outer.rootRepo)) === repoKey(repoPath)) return parent
  if (readWorkspaceConfig(repoPath)?.selfContained) return repoPath
  return undefined
}

function readWorkspaceConfig(dir: string): { rootRepo?: string; selfContained?: boolean } | null {
  try {
    const parsed = yaml.load(fs.readFileSync(path.join(dir, '.polenta', 'workspace.yaml'), 'utf-8'))
    return parsed && typeof parsed === 'object' ? parsed as { rootRepo?: string; selfContained?: boolean } : null
  } catch {
    return null
  }
}
