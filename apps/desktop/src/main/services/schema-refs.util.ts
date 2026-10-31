import * as fsP from 'fs/promises'
import * as path from 'path'
import { flattenSystemNodes } from '@polenta/types'
import type { ProjectSchema } from '@polenta/types'
import type { CampaignsService } from './campaigns.service'
import type { RequirementsService } from './requirements.service'
import type { TestsService } from './tests.service'

/**
 * Opérations sur les refs `<nœud>::<type>` d'un workspace multi-repos, partagées par le renommage
 * (GH100, `type-rename.service.ts`) et la suppression en cascade (GH104, `schema-delete.service.ts`).
 */

export type ObjectCategory = 'requirement' | 'test' | 'campaign'

export interface ObjectServices {
  requirements: Pick<RequirementsService, 'findAll'>
  tests: Pick<TestsService, 'findAll'>
  campaigns: Pick<CampaignsService, 'list'>
}

/** Le schéma déclare-t-il le type `ref` (`<nœud>::<type>`, nœud à n'importe quelle profondeur) ? */
export function declaresRef(schema: ProjectSchema, ref: string): boolean {
  const [node, type] = ref.split('::')
  return flattenSystemNodes(schema.nodes ?? []).some(({ node: n }) => n.name === node && (n.objectTypes ?? []).some(t => t.name === type))
}

/**
 * Réécrit les refs `sourceRefs` / `targetRefs` de chaque type de lien : `fn` rend la nouvelle ref,
 * ou `null` pour la retirer. Une liste vidée reste (`[]`), une clé absente reste absente.
 */
export function mapLinkRefs(schema: ProjectSchema, fn: (ref: string) => string | null): ProjectSchema {
  const map = (refs: string[]) => refs.map(fn).filter((r): r is string => r !== null)
  return {
    ...schema,
    linkTypes: (schema.linkTypes ?? []).map(l => ({
      ...l,
      ...(l.sourceRefs && { sourceRefs: map(l.sourceRefs) }),
      ...(l.targetRefs && { targetRefs: map(l.targetRefs) }),
    })),
  }
}

/** IDs des objets de type `ref` stockés dans `repoPath`. */
export async function objectIdsOfType(services: ObjectServices, repoPath: string, category: ObjectCategory, ref: string): Promise<string[]> {
  if (category === 'requirement') return (await services.requirements.findAll(repoPath, { type: ref })).map(o => o.id)
  if (category === 'test') return (await services.tests.findAll(repoPath)).filter(o => o.objectTypeRef === ref).map(o => o.id)
  return (await services.campaigns.list(repoPath)).filter(o => o.objectTypeRef === ref).map(o => o.id)
}

/**
 * Repos sans doublon : le chemin reçu du renderer et celui du cache du workspace (normalisé,
 * `tree-cache.util.ts`) peuvent différer par la casse ou les séparateurs — le même repo serait
 * réécrit deux fois. `repoPath` (repo du type) garde sa forme : c'est elle que comparent les étapes.
 */
export function dedupeRepos(repoPath: string, repos: string[]): string[] {
  const seen = new Set<string>([repoKey(repoPath)])
  const out = [repoPath]
  for (const repo of repos) {
    if (seen.has(repoKey(repo))) continue
    seen.add(repoKey(repo))
    out.push(repo)
  }
  return out
}

/** Clé de comparaison d'un chemin de repo (absolu, insensible à la casse sous Windows). */
export function repoKey(p: string): string {
  const abs = path.resolve(p)
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

export async function pathExists(p: string): Promise<boolean> {
  return fsP.access(p).then(() => true, () => false)
}
