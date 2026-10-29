import type {
  Change, ChangeImpacted, ChangeSummary, ChangeToModify, CreateChangeDto, ObjectTypeDefinition, ProjectSchema,
  ReopenedCandidate, UpdateChangeDto,
} from '@polenta/types'
import { CHANGE_IMPACT_STATUSES, flattenSystemNodes, initialStatus, isApprovalStatus, isUnknownStatus, uniqueById } from '@polenta/types'
import type { GitService } from './git.service'
import type { HistoryService } from './history.service'
import type { RequirementsService } from './requirements.service'
import type { SchemaService } from './schema.service'
import type { TestsService } from './tests.service'
import type { WorkspaceTreeService } from './workspace-tree.service'
import { applyFieldsWrite } from './field-write.util'
import { assertNewObjectFile, deleteWithTombstone, nextCounterId } from './id-counter.util'
import { findObjectTypeDef } from './schema-lookup.util'
import { withKeyLock } from './serialize-writes.util'
import { resolveWorkspaceRepoPaths } from './workspace-repos.util'

const DIR = 'changes'

/**
 * GH198 — objet change (specs/GH198.md) : `changes/<ID>.yaml` dans le repo du composant concerné.
 * Création (demande de changement), lecture, mise à jour (titre, statut, champs, listes, composant
 * au statut initial), suppression tant que jamais commité, candidats « repassés en brouillon ».
 * Écriture unique par `persist` : contrôles #195 et historique GH77, comme les autres objets.
 */
export class ChangesService {
  constructor(
    private readonly git: GitService,
    private readonly schema: Pick<SchemaService, 'get' | 'resolveComponentRepoPath'>,
    private readonly requirements: Pick<RequirementsService, 'findAll'>,
    private readonly tests: Pick<TestsService, 'findAll'>,
    private readonly workspaceTree?: WorkspaceTreeService,
    private readonly history?: HistoryService,
  ) {}

  /** Changes stockés dans un repo. */
  async listRepo(repoPath: string): Promise<Change[]> {
    const files = (await this.git.listFiles(repoPath, DIR)).filter(f => f.endsWith('.yaml'))
    const out: Change[] = []
    for (const file of files) {
      const change = await this.git.readYaml<Change>(repoPath, file)
      if (change?.id) out.push(normalize(change))
    }
    return out
  }

  /** Changes de tous les repos du workspace (panneau Changements), ID décroissant par repo. */
  async list(repoPath: string, workspaceDir?: string): Promise<ChangeSummary[]> {
    const repos = await resolveWorkspaceRepoPaths(this.workspaceTree, repoPath, workspaceDir)
    const out: ChangeSummary[] = []
    for (const repo of repos) {
      for (const c of await this.listRepo(repo)) {
        out.push({
          id: c.id, repoPath: repo, objectTypeRef: c.objectTypeRef, title: c.title, status: c.status,
          component: c.component, toModifyCount: c.toModify.length, impactedCount: c.impacted.length,
          createdBy: c.history?.status?.[0]?.by ?? null,
        })
      }
    }
    return out.sort((a, b) => (a.repoPath === b.repoPath ? b.id.localeCompare(a.id, undefined, { numeric: true }) : 0))
  }

  async get(repoPath: string, id: string): Promise<Change> {
    const change = await this.git.readYaml<Change>(repoPath, `${DIR}/${id}.yaml`)
    if (!change) throw new Error(`Change introuvable : ${id}`)
    const audit = await this.git.fileHistory(repoPath, `${DIR}/${id}.yaml`).catch(() => null)
    return { ...normalize(change), createdAt: audit?.createdAt ?? null, createdBy: audit?.createdBy ?? null, updatedAt: audit?.updatedAt ?? null, updatedBy: audit?.updatedBy ?? null }
  }

