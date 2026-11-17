/**
 * GH343 — appartenance d'un repo au projet affiché par une fenêtre. Les repos d'un projet sont
 * clonés à plat dans le dossier du workspace (projet simple : le dossier est le repo lui-même) ;
 * `localParent` n'est qu'un rangement logique. Comparaison tolérante aux séparateurs et, sous
 * Windows (lettre de lecteur), à la casse.
 */

function normalize(p: string): string {
  let out = p.replace(/\\/g, '/').replace(/\/+$/, '')
  if (/^[a-zA-Z]:/.test(out)) out = out.toLowerCase()
  return out
}

/** `repoPath` est `workspaceDir` ou un de ses sous-dossiers. */
export function isInsideWorkspace(workspaceDir: string, repoPath: string): boolean {
  const dir = normalize(workspaceDir)
  const repo = normalize(repoPath)
  if (!dir) return false
  return repo === dir || repo.startsWith(`${dir}/`)
}
