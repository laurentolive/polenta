import { randomUUID } from 'crypto'
import { initialStatus, isUnknownStatus, renameFieldKeys } from '@polenta/types'
import type { FieldRename, FieldRenameResult, ObjectHistory, ObjectTypeDefinition, ProjectSchema, Requirement } from '@polenta/types'
import type { CreateRequirementDto, UpdateRequirementDto, TransitionRequirementDto } from '@polenta/zod-schemas'
import type { GitService } from './git.service'
import type { RequirementsIndexService, RequirementFilters } from './requirements-index.service'
import type { SchemaService } from './schema.service'
import type { TreeService } from './tree.service'
import { RevalidationService } from './revalidation.service'
import { omitAuditFields } from './audit-fields.util'
import { findObjectTypeDef, resolveObjectTypeLocation } from './schema-lookup.util'
import { nextCounterId } from './id-counter.util'
import { withKeyLock } from './serialize-writes.util'
import type { HistoryService } from './history.service'

export class RequirementsService {
  constructor(
    private readonly git: GitService,
    private readonly index: RequirementsIndexService,
    private readonly schema: SchemaService,
    private readonly tree?: TreeService,
    private readonly revalidation?: RevalidationService,
    private readonly history?: HistoryService,
  ) {}

  findAll(repoPath: string, filters: RequirementFilters): Promise<Requirement[]> {
    return this.index.findAll(repoPath, filters)
  }

  async findOne(repoPath: string, id: string): Promise<Requirement> {
    const req = await this.index.findById(repoPath, id)
    if (!req) throw new Error(`Requirement ${id} not found`)
    return req
  }

  findVersions(repoPath: string, id: string) {
    return this.index.findVersions(repoPath, id)
  }

  findLinks(repoPath: string, id: string) {
    return this.index.findLinks(repoPath, id)
  }

  findAllLinks(repoPath: string) {
    return this.index.findAllLinks(repoPath)
  }

  createLink(repoPath: string, data: { type: string; sourceId: string; targetId: string }) {
    return this.index.createLink(repoPath, data)
  }

  deleteLink(repoPath: string, linkId: string) {
    return this.index.deleteLink(repoPath, linkId)
  }

  reloadLinks(repoPath: string) {
    return this.index.reloadLinks(repoPath)
  }

  createLinks(repoPath: string, data: Array<{ type: string; sourceId: string; targetId: string }>, createdBy: string) {
    return this.index.createLinks(repoPath, data, createdBy)
  }

  deleteLinks(repoPath: string, ids: string[]) {
    return this.index.deleteLinks(repoPath, ids)
  }

