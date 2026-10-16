import * as fsP from 'fs/promises'
import * as path from 'path'
import { emptyFieldRenameResult, flattenSystemNodes } from '@polenta/types'
import type { ProjectSchema, TypeRenameDto, TypeRenamePlan, TypeRenameResult } from '@polenta/types'
import type { CampaignsService } from './campaigns.service'
import { TOMBSTONES_DIR } from './id-counter.util'
import type { RequirementsService } from './requirements.service'
import type { SchemaService } from './schema.service'
import type { TestsService } from './tests.service'
import type { TreeService } from './tree.service'
import { idRenamer, isBinary, listDataFiles, pruneEmptyDirs, renamePath } from './type-rename.util'

interface PlannedWrite { repoPath: string; path: string; newPath: string; content: string }

interface Computed {
  plan: TypeRenamePlan
  repos: string[]
  oldRef: string
  newRef: string
  writes: PlannedWrite[]
}

/**
 * GH100 — renommage d'un type d'objet dans l'éditeur de schéma (specs/GH100-design.md §2.2).
 * Appelé après l'enregistrement du schéma (comme GH77/GH82), sauf `plan` (aperçu sans écriture,
 * appelé avant). Préfixe changé : les objets `OLD-n` deviennent `NEW-n`, l'ID est réécrit dans les
 * dossiers de données de tous les repos du workspace, l'ancien ID reçoit sa pierre tombale. Nom
 * changé : `objectTypeRef` des objets et des copies `testSnapshot`, fichier d'ordre, refs `linkTypes`.
 * Pré-contrôles tout ou rien ; au-delà, au mieux par fichier (échecs listés).
 */
export class TypeRenameService {
  constructor(
    private readonly requirements: RequirementsService,
    private readonly tests: TestsService,
    private readonly campaigns: CampaignsService,
    private readonly tree: TreeService,
    private readonly schema: Pick<SchemaService, 'get' | 'save'>,
    /** Index en mémoire à vider après les écritures brutes (exigences, tests). */
    private readonly indexes: Array<{ invalidate(repoPath: string): void }>,
    /** Repos du workspace, `repoPath` compris (`resolveWorkspaceRepoPaths`). */
    private readonly resolveRepos: (repoPath: string, workspaceDir?: string) => Promise<string[]>,
  ) {}

  async plan(repoPath: string, workspaceDir: string | undefined, dto: TypeRenameDto): Promise<TypeRenamePlan> {
    return (await this.compute(repoPath, workspaceDir, dto)).plan
  }