  async create(repoPath: string, dto: CreateChangeDto, workspaceDir?: string): Promise<Change & { repoPath: string }> {
    const schema = await this.schema.get(repoPath)
    const typeDef = this.changeType(schema, dto.objectTypeRef)
    const component = this.resolveComponent(schema, dto.component)
    const targetRepo = await this.componentRepo(repoPath, schema, component, dto.objectTypeRef, workspaceDir)
    const id = await nextCounterId(this.git, targetRepo, typeDef.prefix || 'CHG', DIR)
    await assertNewObjectFile(this.git, targetRepo, `${DIR}/${id}.yaml`, id)
    const change: Change = {
      id, projectId: '', branchId: '', objectTypeRef: dto.objectTypeRef, title: dto.title.trim(),
      status: initialStatus(typeDef), version: 1, fields: dto.fields ?? {},
      component, mode: 'request',
      toModify: cleanToModify(dto.toModify ?? []), impacted: cleanImpacted(dto.impacted ?? []),
      origin: { runs: [], decisions: [] }, integratedIn: null, campaigns: [],
    }
    if (!change.title) throw new Error('Titre obligatoire')
    return { ...(await this.persist(repoPath, targetRepo, null, change)), repoPath: targetRepo }
  }

  /** `repoPath` : repo où le change est stocké (`ChangeSummary.repoPath`). */
  async update(repoPath: string, id: string, dto: UpdateChangeDto): Promise<Change> {
    return withKeyLock(`${repoPath}::${DIR}/${id}`, async () => {
      const existing = await this.get(repoPath, id)
      const schema = await this.schema.get(repoPath)
      const typeDef = this.changeType(schema, existing.objectTypeRef)
      if (dto.status !== undefined && isUnknownStatus(typeDef, dto.status)) {
        throw new Error(`Statut inconnu pour ${existing.objectTypeRef} : "${dto.status}"`)
      }
      let component = existing.component
      if (dto.component !== undefined && dto.component !== existing.component) {
        // Le composant désigne le repo de stockage : il n'est plus modifiable après le statut initial.
        if (existing.status !== initialStatus(typeDef)) throw new Error('Le composant ne se modifie plus après le statut initial')
        component = this.resolveComponent(schema, dto.component)
      }
      if (dto.title !== undefined && !dto.title.trim()) throw new Error('Titre obligatoire')
      return this.persist(repoPath, repoPath, existing, {
        ...existing,
        ...(dto.title !== undefined && { title: dto.title.trim() }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.fields !== undefined && { fields: { ...existing.fields, ...dto.fields } }),
        component,
        ...(dto.toModify !== undefined && { toModify: cleanToModify(dto.toModify) }),
        ...(dto.impacted !== undefined && { impacted: cleanImpacted(dto.impacted) }),
      })
    })
  }

  /** Q6 — suppression seulement tant que le fichier n'a jamais été commité (sinon : statut terminal). */
  async delete(repoPath: string, id: string): Promise<void> {
    const rel = `${DIR}/${id}.yaml`
    if (!(await this.git.fileExists(repoPath, rel))) throw new Error(`Change introuvable : ${id}`)
    if (await this.git.fileHistory(repoPath, rel).catch(() => null)) {
      throw new Error(`${id} a déjà été commité : il ne peut plus être supprimé, passez-le dans un statut terminal`)
    }
    await deleteWithTombstone(this.git, repoPath, rel, id)
  }

  /**
   * Éléments du repo déjà approuvés une fois (statut d'approbation dans l'historique GH77, repli
   * `version > 1`) et qui ne sont plus dans un statut d'approbation, hors « à modifier ».
   */
  async reopenedCandidates(repoPath: string, id: string): Promise<ReopenedCandidate[]> {
    const change = await this.get(repoPath, id)
    const listed = new Set(change.toModify.map(t => t.id))
    const schema = await this.schema.get(repoPath)
    const out: ReopenedCandidate[] = []
    const consider = (category: ReopenedCandidate['category'], o: { id: string; title: string; status: string; objectTypeRef: string; version?: number; history?: Change['history'] }) => {
      if (listed.has(o.id)) return
      const resolved = findObjectTypeDef(schema, o.objectTypeRef, category)
      const typeDef = resolved && resolved !== 'unresolvable' ? resolved : null
      if (isApprovalStatus(typeDef, o.status)) return
      const wasApproved = (o.history?.status ?? []).some(e => typeof e.value === 'string' && isApprovalStatus(typeDef, e.value)) || (o.version ?? 1) > 1
      if (wasApproved) out.push({ id: o.id, title: o.title, category, status: o.status })
    }
    for (const r of await this.requirements.findAll(repoPath, {})) consider('requirement', r)
    for (const t of await this.tests.findAll(repoPath)) consider('test', t)
    return out.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
  }