  async create(repoPath: string, dto: CreateRequirementDto, workspaceDir?: string): Promise<Requirement> {
    // GH149 — statut initial lu dans le schéma (premier statut du type), pas `draft` en dur.
    const typeDef = await this.readTypeDef(repoPath, dto.objectTypeRef)
    if (dto.status && isUnknownStatus(typeDef, dto.status)) {
      throw new Error(`Statut inconnu pour le type ${dto.objectTypeRef} : "${dto.status}"`)
    }
    const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, dto.objectTypeRef, workspaceDir)) ?? repoPath
    const reqId = await this.nextId(repoPath, targetRepo, dto.objectTypeRef)

    // Belt-and-suspenders: nextId() already reconciles the counter against files on
    // disk, so this should never trigger in practice — but writeYaml() overwrites
    // silently with no uniqueness check of its own, so a stale/racing counter must
    // never be allowed to clobber an existing object's file.
    if (await this.git.fileExists(targetRepo, `requirements/${reqId}.yaml`)) {
      throw new Error(`Requirement ${reqId} already exists`)
    }

    const req: Requirement = {
      id: reqId,
      projectId: '',
      branchId: '',
      objectTypeRef: dto.objectTypeRef,
      title: dto.title,
      status: dto.status ?? initialStatus(typeDef),
      version: 1,
      fields: dto.fields ?? {},
      jiraLinks: [],
      // Fichier neuf, aucun commit ne le touche encore — pas d'appel git.fileHistory()
      // ici, il renverrait `null` de toute façon (T112).
      createdAt: null,
      createdBy: null,
      updatedAt: null,
      updatedBy: null,
    }

    const created = await this.persist(repoPath, targetRepo, null, req)
    await this.appendToTree(targetRepo, dto.objectTypeRef, created.id, created.title)
    return created
  }

  // T159 — `withKeyLock` sérialise les read-modify-write concurrents sur le même fichier
  // (`findById` → merge → `writeYaml`) : sans ça un autosave et une transition de statut
  // simultanés sur la même exigence pouvaient se marcher dessus (un champ perdu).
  async update(repoPath: string, id: string, dto: UpdateRequirementDto, workspaceDir?: string): Promise<Requirement> {
    return withKeyLock(`${repoPath}::requirements/${id}`, async () => {
      const existing = await this.index.findById(repoPath, id)
      if (!existing) throw new Error(`Requirement ${id} not found`)

      const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, existing.objectTypeRef, workspaceDir)) ?? repoPath
      // createdAt/createdBy/updatedAt/updatedBy viennent de `...existing` (dérivés du
      // dernier commit par l'index) — cette édition n'étant pas commitée, ils ne changent
      // pas ici (T112).
      return this.persist(repoPath, targetRepo, existing, {
        ...existing,
        ...(dto.title && { title: dto.title }),
        fields: { ...(existing.fields as object), ...(dto.fields ?? {}) },
      })
    })
  }

  async openDraft(repoPath: string, id: string, targetStatus: string, workspaceDir?: string): Promise<Requirement> {
    const { updated, leftApproval } = await withKeyLock(`${repoPath}::requirements/${id}`, async () => {
      const existing = await this.index.findById(repoPath, id)
      if (!existing) throw new Error(`Requirement ${id} not found`)

      const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, existing.objectTypeRef, workspaceDir)) ?? repoPath
      const typeDef = await this.readTypeDef(repoPath, existing.objectTypeRef)
      const updated = await this.persist(repoPath, targetRepo, existing, {
        ...existing,
        status: targetStatus,
        version: (existing.version ?? 0) + 1,
      })
      return { updated, leftApproval: RevalidationService.leavesApproval(typeDef, existing.status, targetStatus) }
    })
    // T172 — hors du verrou de cette exigence (pas de verrous imbriqués avec ceux des pairs).
    if (leftApproval) await this.revalidation?.markImpactedBy(repoPath, id, workspaceDir)
    return updated
  }

  async transition(repoPath: string, id: string, dto: TransitionRequirementDto, workspaceDir?: string): Promise<Requirement> {
    const { updated, leftApproval } = await withKeyLock(`${repoPath}::requirements/${id}`, async () => {
      const existing = await this.index.findById(repoPath, id)
      if (!existing) throw new Error(`Requirement ${id} not found`)

      const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, existing.objectTypeRef, workspaceDir)) ?? repoPath

      // Une exigence approuvée qui quitte ce statut (ex: retour en draft depuis la
      // colonne Statut de la vue Excel, qui appelle transition() plutôt que openDraft())
      // doit voir sa version incrémentée au même titre que le bouton dédié "Reopen draft"
      // (T150) — sinon la traçabilité de version diverge selon le chemin UI emprunté.
      const typeDef = await this.readTypeDef(repoPath, existing.objectTypeRef)
      const wasApproved = !!typeDef?.statuses?.find(s => s.name === existing.status)?.isApproval

      const updated = await this.persist(repoPath, targetRepo, existing, {
        ...existing,
        status: dto.toStatus,
        ...(wasApproved && dto.toStatus !== existing.status ? { version: (existing.version ?? 0) + 1 } : {}),
      })
      return { updated, leftApproval: RevalidationService.leavesApproval(typeDef, existing.status, dto.toStatus) }
    })
    // T172 — hors du verrou de cette exigence (pas de verrous imbriqués avec ceux des pairs).
    if (leftApproval) await this.revalidation?.markImpactedBy(repoPath, id, workspaceDir)
    return updated
  }

  /**
   * Seule écriture d'un fichier d'exigence (GH77) : complète l'historique des champs suivis
   * (`before` null = création), écrit sans les champs d'audit, met l'index à jour.
   */
  private async persist(
    repoPath: string, targetRepo: string, before: Requirement | null, after: Requirement,
    /** Écriture qui ne change aucune valeur (renommage, reprise git) : `history` écrit tel quel. */
    opts: { raw?: boolean } = {},
  ): Promise<Requirement> {
    const stamped = this.history && !opts.raw
      ? await this.history.stamp(repoPath, after.objectTypeRef, before, after, before ?? { updatedAt: null, updatedBy: null }, targetRepo)
      : after
    await this.git.writeYaml(targetRepo, `requirements/${stamped.id}.yaml`, omitAuditFields(stamped))
    this.index.upsert(repoPath, stamped)
    return stamped
  }

  /** Définition du type de l'objet dans le schéma du repo ouvert (null si non résolvable). */
  private async readTypeDef(repoPath: string, objectTypeRef: string): Promise<ObjectTypeDefinition | null> {
    const schema = await this.git.readYaml<ProjectSchema>(repoPath, '.polenta/schema.yaml')
    const resolved = schema ? findObjectTypeDef(schema, objectTypeRef) : null
    return resolved && resolved !== 'unresolvable' ? resolved : null
  }

  /**
   * Rewrites `objectTypeRef` on every requirement currently referencing `oldRef` to `newRef`
   * instead (T135 sprint 3 — cascade after an element is moved between nodes in the Structure
   * tab). A dedicated method rather than exposing `objectTypeRef` through `UpdateRequirementDto`
   * on purpose: this is a system-triggered cascade following a tree move, not a normal field
   * edit — letting any caller (UI, MCP tool) freely reassign a requirement to an unrelated type
   * through the public update DTO would be a different, unwanted capability (cf.
   * specs/T135-design.md §Décisions #1).
   *
   * Best-effort per file, same philosophy as `renameDependency`'s `implements[]` cascade
   * (`workspaceActions.ts`) — one unreadable/corrupt file must not block the rewrite of the
   * others; failures are collected and returned rather than thrown.
   */
  async retargetObjectTypeRef(
    repoPath: string, oldRef: string, newRef: string,
  ): Promise<{ succeeded: string[]; failed: { id: string; error: string }[] }> {
    const matching = await this.index.findAll(repoPath, { type: oldRef })
    const succeeded: string[] = []
    const failed: { id: string; error: string }[] = []
    for (const req of matching) {
      try {
        await this.persist(repoPath, repoPath, req, { ...req, objectTypeRef: newRef })
        succeeded.push(req.id)
      } catch (err) {
        failed.push({ id: req.id, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return { succeeded, failed }
  }

  /**
   * GH77 — renommage de champs dans l'éditeur de schéma : déplace valeur et historique sur chaque
   * exigence du type (`renameFieldKeys`), sans entrée d'historique. Méthode dédiée plutôt que le
   * DTO public, comme `retargetObjectTypeRef`. Au mieux par fichier.
   */
  async renameFieldKeys(repoPath: string, objectTypeRef: string, renames: FieldRename[], result: FieldRenameResult): Promise<void> {
    return this.rewriteObjects(repoPath, objectTypeRef, o => renameFieldKeys(o, renames), result)
  }

  /**
   * GH77/GH82 — réécrit chaque exigence du type par `transform` (renommage de champ ou de valeur),
   * sous le verrou du fichier, en écriture brute : ni entrée d'historique, ni revalidation, ni
   * `version`. `null` = inchangé ; `'conflict'` = non migré (listé). Au mieux par fichier.
   */
  async rewriteObjects(
    repoPath: string, objectTypeRef: string,
    transform: (obj: Requirement) => Requirement | 'conflict' | null, result: FieldRenameResult,
  ): Promise<void> {
    for (const { id } of await this.index.findAll(repoPath, { type: objectTypeRef })) {
      try {
        await withKeyLock(`${repoPath}::requirements/${id}`, async () => {
          const existing = await this.index.findById(repoPath, id)
          const next = existing ? transform(existing) : null
          if (next === 'conflict') result.skipped.push({ id, reason: 'target_exists' })
          if (!next || next === 'conflict') return
          await this.persist(repoPath, repoPath, next, next, { raw: true })
          result.migrated.push(id)
        })
      } catch (err) {
        result.failed.push({ id, error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  /**
   * GH77 — remplace l'historique d'une exigence par `next(courante)` (reprise depuis git), sous le
   * verrou du fichier ; `null` = rien à écrire. Vrai si le fichier a été réécrit.
   */
  async updateHistory(repoPath: string, id: string, next: (current: Requirement) => ObjectHistory | null): Promise<boolean> {
    return withKeyLock(`${repoPath}::requirements/${id}`, async () => {
      const existing = await this.index.findById(repoPath, id)
      const history = existing ? next(existing) : null
      if (!existing || !history) return false
      const updated = { ...existing, history }
      await this.persist(repoPath, repoPath, updated, updated, { raw: true })
      return true
    })
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Inserts a leaf `TypeTreeNode` for the newly created object into its
   * `.polenta/trees/<node>/<type>.yaml` — without this, the object is written to disk
   * but never enumerated by SystemView/ExcelView, which read that tree rather than
   * scanning `requirements/` (T138: objects created via the MCP server were invisible
   * in the app because this step only happened in the renderer's create flow).
   * `this.tree` is optional (absent in some MCP-container wiring) and any failure here
   * is swallowed — a missing/corrupt tree entry must never fail the object creation
   * itself, since the YAML file (the source of truth) is already written.
   */
  private async appendToTree(repoPath: string, objectTypeRef: string, objectId: string, title: string): Promise<void> {
    if (!this.tree) return
    try {
      const schema = await this.git.readYaml<ProjectSchema>(repoPath, '.polenta/schema.yaml')
      const location = schema ? resolveObjectTypeLocation(schema, objectTypeRef) : null
      if (!location || location === 'unresolvable') return

      const { nodeName, typeDef } = location
      const current = await this.tree.get(repoPath, nodeName, typeDef.name)
      const node = { id: randomUUID(), kind: 'item' as const, name: title, objectId, children: [] }
      await this.tree.save(repoPath, { nodeId: nodeName, typeId: typeDef.name, root: [...current.root, node] })
    } catch (err) {
      console.error(`Erreur insertion arbre pour ${objectId}:`, err)
    }
  }

  /**
   * The prefix is resolved from `repoPath`'s schema (it declares every node), but the number is
   * allocated in `targetRepo`, the repo that receives the file — GH20: IDs are derived from the
   * files on disk, so a component's IDs must be counted where the component's files live. The
   * product repo stays a history source (pre-GH20 counters/tombstones, cf. `nextCounterId`).
   */
  private async nextId(repoPath: string, targetRepo: string, objectTypeRef: string): Promise<string> {
    const typeName = objectTypeRef.split('::').pop() ?? objectTypeRef

    // Scoped by node (not a flat search across every node's objectTypes) via the same
    // lookup requirements-index/query-engine already rely on — a type name like "exigence"
    // is only unique *within* its own node, not across the whole schema (T113: sibling
    // SystemNodes can legitimately reuse the same type name with different prefixes).
    const schema = await this.git.readYaml<ProjectSchema>(repoPath, '.polenta/schema.yaml')
    const resolved = schema ? findObjectTypeDef(schema, objectTypeRef) : null
    const prefix = (resolved && resolved !== 'unresolvable' ? resolved.prefix : undefined)
      ?? typeName.slice(0, 6).toUpperCase()

    return nextCounterId(this.git, targetRepo, prefix, 'requirements', targetRepo === repoPath ? [] : [repoPath])
  }
}
