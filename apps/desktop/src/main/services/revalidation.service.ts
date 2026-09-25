import type { ObjectTypeDefinition, ProjectSchema, Requirement, TestCase } from '@polenta/types'
import { findSystemNode } from '@polenta/types'
import type { GitService } from './git.service'
import type { RequirementsIndexService } from './requirements-index.service'
import type { TestsIndexService } from './tests-index.service'
import type { SchemaService } from './schema.service'
import type { WorkspaceTreeService } from './workspace-tree.service'
import { omitAuditFields } from './audit-fields.util'
import { findObjectTypeDef, isRefInReadonlyNode } from './schema-lookup.util'
import { withKeyLock } from './serialize-writes.util'
import { resolveWorkspaceRepoPaths } from './workspace-repos.util'

export interface ImpactedElement {
  id: string
  category: 'requirement' | 'test'
  repoPath: string
}

interface MarkContext {
  repoPaths: string[]
  openedRepoPath: string
  openedSchema: ProjectSchema | null
  readonlyRepoPaths: Set<string>
  workspaceDir?: string
}

/**
 * T172 — marquage automatique `needsRevalidation` des éléments impactés par la modification
 * d'un élément approuvé (specs/T172.md). Le flag est porté par les ÉLÉMENTS liés, pas par les
 * liens : `links/links.yaml` n'est jamais réécrit ici.
 *
 * Point d'entrée unique `markImpactedBy`, appelé par RequirementsService/TestsService quand un
 * élément quitte un statut `isApproval`, et réutilisé par T171 (modification d'un paramètre).
 * La levée du flag n'est pas exposée ici (analyse d'impact, T173).
 */
export class RevalidationService {
  constructor(
    private readonly git: GitService,
    private readonly reqIndex: RequirementsIndexService,
    private readonly testsIndex: TestsIndexService,
    private readonly schema: SchemaService,
    private readonly workspaceTree?: WorkspaceTreeService,
  ) {}

  /** Vrai si l'élément passe d'un statut `isApproval` à un statut qui ne l'est pas. */
  static leavesApproval(typeDef: ObjectTypeDefinition | null, fromStatus: string, toStatus: string): boolean {
    if (!typeDef || fromStatus === toStatus) return false
    const isApproval = (name: string) => !!typeDef.statuses?.find(s => s.name === name)?.isApproval
    return isApproval(fromStatus) && !isApproval(toStatus)
  }

