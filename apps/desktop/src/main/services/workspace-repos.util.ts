import type { WorkspaceTreeService } from './workspace-tree.service'

/**
 * Repos à agréger pour une vue transverse (traçabilité, revalidation T172) : en mono-repo,
 * `[repoPath]` ; en mode workspace (`workspaceDir` fourni), `repoPath` + tous les repos
 * composants du cache de l'arbre workspace. Extrait de `TraceabilityService` (T172) pour
 * que `RevalidationService` suive exactement le même graphe de liens que la matrice.
 */
export async function resolveWorkspaceRepoPaths(
  workspaceTree: WorkspaceTreeService | undefined,
  repoPath: string,
  workspaceDir?: string,
): Promise<string[]> {
  if (!workspaceDir || !workspaceTree) return [repoPath]
  const tree = await workspaceTree.readCache(workspaceDir)
  if (!tree) return [repoPath]
  const paths = new Set<string>([repoPath])
  for (const node of tree.nodes) {
    if (node.repoPath) paths.add(node.repoPath)
  }
  return Array.from(paths)
}
