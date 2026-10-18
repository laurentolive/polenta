import * as fsP from 'fs/promises'
import * as path from 'path'
import { flattenSystemNodes, mapSystemNode, removeSystemNode } from '@polenta/types'
import type { ObjectLink, ProjectSchema, SchemaDeletePlan, SchemaDeleteResult, SchemaDeleteTarget } from '@polenta/types'
import type { CampaignsService } from './campaigns.service'
import type { GitService } from './git.service'
import { deleteWithTombstone } from './id-counter.util'
import type { RequirementsIndexService } from './requirements-index.service'
import type { SchemaService } from './schema.service'
import { declaresRef, dedupeRepos, mapLinkRefs, objectIdsOfType, pathExists, repoKey } from './schema-refs.util'
import type { ObjectCategory, ObjectServices } from './schema-refs.util'
import { withKeyLock } from './serialize-writes.util'
import type { TreeService } from './tree.service'

interface DeletedType { ref: string; node: string; type: string; category: ObjectCategory }

interface Computed {
  plan: SchemaDeletePlan
  repos: string[]
  schema: ProjectSchema | null
  types: DeletedType[]
  /** Liens dont une extrémité est supprimée, par repo. */
  links: Map<string, ObjectLink[]>
  /** Refs à retirer des `linkTypes`, par repo dont le schéma change. */
  refsByRepo: Map<string, Set<string>>
}

/**
 * GH104 — suppression en cascade d'un composant local (avec son sous-arbre) ou d'un type depuis
 * l'onglet Structure (specs/GH104-design.md §2.3). `plan` : aperçu sans écriture ; `delete` refait
 * le calcul sur l'état disque, refuse si un pré-contrôle échoue, puis supprime objets (pierre
 * tombale, GH20), exécutions, acquittements d'impact, liens de tous les repos du workspace, arbres
 * d'affichage, et enfin les refs de liens et le nœud / type du schéma — en dernier, pour qu'un échec
 * en route laisse le type visible et la suppression relançable. Au-delà des pré-contrôles, au mieux
 * par fichier (échecs listés).
 */
export class SchemaDeleteService {
  constructor(
    private readonly git: GitService,
    private readonly objects: ObjectServices & { campaigns: Pick<CampaignsService, 'list' | 'delete'> },
    private readonly links: Pick<RequirementsIndexService, 'reloadLinks' | 'deleteLinks'>,
    private readonly tree: Pick<TreeService, 'deleteTypeTree'>,
    private readonly schema: Pick<SchemaService, 'get' | 'save'>,
    /** Index en mémoire à vider après les suppressions (exigences, tests). */
    private readonly indexes: Array<{ invalidate(repoPath: string): void }>,
    /** Repos du workspace, `repoPath` compris (`resolveWorkspaceRepoPaths`). */
    private readonly resolveRepos: (repoPath: string, workspaceDir?: string) => Promise<string[]>,
    /** Repos composants montés en lecture seule (`RevalidationService.readonlyRepoPaths`). */
    private readonly readonlyRepos: (workspaceDir?: string) => Promise<Set<string>>,
  ) {}

  async plan(repoPath: string, workspaceDir: string | undefined, target: SchemaDeleteTarget): Promise<SchemaDeletePlan> {
    return (await this.compute(repoPath, workspaceDir, target)).plan
  }