  /**
   * Marque `needsRevalidation: true` chaque élément à l'autre bout d'un lien touchant
   * `elementId` (sens indifférent, tous types de liens, tous les repos du workspace). Un seul
   * niveau, pas de cascade. Exclus : l'élément lui-même, les pairs introuvables, déjà marqués,
   * en statut terminal ou appartenant à un nœud `readonly`. Best-effort par pair : une erreur
   * est loggée sans interrompre les autres pairs ni l'opération appelante.
   */
  async markImpactedBy(repoPath: string, elementId: string, workspaceDir?: string): Promise<ImpactedElement[]> {
    let repoPaths: string[]
    const peerIds = new Set<string>()
    try {
      repoPaths = await resolveWorkspaceRepoPaths(this.workspaceTree, repoPath, workspaceDir)
      for (const p of repoPaths) {
        for (const link of await this.reqIndex.findAllLinks(p)) {
          if (link.sourceId === elementId) peerIds.add(link.targetId)
          else if (link.targetId === elementId) peerIds.add(link.sourceId)
        }
      }
    } catch (err) {
      // L'opération appelante (réouverture) a déjà réussi : le marquage ne doit pas la faire échouer.
      console.error(`[Revalidation] liens de ${elementId} illisibles:`, err)
      return []
    }
    peerIds.delete(elementId)

    const openedSchema = await this.readSchema(repoPath)
    const ctx: MarkContext = {
      repoPaths,
      openedRepoPath: repoPath,
      openedSchema,
      readonlyRepoPaths: await this.readonlyRepoPaths(openedSchema, workspaceDir),
      workspaceDir,
    }
    const marked: ImpactedElement[] = []
    for (const peerId of peerIds) {
      try {
        const done = await this.markOne(peerId, ctx)
        if (done) marked.push(done)
      } catch (err) {
        console.error(`[Revalidation] marquage de ${peerId} impossible:`, err)
      }
    }
    return marked
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Repos composants (mode workspace) montés sous un nœud submodule déclaré `readonly: true`
   * dans le schéma du repo ouvert. Un élément stocké dans un tel repo a un `objectTypeRef`
   * exprimé dans le schéma du composant, pas dans celui du repo ouvert : le readonly se lit
   * donc sur le repo, via le nom de montage (même correspondance nom de nœud ↔ nœud de l'arbre
   * workspace que `SchemaService.resolveComponentRepoPath`).
   */
  private async readonlyRepoPaths(openedSchema: ProjectSchema | null, workspaceDir?: string): Promise<Set<string>> {
    const out = new Set<string>()
    if (!openedSchema || !workspaceDir || !this.workspaceTree) return out
    const tree = await this.workspaceTree.readCache(workspaceDir)
    for (const node of tree?.nodes ?? []) {
      if (findSystemNode(openedSchema.nodes, node.name)?.readonly) out.add(node.repoPath)
    }
    return out
  }

  private async markOne(id: string, ctx: MarkContext): Promise<ImpactedElement | null> {
    for (const p of ctx.repoPaths) {
      if (await this.reqIndex.findById(p, id)) return this.markInRepo(p, id, 'requirement', ctx)
      if (await this.testsIndex.findById(p, id)) return this.markInRepo(p, id, 'test', ctx)
    }
    return null // lien orphelin
  }

  private async markInRepo(
    p: string,
    id: string,
    category: 'requirement' | 'test',
    ctx: MarkContext,
  ): Promise<ImpactedElement | null> {
    if (ctx.readonlyRepoPaths.has(p)) return null
    const dir = category === 'requirement' ? 'requirements' : 'tests'
    // Même clé de verrou que RequirementsService/TestsService pour ce fichier (T159).
    return withKeyLock(`${p}::${dir}/${id}`, async () => {
      const existing: Requirement | TestCase | null = category === 'requirement'
        ? await this.reqIndex.findById(p, id)
        : await this.testsIndex.findById(p, id)
      if (!existing || existing.needsRevalidation) return null

      // Élément du repo ouvert : son `objectTypeRef` se résout dans le schéma ouvert, qui peut
      // déclarer `readonly` sur le nœud (local ou submodule) propriétaire. Les éléments des
      // autres repos sont couverts par `readonlyRepoPaths` ci-dessus.
      if (p === ctx.openedRepoPath && ctx.openedSchema
        && isRefInReadonlyNode(ctx.openedSchema, existing.objectTypeRef)) return null

      const ownSchema = await this.readSchema(p)
      const typeDef = ownSchema ? findObjectTypeDef(ownSchema, existing.objectTypeRef) : null
      if (typeDef && typeDef !== 'unresolvable'
        && typeDef.statuses?.find(s => s.name === existing.status)?.isTerminal) return null

      const targetRepo = (await this.schema.resolveComponentRepoPath(p, existing.objectTypeRef, ctx.workspaceDir)) ?? p
      const updated = { ...existing, needsRevalidation: true }
      await this.git.writeYaml(targetRepo, `${dir}/${id}.yaml`, omitAuditFields(updated))
      if (category === 'requirement') this.reqIndex.upsert(p, updated as Requirement)
      else this.testsIndex.upsertTestCase(p, updated as TestCase)
      return { id, category, repoPath: targetRepo }
    })
  }

  private async readSchema(repoPath: string): Promise<ProjectSchema | null> {
    try {
      return await this.schema.get(repoPath)
    } catch {
      return null
    }
  }
}
