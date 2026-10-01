import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { ProjectSchema, WorkspaceTreeNode, DiamondConflict } from '@polenta/types'
import { flattenSystemNodes } from '@polenta/types'

export interface WorkspaceStructure {
  /** True once we know whether `workspaceDir` is a recognized flat workspace. */
  isReady: boolean
  isLoading: boolean
  error: string | null
  /** Diamond conflicts to resolve before the tree can be built, if any. */
  conflicts: DiamondConflict[] | null
  /** Top-level nodes to render (empty while detection is still in flight or the directory is unrecognized). */
  tree: WorkspaceTreeNode[]
  /** Flat, deduplicated list of every repo in the workspace — use this to resolve a mount name to its pin (e.g. implemented interface version). */
  flatNodes: WorkspaceTreeNode[]
  schemasByRepoPath: Map<string, ProjectSchema>
  /** All object-type prefixes currently in use across every repo shown in the tree. */
  allPrefixes: Set<string>
  /** True only once every repo's schema in the tree has successfully loaded — gates prefix-uniqueness validation. */
  allSchemasLoaded: boolean
  refetchTree: () => Promise<void>
}

/**
 * Builds the data needed to render the Structure tab: the workspace repo tree
 * (or a single synthetic node when the directory is a bare repo, not yet a
 * flat workspace) plus every repo's schema, fetched in parallel and aggregated
 * for cross-repo prefix validation.
 */
export function useWorkspaceStructure(workspaceDir: string, repoPath: string): WorkspaceStructure {
  const qc = useQueryClient()

  const detectQuery = useQuery({
    queryKey: ['workspace-detect', workspaceDir],
    queryFn: () => api.workspace.detect(workspaceDir),
    enabled: !!workspaceDir,
  })

  const kind = detectQuery.data // 'workspace' | 'repo' | 'unknown' | undefined (still detecting)
  const isWorkspace = kind === 'workspace'
  const isUnknown = kind === 'unknown'
  const isDetecting = detectQuery.isLoading

  const openQuery = useQuery({
    queryKey: ['workspace-open', workspaceDir],
    queryFn: () => api.workspace.open(workspaceDir),
    enabled: isWorkspace,
  })

  const openResult = openQuery.data
  const treeError =
    isUnknown ? 'Ce répertoire ne correspond plus à un projet Polenta valide (déplacé ou supprimé ?).'
    : openResult?.status === 'not-a-workspace' ? 'Ce répertoire n\'est pas un workspace Polenta.'
    : openResult?.status === 'parse-error' && openResult.remoteAccess ? openResult.error
    : openResult?.status === 'parse-error' ? `Erreur de parsing dans "${openResult.repoName}" : ${openResult.error}`
    : null

  // Only compute the node list once detection has actually resolved — avoids
  // fetching a throwaway schema for a synthetic node while still detecting,
  // and avoids silently treating an unrecognized directory as an empty repo.
  const flatNodes: WorkspaceTreeNode[] =
    isWorkspace && openResult?.status === 'ok' ? openResult.tree.nodes
    : kind === 'repo' ? [{ name: 'root', repoPath, url: '', pin: '', isInterface: false, children: [] }]
    : []

  const schemaQueries = useQueries({
    queries: flatNodes.map(node => ({
      queryKey: ['schema', node.repoPath],
      queryFn: () => api.schema.get(node.repoPath),
      staleTime: Infinity,
    })),
  })

  const schemasByRepoPath = new Map<string, ProjectSchema>()
  schemaQueries.forEach((q, i) => {
    if (q.data) schemasByRepoPath.set(flatNodes[i].repoPath, q.data)
  })

  const allSchemasLoaded = flatNodes.length > 0 && schemaQueries.every(q => q.isSuccess)

  // T123 — un composant local imbriqué (SystemNode.children) doit aussi être couvert par la
  // validation d'unicité de préfixe projet-wide, pas seulement le premier niveau de schema.nodes.
  const allPrefixes = new Set<string>()
  for (const schema of schemasByRepoPath.values()) {
    for (const { node } of flattenSystemNodes(schema.nodes)) {
      for (const ot of node.objectTypes ?? []) {
        if (ot.prefix) allPrefixes.add(ot.prefix)
      }
    }
  }

  const tree: WorkspaceTreeNode[] =
    isWorkspace && openResult?.status === 'ok' ? [openResult.tree.logicalTree] : flatNodes

  const isLoading =
    isDetecting ||
    (isWorkspace && openQuery.isLoading) ||
    schemaQueries.some(q => q.isLoading)

  return {
    isReady: !isDetecting,
    isLoading,
    error: treeError,
    conflicts: openResult?.status === 'diamond-conflict' ? openResult.conflicts : null,
    tree,
    flatNodes,
    schemasByRepoPath,
    allPrefixes,
    allSchemasLoaded,
    refetchTree: async () => {
      await openQuery.refetch()
      // Bust the main-process SchemaService cache first (schema.yaml may have changed on disk
      // out-of-band — manual edit, git pull/checkout…) — invalidating only the react-query cache
      // below would just re-request the same stale in-memory copy from the main process, since
      // `staleTime: Infinity` means the query only ever refetches on explicit invalidation, and
      // `SchemaService.get()` has no other way to know the file changed.
      await Promise.all(flatNodes.map(node => api.schema.invalidate(node.repoPath)))
      await Promise.all(flatNodes.map(node => qc.invalidateQueries({ queryKey: ['schema', node.repoPath] })))
    },
  }
}
