import type {
  Change, ChangeImpacted, ChangeSummary, ChangeToModify, CreateChangeDto, ObjectTypeDefinition, ProjectSchema,
  UpdateChangeDto,
} from '@polenta/types'
import { CHANGE_IMPACT_STATUSES, flattenSystemNodes, initialStatus, isUnknownStatus, uniqueById } from '@polenta/types'
import type { GitService } from './git.service'
import type { HistoryService } from './history.service'
import type { SchemaService } from './schema.service'
import type { WorkspaceTreeService } from './workspace-tree.service'
import { applyFieldsWrite } from './field-write.util'
import { assertNewObjectFile, deleteWithTombstone, nextCounterId } from './id-counter.util'
import { findObjectTypeDef } from './schema-lookup.util'
import { withKeyLock } from './serialize-writes.util'
import { resolveWorkspaceRepoPaths } from './workspace-repos.util'

const DIR = 'changes'

/**
 * GH198 — objet change (specs/GH198.md) : `changes/<ID>.yaml` dans le repo du composant concerné
 * (`repoPath` = repo de stockage, dont le schéma porte le type et le composant local, #193 §4).
 * Création (demande de changement), lecture, mise à jour (titre, statut, champs, listes, composant
 * au statut initial), suppression tant que jamais commité.
 * Écriture unique par `persist` : contrôles #195 et historique GH77, comme les autres objets.
 */
export class ChangesService {
  constructor(
    private readonly git: GitService,
    private readonly schema: Pick<SchemaService, 'get'>,
    private readonly workspaceTree?: WorkspaceTreeService,
    private readonly history?: HistoryService,
  ) {}

  /** Changes stockés dans un repo. */
  async listRepo(repoPath: string): Promise<Change[]> {
    const files = (await this.git.listFiles(repoPath, DIR)).filter(f => f.endsWith('.yaml'))
    const changes = await Promise.all(files.map(file => this.git.readYaml<Change>(repoPath, file)))
    return changes.filter((c): c is Change => !!c?.id).map(normalize)
  }

  /** Changes de tous les repos du workspace (panneau Changements), ID décroissant par repo. */
  async list(repoPath: string, workspaceDir?: string): Promise<ChangeSummary[]> {
    const repos = await resolveWorkspaceRepoPaths(this.workspaceTree, repoPath, workspaceDir)
    const perRepo = await Promise.all(repos.map(async repo => (await this.listRepo(repo))
      .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))
      .map((c): ChangeSummary => ({
        id: c.id, repoPath: repo, objectTypeRef: c.objectTypeRef, title: c.title, status: c.status,
        component: c.component, toModifyCount: c.toModify.length, impactedCount: c.impacted.length,
        createdBy: c.history?.status?.[0]?.by ?? null,
      }))))
    return perRepo.flat()
  }

  async get(repoPath: string, id: string): Promise<Change> {
    const change = await this.git.readYaml<Change>(repoPath, `${DIR}/${id}.yaml`)
    if (!change) throw new Error(`Change introuvable : ${id}`)
    const audit = await this.git.fileHistory(repoPath, `${DIR}/${id}.yaml`).catch(() => null)
    return { ...normalize(change), createdAt: audit?.createdAt ?? null, createdBy: audit?.createdBy ?? null, updatedAt: audit?.updatedAt ?? null, updatedBy: audit?.updatedBy ?? null }
  }

  async create(repoPath: string, dto: CreateChangeDto, _workspaceDir?: string): Promise<Change & { repoPath: string }> {
    const title = typeof dto.title === 'string' ? dto.title.trim() : ''
    // Contrôles avant d'émettre l'ID : un refus ne consomme pas de numéro.
    if (!title) throw new Error('Titre obligatoire')
    const schema = await this.schema.get(repoPath)
    const typeDef = this.changeType(schema, dto.objectTypeRef)
    const component = this.resolveComponent(schema, dto.component)
    const id = await nextCounterId(this.git, repoPath, typeDef.prefix || 'CHG', DIR)
    await assertNewObjectFile(this.git, repoPath, `${DIR}/${id}.yaml`, id)
    const change: Change = {
      id, projectId: '', branchId: '', objectTypeRef: dto.objectTypeRef, title,
      status: initialStatus(typeDef), version: 1, fields: dto.fields ?? {},
      component, mode: 'request',
      toModify: cleanToModify(dto.toModify ?? []), impacted: cleanImpacted(dto.impacted ?? []),
      origin: { runs: [], decisions: [] }, integratedIn: null, campaigns: [],
    }
    return { ...(await this.persist(repoPath, null, change)), repoPath }
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
      return this.persist(repoPath, existing, {
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
    // Même verrou que `update` : une écriture en vol ne recrée pas le fichier après la pierre tombale.
    return withKeyLock(`${repoPath}::${DIR}/${id}`, async () => {
      if (!(await this.git.fileExists(repoPath, rel))) throw new Error(`Change introuvable : ${id}`)
      if (await this.git.fileHistory(repoPath, rel).catch(() => null)) {
        throw new Error(`${id} a déjà été commité : il ne peut plus être supprimé, passez-le dans un statut terminal`)
      }
      await deleteWithTombstone(this.git, repoPath, rel, id)
    })
  }

  private changeType(schema: ProjectSchema | null, ref: string): ObjectTypeDefinition {
    const resolved = schema ? findObjectTypeDef(schema, ref, 'change') : null
    if (!resolved || resolved === 'unresolvable') throw new Error(`Type de change introuvable : "${ref}"`)
    return resolved
  }

  /**
   * Composant concerné : un composant local du repo (nœud qui déclare ses types ; un nœud de
   * composant externe n'en déclare pas), donné ou déduit s'il est seul.
   */
  private resolveComponent(schema: ProjectSchema | null, component: string | undefined): string {
    const local = flattenSystemNodes(schema?.nodes ?? []).map(({ node }) => node).filter(n => n.objectTypes !== undefined)
    if (component) {
      if (!local.some(n => n.name === component)) throw new Error(`Composant inconnu : "${component}"`)
      return component
    }
    if (local.length === 1) return local[0].name
    throw new Error('Composant concerné obligatoire : ce repo porte plusieurs composants')
  }

  /** Seule écriture d'un change : contrôles #195 (champs), historique GH77, fichier sans champs d'audit. */
  private async persist(repoPath: string, before: Change | null, after: Change): Promise<Change> {
    const checked = await applyFieldsWrite(this.git, repoPath, before, after)
    const stamped = this.history
      ? await this.history.stamp(repoPath, checked.objectTypeRef, before, checked, { filePath: `${DIR}/${checked.id}.yaml` })
      : checked
    const { createdAt: _a, createdBy: _b, updatedAt: _c, updatedBy: _d, ...toWrite } = stamped
    await this.git.writeYaml(repoPath, `${DIR}/${stamped.id}.yaml`, toWrite)
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