  async delete(repoPath: string, workspaceDir: string | undefined, target: SchemaDeleteTarget): Promise<SchemaDeleteResult> {
    const { plan, repos, schema, types, links, refsByRepo } = await this.compute(repoPath, workspaceDir, target)
    if (plan.errors.length > 0 || !schema) throw new Error(plan.errors.map(e => e.detail).join(' ; '))
    const result: SchemaDeleteResult = { deleted: [], links: 0, failed: [] }
    const step = async (id: string, fn: () => Promise<void>): Promise<boolean> => {
      try {
        await fn()
        return true
      } catch (err) {
        result.failed.push({ id, error: err instanceof Error ? err.message : String(err) })
        return false
      }
    }
    const invalidate = () => { for (const repo of repos) for (const index of this.indexes) index.invalidate(repo) }

    // 1. Objets, pierre tombale d'abord (GH20) ; 2. leurs exécutions / acquittements d'impact.
    const deleteObject = (dir: 'requirements' | 'tests', id: string) => step(id, async () => {
      await withKeyLock(`${repoPath}::${dir}/${id}`, () => deleteWithTombstone(this.git, repoPath, `${dir}/${id}.yaml`, id)
        .catch(err => { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err })) // déjà absent : supprimé
      result.deleted.push(id)
    })
    for (const id of plan.objects.requirement) {
      if (await deleteObject('requirements', id)) await step(`${repoPath}:impact-acks/${id}`, () => removeDir(repoPath, `impact-acks/${id}`))
    }
    for (const id of plan.objects.test) {
      if (await deleteObject('tests', id)) await step(`${repoPath}:test-runs/${id}`, () => removeDir(repoPath, `test-runs/${id}`))
    }
    for (const id of plan.objects.campaign) {
      await step(id, async () => {
        await this.objects.campaigns.delete(repoPath, id)
        result.deleted.push(id)
      })
    }

    // 3. Liens de chaque repo du workspace (relecture disque sous verrou, une écriture par repo),
    // sauf ceux d'un objet resté sur disque : ils le suivront à la relance.
    const kept = new Set(result.failed.map(f => f.id))
    for (const [repo, candidates] of links) {
      const ids = candidates.filter(l => !kept.has(l.sourceId) && !kept.has(l.targetId)).map(l => l.id)
      if (ids.length === 0) continue
      await step(`${repo}:links/links.yaml`, async () => {
        result.links += (await this.links.deleteLinks(repo, ids)).length
      })
    }

    // Un échec plus haut : arbres et schéma non touchés, le nœud / type et ce qui reste de ses
    // objets restent visibles, la suppression peut être relancée (elle ne reprend que le reste).
    if (result.failed.length > 0) {
      invalidate()
      return result
    }

    // 4. Arbres d'affichage.
    if (target.kind === 'node') {
      for (const node of plan.nodes) await step(`${repoPath}:.polenta/trees/${node}`, () => removeDir(repoPath, `.polenta/trees/${node}`))
    } else {
      for (const t of types) await this.tree.deleteTypeTree(repoPath, t.node, t.type)
    }

    // 5. Schéma du repo : nœud / type et refs de liens. 6. Refs de liens des autres repos — seulement
    // si le type a bien disparu de son repo (sinon leurs types de lien perdraient un type existant).
    const removed = refsByRepo.get(repoPath) ?? new Set<string>()
    const saved = await step(`${repoPath}:.polenta/schema.yaml`, () => this.schema.save(repoPath,
      mapLinkRefs(withoutTarget(schema, target), r => (removed.has(r) ? null : r))))
    if (saved) {
      for (const [repo, refs] of refsByRepo) {
        if (repo === repoPath) continue
        await step(`${repo}:.polenta/schema.yaml`, async () => {
          await this.schema.save(repo, mapLinkRefs(await this.schema.get(repo), r => (refs.has(r) ? null : r)))
        })
      }
    }
    // 7. Index en mémoire de chaque repo touché.
    invalidate()
    return result
  }