  async rename(repoPath: string, workspaceDir: string | undefined, dto: TypeRenameDto): Promise<TypeRenameResult> {
    const { plan, repos, oldRef, newRef, writes } = await this.compute(repoPath, workspaceDir, dto)
    if (plan.errors.length > 0) throw new Error(plan.errors.map(e => e.detail).join(' ; '))
    const result: TypeRenameResult = { ...emptyFieldRenameResult(), files: 0 }
    const migrate = (id: string) => { if (!result.migrated.includes(id)) result.migrated.push(id) }

    // 1. Préfixe : contenus et chemins réécrits, nouveau chemin d'abord, ancien ensuite.
    const objectIds = new Map(plan.objects.map(o => [o.oldId, o.newId]))
    for (const w of writes) {
      try {
        const target = path.join(w.repoPath, w.newPath)
        if (w.newPath !== w.path && await exists(target)) throw new Error(`${w.newPath} existe déjà`)
        await fsP.mkdir(path.dirname(target), { recursive: true })
        await fsP.writeFile(target, w.content, 'utf-8')
        if (w.newPath !== w.path) {
          await fsP.unlink(path.join(w.repoPath, w.path))
          await pruneEmptyDirs(w.repoPath, w.path)
        }
        const objectId = objectFileId(w, repoPath)
        if (objectId && objectIds.has(objectId)) migrate(objectIds.get(objectId)!)
        else result.files++
      } catch (err) {
        result.failed.push({ id: `${w.repoPath}:${w.path}`, error: err instanceof Error ? err.message : String(err) })
      }
    }
    // GH20 — l'ancien ID est retiré : jamais réémis, même si le préfixe est un jour redéclaré.
    for (const { oldId } of plan.objects) {
      try {
        await fsP.mkdir(path.join(repoPath, TOMBSTONES_DIR), { recursive: true })
        await fsP.writeFile(path.join(repoPath, TOMBSTONES_DIR, oldId), '')
      } catch (err) {
        result.failed.push({ id: oldId, error: err instanceof Error ? err.message : String(err) })
      }
    }
    this.invalidate(repos)

    // 2. Nom : objets du type, copies de campagne de ses tests, arbre, refs de liens.
    if (oldRef !== newRef) {
      const retarget = <T extends { objectTypeRef?: string }>(o: T): T => ({ ...o, objectTypeRef: newRef })
      const step = (fn: () => Promise<void>) => fn().catch(err => {
        result.failed.push({ id: oldRef, error: err instanceof Error ? err.message : String(err) })
      })
      // Compte rendu séparé : un objet déjà compté par le changement de préfixe ne l'est pas deux fois.
      const retargeted = emptyFieldRenameResult()
      if (dto.category === 'requirement') await step(() => this.requirements.rewriteObjects(repoPath, oldRef, retarget, retargeted))
      if (dto.category === 'test') await step(() => this.tests.rewriteObjects(repoPath, oldRef, retarget, retargeted))
      if (dto.category === 'campaign') await step(() => this.campaigns.rewriteObjects(repoPath, oldRef, retarget, retargeted))
      retargeted.migrated.forEach(migrate)
      result.skipped.push(...retargeted.skipped)
      result.failed.push(...retargeted.failed)
      if (dto.category === 'test') {
        // Seulement les copies des tests de CE type (un autre repo peut avoir un `root::<même nom>`).
        const ids = new Set((await this.tests.findAll(repoPath)).filter(t => t.objectTypeRef === newRef).map(t => t.id))
        for (const repo of repos) {
          const snapshots = { ...emptyFieldRenameResult() }
          await step(() => this.campaigns.rewriteSnapshots(repo, oldRef, retarget, snapshots, ids))
          result.snapshots = (result.snapshots ?? 0) + (snapshots.snapshots ?? 0)
          result.failed.push(...snapshots.failed)
        }
      }
      await this.tree.renameTypeTree(repoPath, dto.nodeName, dto.oldName, dto.newName)
      for (const repo of plan.linkTypeRepos) {
        await step(async () => {
          const schema = await this.schema.get(repo)
          await this.schema.save(repo, retargetLinkRefs(schema, oldRef, newRef))
        })
      }
      this.invalidate(repos)
    }
    return result
  }

  private async compute(repoPath: string, workspaceDir: string | undefined, dto: TypeRenameDto): Promise<Computed> {
    const repos = sameRepoDeduped(repoPath, await this.resolveRepos(repoPath, workspaceDir))
    const oldRef = `${dto.nodeName}::${dto.oldName}`
    const newRef = `${dto.nodeName}::${dto.newName}`
    const plan: TypeRenamePlan = { objects: [], retargeted: 0, files: [], linkTypeRepos: [], errors: [] }
    const writes: PlannedWrite[] = []

    for (const repo of repos) {
      if (!await exists(repo)) plan.errors.push({ code: 'REPO_MISSING', detail: `Repo du workspace introuvable : ${repo}` })
    }
    if (plan.errors.length > 0) return { plan, repos, oldRef, newRef, writes }

    const ids = await this.objectIds(repoPath, dto.category, oldRef)
    if (oldRef !== newRef) plan.retargeted = ids.length

    // Préfixe : campagnes exclues (`CAMP-NNNN` quel que soit le type, campaigns.service.ts).
    if (dto.oldPrefix !== dto.newPrefix && dto.category !== 'campaign' && dto.oldPrefix && dto.newPrefix) {
      const head = `${dto.oldPrefix}-`
      plan.objects = ids
        .filter(id => id.startsWith(head) && /^\d+$/.test(id.slice(head.length)))
        .map(oldId => ({ oldId, newId: `${dto.newPrefix}-${oldId.slice(head.length)}` }))
      for (const { newId } of plan.objects) {
        for (const repo of repos) {
          for (const rel of [`requirements/${newId}.yaml`, `tests/${newId}.yaml`, `${TOMBSTONES_DIR}/${newId}`]) {
            if (await exists(path.join(repo, rel))) {
              plan.errors.push({ code: 'ID_COLLISION', detail: `${newId} existe déjà (${path.join(repo, rel)})` })
            }
          }
        }
      }
      if (plan.objects.length > 0 && plan.errors.length === 0) {
        const rename = idRenamer(dto.oldPrefix, new Map(plan.objects.map(o => [o.oldId, o.newId])))
        for (const repo of repos) {
          for (const rel of await listDataFiles(repo)) {
            const bytes = await fsP.readFile(path.join(repo, rel))
            const newPath = renamePath(rel, rename)
            const text = isBinary(bytes) ? null : bytes.toString('utf-8')
            const content = text === null ? null : rename(text)
            if (newPath === rel && (content === null || content === text)) continue
            if (content === null) continue // binaire renommé : hors périmètre (aucun dans les dossiers de données)
            const w = { repoPath: repo, path: rel, newPath, content }
            writes.push(w)
            if (!objectFileId(w, repoPath)) plan.files.push({ repoPath: repo, path: rel, ...(newPath !== rel && { newPath }) })
          }
        }
      }
    }

    if (oldRef !== newRef) {
      const schemas = await Promise.all(repos.map(async repo => ({ repo, schema: await this.schema.get(repo).catch(() => null) })))
      // La ref appartient à un autre repo s'il déclare lui aussi `<nœud>::<ancien nom>`.
      const declaredElsewhere = schemas.some(({ repo, schema }) => repo !== repoPath && schema && declares(schema, oldRef))
      for (const { repo, schema } of schemas) {
        if (!schema || (declaredElsewhere && repo !== repoPath)) continue
        if ((schema.linkTypes ?? []).some(l => [...(l.sourceRefs ?? []), ...(l.targetRefs ?? [])].includes(oldRef))) {
          plan.linkTypeRepos.push(repo)
        }
      }
    }
    return { plan, repos, oldRef, newRef, writes }
  }

