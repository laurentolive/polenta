import { randomUUID } from 'crypto'
import type { ProjectSchema, Requirement } from '@polenta/types'
import type { CreateRequirementDto, UpdateRequirementDto, TransitionRequirementDto } from '@polenta/zod-schemas'
import type { GitService } from './git.service'
import type { RequirementsIndexService, RequirementFilters } from './requirements-index.service'
import type { SchemaService } from './schema.service'
import type { TreeService } from './tree.service'
import { omitAuditFields } from './audit-fields.util'
import { findObjectTypeDef, resolveObjectTypeLocation } from './schema-lookup.util'
import { nextCounterId } from './id-counter.util'

export class RequirementsService {
  constructor(
    private readonly git: GitService,
    private readonly index: RequirementsIndexService,
    private readonly schema: SchemaService,
    private readonly tree?: TreeService,
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

  async create(repoPath: string, dto: CreateRequirementDto, workspaceDir?: string): Promise<Requirement> {
    const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, dto.objectTypeRef, workspaceDir)) ?? repoPath
    const reqId = await this.nextId(repoPath, dto.objectTypeRef)

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
      status: 'draft',
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

    await this.git.writeYaml(targetRepo, `requirements/${reqId}.yaml`, omitAuditFields(req))
    this.index.upsert(repoPath, req)
    await this.appendToTree(targetRepo, dto.objectTypeRef, req.id, req.title)
    return req
  }

  async update(repoPath: string, id: string, dto: UpdateRequirementDto, workspaceDir?: string): Promise<Requirement> {
    const existing = await this.index.findById(repoPath, id)
    if (!existing) throw new Error(`Requirement ${id} not found`)

    const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, existing.objectTypeRef, workspaceDir)) ?? repoPath
    // createdAt/createdBy/updatedAt/updatedBy viennent de `...existing` (dérivés du
    // dernier commit par l'index) — cette édition n'étant pas commitée, ils ne changent
    // pas ici (T112).
    const updated: Requirement = {
      ...existing,
      ...(dto.title && { title: dto.title }),
      fields: { ...(existing.fields as object), ...(dto.fields ?? {}) },
    }

    await this.git.writeYaml(targetRepo, `requirements/${id}.yaml`, omitAuditFields(updated))
    this.index.upsert(repoPath, updated)
    return updated
  }

  async openDraft(repoPath: string, id: string, targetStatus: string, workspaceDir?: string): Promise<Requirement> {
    const existing = await this.index.findById(repoPath, id)
    if (!existing) throw new Error(`Requirement ${id} not found`)

    const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, existing.objectTypeRef, workspaceDir)) ?? repoPath
    const updated: Requirement = {
      ...existing,
      status: targetStatus,
      version: (existing.version ?? 0) + 1,
    }

    await this.git.writeYaml(targetRepo, `requirements/${id}.yaml`, omitAuditFields(updated))
    this.index.upsert(repoPath, updated)
    return updated
  }

  async transition(repoPath: string, id: string, dto: TransitionRequirementDto, workspaceDir?: string): Promise<Requirement> {
    const existing = await this.index.findById(repoPath, id)
    if (!existing) throw new Error(`Requirement ${id} not found`)

    const targetRepo = (await this.schema.resolveComponentRepoPath(repoPath, existing.objectTypeRef, workspaceDir)) ?? repoPath

    // Une exigence approuvée qui quitte ce statut (ex: retour en draft depuis la
    // colonne Statut de la vue Excel, qui appelle transition() plutôt que openDraft())
    // doit voir sa version incrémentée au même titre que le bouton dédié "Reopen draft"
    // (T150) — sinon la traçabilité de version diverge selon le chemin UI emprunté.
    const schema = await this.git.readYaml<ProjectSchema>(repoPath, '.polenta/schema.yaml')
    const resolved = schema ? findObjectTypeDef(schema, existing.objectTypeRef) : null
    const wasApproved = resolved && resolved !== 'unresolvable'
      ? !!resolved.statuses?.find(s => s.name === existing.status)?.isApproval
      : false

    const updated: Requirement = {
      ...existing,
      status: dto.toStatus,
      ...(wasApproved && dto.toStatus !== existing.status ? { version: (existing.version ?? 0) + 1 } : {}),
    }

    await this.git.writeYaml(targetRepo, `requirements/${id}.yaml`, omitAuditFields(updated))
    this.index.upsert(repoPath, updated)
    return updated
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
        const updated: Requirement = { ...req, objectTypeRef: newRef }
        await this.git.writeYaml(repoPath, `requirements/${req.id}.yaml`, omitAuditFields(updated))
        this.index.upsert(repoPath, updated)
        succeeded.push(req.id)
      } catch (err) {
        failed.push({ id: req.id, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return { succeeded, failed }
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

  private async nextId(repoPath: string, objectTypeRef: string): Promise<string> {
    const typeName = objectTypeRef.split('::').pop() ?? objectTypeRef

    // Scoped by node (not a flat search across every node's objectTypes) via the same
    // lookup requirements-index/query-engine already rely on — a type name like "exigence"
    // is only unique *within* its own node, not across the whole schema (T113: sibling
    // SystemNodes can legitimately reuse the same type name with different prefixes).
    const schema = await this.git.readYaml<ProjectSchema>(repoPath, '.polenta/schema.yaml')
    const resolved = schema ? findObjectTypeDef(schema, objectTypeRef) : null
    const prefix = (resolved && resolved !== 'unresolvable' ? resolved.prefix : undefined)
      ?? typeName.slice(0, 6).toUpperCase()

    return nextCounterId(this.git, repoPath, prefix, 'requirements')
  }
}