  private changeType(schema: ProjectSchema | null, ref: string): ObjectTypeDefinition {
    const resolved = schema ? findObjectTypeDef(schema, ref, 'change') : null
    if (!resolved || resolved === 'unresolvable') throw new Error(`Type de change introuvable : "${ref}"`)
    return resolved
  }

  /** Composant concerné : donné (nœud existant), sinon déduit si le repo ne porte qu'un composant local. */
  private resolveComponent(schema: ProjectSchema | null, component: string | undefined): string {
    const nodes = flattenSystemNodes(schema?.nodes ?? []).map(({ node }) => node)
    if (component) {
      if (!nodes.some(n => n.name === component)) throw new Error(`Composant inconnu : "${component}"`)
      return component
    }
    // Composant local : nœud qui déclare ses types (un nœud de composant externe n'en déclare pas).
    const local = nodes.filter(n => n.objectTypes !== undefined)
    if (local.length === 1) return local[0].name
    throw new Error('Composant concerné obligatoire : ce repo porte plusieurs composants')
  }

  /** Repo de stockage : celui du composant (nœud externe, sans `objectTypes`), sinon le repo ouvert. */
  private async componentRepo(repoPath: string, schema: ProjectSchema | null, component: string, ref: string, workspaceDir?: string): Promise<string> {
    const node = flattenSystemNodes(schema?.nodes ?? []).map(({ node: n }) => n).find(n => n.name === component)
    if (!node || node.objectTypes !== undefined) return repoPath
    const typeName = ref.split('::').pop() ?? ref
    return (await this.schema.resolveComponentRepoPath(repoPath, `${component}::${typeName}`, workspaceDir)) ?? repoPath
  }

  /** Seule écriture d'un change : contrôles #195 (champs), historique GH77, fichier sans champs d'audit. */
  private async persist(repoPath: string, targetRepo: string, before: Change | null, after: Change): Promise<Change> {
    const checked = await applyFieldsWrite(this.git, repoPath, before, after, targetRepo)
    const stamped = this.history
      ? await this.history.stamp(repoPath, checked.objectTypeRef, before, checked, { filePath: `${DIR}/${checked.id}.yaml` }, targetRepo)
      : checked
    const { createdAt: _a, createdBy: _b, updatedAt: _c, updatedBy: _d, ...toWrite } = stamped
    await this.git.writeYaml(targetRepo, `${DIR}/${stamped.id}.yaml`, toWrite)
    return stamped
  }
}

/** Valeurs par défaut des champs système (fichier édité à la main, ancienne version). */
function normalize(c: Change): Change {
  return {
    ...c,
    fields: c.fields ?? {},
    mode: c.mode ?? 'request',
    toModify: c.toModify ?? [],
    impacted: c.impacted ?? [],
    origin: { runs: c.origin?.runs ?? [], decisions: c.origin?.decisions ?? [] },
    integratedIn: c.integratedIn ?? null,
    campaigns: c.campaigns ?? [],
  }
}

function cleanToModify(items: ChangeToModify[]): ChangeToModify[] {
  return uniqueById(items.filter(i => i?.id).map(i => ({ id: i.id, state: i.state === 'modified' ? 'modified' : 'planned' })))
}

function cleanImpacted(items: ChangeImpacted[]): ChangeImpacted[] {
  return uniqueById(items.filter(i => i?.id).map(i => ({
    id: i.id,
    status: CHANGE_IMPACT_STATUSES.includes(i.status) ? i.status : 'impact_non_verifie',
    ...(i.comment && { comment: i.comment }),
    source: i.source === 'computed' ? 'computed' : 'declared',
  })))
}
