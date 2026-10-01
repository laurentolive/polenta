import * as path from 'path'
import * as yaml from 'js-yaml'

import type { WorkspaceTree, WorkspaceTreeNode } from '@polenta/types'

/**
 * GH31 — (dé)sérialisation portable de `<workspace>/.polenta/tree.cache.yaml`.
 *
 * Sur disque, chaque `repoPath` est stocké **relatif à `workspaceDir`** (`.` pour le workspace
 * lui-même) ; en mémoire il reste absolu (contrat de `WorkspaceTreeNode.repoPath`). Un workspace
 * copié ou déplacé résout donc ses chemins vers ses propres dépôts, et non vers ceux d'origine.
 *
 * Compatibilité : un cache antérieur (chemins absolus) est accepté si tous ses chemins sont sous
 * `workspaceDir`. Sinon — ou si un chemin relatif sort de `workspaceDir` — le cache est considéré
 * invalide (`null`) : l'app reconstruit l'arbre, les consommateurs (serveur MCP compris)
 * retombent sur le mode mono-repo au lieu de lire/écrire dans des dépôts étrangers.
 */

/** Parcourt tous les nœuds (liste plate + arbre logique, références partagées visitées une fois). */
function forEachNode(tree: WorkspaceTree, fn: (node: WorkspaceTreeNode) => void): void {
  const seen = new Set<WorkspaceTreeNode>()
  const visit = (node: WorkspaceTreeNode | undefined): void => {
    if (!node || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    fn(node)
    for (const child of node.children ?? []) visit(child)
  }
  for (const node of tree.nodes ?? []) visit(node)
  visit(tree.logicalTree)
}

/** Chemin relatif de `target` sous `workspaceDir`, ou `null` s'il en sort. */
function relativeInside(workspaceDir: string, target: string): string | null {
  const rel = path.relative(path.resolve(workspaceDir), path.resolve(target))
  if (rel === '') return '.'
  if (path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep)) return null
  return rel.split(path.sep).join('/')
}

/** Arbre en mémoire (chemins absolus) → contenu YAML du cache (chemins relatifs). */
export function serializeTreeCache(workspaceDir: string, tree: WorkspaceTree): string {
  const copy = structuredClone(tree)
  forEachNode(copy, node => {
    if (!node.repoPath) return
    // Un chemin hors du workspace (cas non produit par l'app) est laissé absolu : il sera
    // rejeté à la relecture, ce qui force une reconstruction plutôt qu'une résolution fausse.
    node.repoPath = relativeInside(workspaceDir, node.repoPath) ?? node.repoPath
  })
  return yaml.dump(copy, { lineWidth: 120 })
}

/** Contenu YAML du cache → arbre en mémoire (chemins absolus), ou `null` si invalide/étranger. */
export function parseTreeCache(workspaceDir: string, raw: string): WorkspaceTree | null {
  const tree = yaml.load(raw) as WorkspaceTree | null | undefined
  if (!tree || typeof tree !== 'object') return null
  const root = path.resolve(workspaceDir)
  let valid = true
  forEachNode(tree, node => {
    if (!node.repoPath) return
    const abs = path.isAbsolute(node.repoPath) ? node.repoPath : path.resolve(root, node.repoPath)
    if (relativeInside(root, abs) === null) {
      valid = false
      return
    }
    node.repoPath = path.normalize(abs)
  })
  return valid ? tree : null
}