  private async objectIds(repoPath: string, category: TypeRenameDto['category'], ref: string): Promise<string[]> {
    if (category === 'requirement') return (await this.requirements.findAll(repoPath, { type: ref })).map(o => o.id)
    if (category === 'test') return (await this.tests.findAll(repoPath)).filter(o => o.objectTypeRef === ref).map(o => o.id)
    return (await this.campaigns.list(repoPath)).filter(o => o.objectTypeRef === ref).map(o => o.id)
  }

  private invalidate(repos: string[]): void {
    for (const repo of repos) for (const index of this.indexes) index.invalidate(repo)
  }
}

/** ID de l'objet si `w` est le fichier d'un objet (exigence / test) du repo du type. */
function objectFileId(w: { repoPath: string; path: string }, repoPath: string): string | null {
  if (w.repoPath !== repoPath) return null
  const m = /^(?:requirements|tests)\/([^/]+)\.yaml$/.exec(w.path)
  return m ? m[1] : null
}

function declares(schema: ProjectSchema, ref: string): boolean {
  const [node, type] = ref.split('::')
  return flattenSystemNodes(schema.nodes ?? []).some(({ node: n }) => n.name === node && (n.objectTypes ?? []).some(t => t.name === type))
}

function retargetLinkRefs(schema: ProjectSchema, oldRef: string, newRef: string): ProjectSchema {
  const map = (refs?: string[]) => refs?.map(r => (r === oldRef ? newRef : r))
  return {
    ...schema,
    linkTypes: (schema.linkTypes ?? []).map(l => ({
      ...l,
      ...(l.sourceRefs && { sourceRefs: map(l.sourceRefs) }),
      ...(l.targetRefs && { targetRefs: map(l.targetRefs) }),
    })),
  }
}

/**
 * Repos sans doublon : le chemin reçu du renderer et celui du cache du workspace (normalisé,
 * `tree-cache.util.ts`) peuvent différer par la casse ou les séparateurs — le même repo serait
 * réécrit deux fois. `repoPath` (repo du type) garde sa forme : c'est elle que comparent les étapes.
 */
function sameRepoDeduped(repoPath: string, repos: string[]): string[] {
  const key = (p: string) => {
    const abs = path.resolve(p)
    return process.platform === 'win32' ? abs.toLowerCase() : abs
  }
  const seen = new Set<string>([key(repoPath)])
  const out = [repoPath]
  for (const repo of repos) {
    if (seen.has(key(repo))) continue
    seen.add(key(repo))
    out.push(repo)
  }
  return out
}

async function exists(p: string): Promise<boolean> {
  return fsP.access(p).then(() => true, () => false)
}