  private async compute(repoPath: string, workspaceDir: string | undefined, target: SchemaDeleteTarget): Promise<Computed> {
    const repos = dedupeRepos(repoPath, await this.resolveRepos(repoPath, workspaceDir))
    const plan: SchemaDeletePlan = {
      nodes: [], types: [], objects: { requirement: [], test: [], campaign: [] }, links: [], linkTypes: [], errors: [],
    }
    const computed: Computed = { plan, repos, schema: null, types: [], links: new Map(), refsByRepo: new Map() }

    for (const repo of repos) {
      if (!await pathExists(repo)) plan.errors.push({ code: 'REPO_MISSING', detail: `Repo du workspace introuvable : ${repo}` })
    }
    if (plan.errors.length > 0) return computed

    // Cible : composant local (tout nœud du schéma sauf `root`) ou type d'un nœud.
    const schema = await this.schema.get(repoPath)
    computed.schema = schema
    const entry = flattenSystemNodes(schema.nodes ?? []).find(({ node }) => node.name === target.nodeName)
    const notFound = (detail: string) => { plan.errors.push({ code: 'NOT_FOUND', detail }); return computed }
    if (!entry) return notFound(`Composant introuvable : ${target.nodeName}`)
    let types: DeletedType[]
    if (target.kind === 'node') {
      if (entry.node.name === 'root') return notFound(`${target.nodeName} n'est pas un composant local`)
      const subtree = flattenSystemNodes([entry.node]).map(({ node }) => node)
      plan.nodes = subtree.map(n => n.name)
      types = subtree.flatMap(n => (n.objectTypes ?? []).map(t => ({ ref: `${n.name}::${t.name}`, node: n.name, type: t.name, category: t.category })))
    } else {
      const t = (entry.node.objectTypes ?? []).find(o => o.name === target.typeName)
      if (!t) return notFound(`Type introuvable : ${target.nodeName}::${target.typeName}`)
      types = [{ ref: `${entry.node.name}::${t.name}`, node: entry.node.name, type: t.name, category: t.category }]
    }
    computed.types = types
    plan.types = types.map(t => t.ref)

    const readonlyRepos = await this.readonlyRepos(workspaceDir)
    const affected = [...entry.ancestors, ...(target.kind === 'node' ? flattenSystemNodes([entry.node]).map(f => f.node) : [entry.node])]
    const locked = affected.find(n => n.readonly)
    if (locked) {
      plan.errors.push({ code: 'READONLY', detail: `${locked.name} est en lecture seule` })
    } else if ([...readonlyRepos].some(r => repoKey(r) === repoKey(repoPath))) {
      plan.errors.push({ code: 'READONLY', detail: `Repo en lecture seule : ${repoPath}` })
    }
    if (plan.errors.length > 0) return computed

    // Objets du repo du schéma (IDs uniques sur le projet : préfixe unique, règle 10).
    for (const t of types) plan.objects[t.category].push(...await objectIdsOfType(this.objects, repoPath, t.category, t.ref))
    const deleted = new Set([...plan.objects.requirement, ...plan.objects.test, ...plan.objects.campaign])

    // Liens de tous les repos dont une extrémité est supprimée (état disque, pas le cache).
    if (deleted.size > 0) {
      const all = await Promise.all(repos.map(repo => this.links.reloadLinks(repo)))
      repos.forEach((repo, i) => {
        const hit = all[i].filter(l => deleted.has(l.sourceId) || deleted.has(l.targetId))
        if (hit.length === 0) return
        computed.links.set(repo, hit)
        plan.links.push({ repoPath: repo, count: hit.length })
      })
    }

    // Refs de liens : toujours dans le repo du schéma ; ailleurs, sauf si un autre repo déclare la
    // même ref (chaque repo a son `root` : `root::X` peut y désigner un autre type — GH100).
    const schemas = await Promise.all(repos.map(async repo => ({
      repo, schema: repo === repoPath ? schema : await this.schema.get(repo).catch(() => null),
    })))
    for (const { repo, schema: s } of schemas) {
      if (!s) continue
      const refs = new Set(plan.types.filter(ref => repo === repoPath
        || !schemas.some(o => o.repo !== repoPath && o.schema && declaresRef(o.schema, ref))))
      let touched = false
      for (const l of s.linkTypes ?? []) {
        const source = l.sourceRefs ?? []
        const targetRefs = l.targetRefs ?? []
        if (![...source, ...targetRefs].some(r => refs.has(r))) continue
        touched = true
        const emptied = (list: string[]) => list.length > 0 && list.every(r => refs.has(r))
        plan.linkTypes.push({ repoPath: repo, name: l.name, emptied: emptied(source) || emptied(targetRefs) })
      }
      if (touched || repo === repoPath) computed.refsByRepo.set(repo, refs)
    }
    return computed
  }
}

/** Schéma sans le nœud cible (et son sous-arbre) ou sans le type cible. */
function withoutTarget(schema: ProjectSchema, target: SchemaDeleteTarget): ProjectSchema {
  if (target.kind === 'node') return { ...schema, nodes: removeSystemNode(schema.nodes, target.nodeName) }
  return {
    ...schema,
    nodes: mapSystemNode(schema.nodes, target.nodeName, n => ({ ...n, objectTypes: (n.objectTypes ?? []).filter(t => t.name !== target.typeName) })),
  }
}

async function removeDir(repoPath: string, rel: string): Promise<void> {
  await fsP.rm(path.join(repoPath, rel), { recursive: true, force: true })
}
