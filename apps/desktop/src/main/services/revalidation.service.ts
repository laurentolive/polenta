import * as path from 'path'
import type {
  ClearRevalidationResult,
  ElementRepoRef,
  FlaggedElement,
  FlaggedLinkedElement,
  ObjectTypeDefinition,
  ProjectSchema,
  Requirement,
  TestCase,
} from '@polenta/types'
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

type Category = 'requirement' | 'test'

/**
 * T172 — marquage automatique `needsRevalidation` des éléments impactés par la modification
 * d'un élément approuvé (specs/T172.md). Le flag est porté par les ÉLÉMENTS liés, pas par les
 * liens : `links/links.yaml` n'est jamais réécrit ici.
 *
 * Point d'entrée unique `markImpactedBy`, appelé par RequirementsService/TestsService quand un
 * élément quitte un statut `isApproval`, et réutilisé par T171 (modification d'un paramètre).
 * T173 — `listFlagged` (éléments marqués du workspace) et `clear` (levée du flag depuis
 * l'analyse d'impact).
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
   * niveau, pas de cascade. Exclus : l'élément lui-même (sauf `includeSelf`), les pairs
   * introuvables, déjà marqués, en statut terminal ou appartenant à un nœud `readonly`.
   * Best-effort par pair : une erreur est loggée sans interrompre les autres pairs ni
   * l'opération appelante.
   *
   * `repoPath` est le repo **ouvert** : c'est son schéma qui déclare les nœuds `readonly`.
   * `includeSelf` (T171 §9) : l'élément lui-même est aussi marqué — son texte affiché a changé
   * (paramètre modifié) sans passer par un brouillon ; mêmes exclusions que pour les pairs.
   */
  async markImpactedBy(
    repoPath: string,
    elementId: string,
    workspaceDir?: string,
    opts: { includeSelf?: boolean } = {},
  ): Promise<ImpactedElement[]> {
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
    if (opts.includeSelf) peerIds.add(elementId)
    else peerIds.delete(elementId)

    const ctx = await this.buildContext(repoPath, repoPaths, workspaceDir)
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

  /**
   * T173 — éléments (exigences et tests) marqués `needsRevalidation` dans tous les repos du
   * workspace, chacun avec ses éléments liés (tous liens, sens indifférent, un niveau) pour
   * aider à retrouver le déclencheur. `repoPath` est le repo racine : les éléments qui y vivent
   * n'ont pas de `repo`. Doublon d'id entre repos : le premier repo (racine) gagne.
   * Tri : exigences puis tests, par id.
   */
  async listFlagged(repoPath: string, workspaceDir?: string): Promise<FlaggedElement[]> {
    const repoPaths = await resolveWorkspaceRepoPaths(this.workspaceTree, repoPath, workspaceDir)
    const repoNames = await this.repoNames(workspaceDir)
    const perRepo = await Promise.all(repoPaths.map(async (p) => ({
      p,
      requirements: await this.reqIndex.findAll(p, {}),
      tests: await this.testsIndex.findAll(p),
      links: await this.reqIndex.findAllLinks(p),
    })))

    type Entry = { el: Requirement | TestCase; category: Category; repoPath: string }
    const byId = new Map<string, Entry>()
    for (const { p, requirements, tests } of perRepo) {
      for (const r of requirements) if (!byId.has(r.id)) byId.set(r.id, { el: r, category: 'requirement', repoPath: p })
      for (const tc of tests) if (!byId.has(tc.id)) byId.set(tc.id, { el: tc, category: 'test', repoPath: p })
    }
    const flagged = [...byId.values()].filter((e) => e.el.needsRevalidation)
    if (flagged.length === 0) return []

    // Pairs de chaque élément marqué : premier type de lien rencontré par pair.
    const flaggedIds = new Set(flagged.map((e) => e.el.id))
    const peersOf = new Map<string, Map<string, string>>()
    for (const { links } of perRepo) {
      for (const link of links) {
        for (const [self, peer] of [[link.sourceId, link.targetId], [link.targetId, link.sourceId]] as const) {
          if (!flaggedIds.has(self) || self === peer) continue
          const peers = peersOf.get(self) ?? new Map<string, string>()
          if (!peers.has(peer)) peers.set(peer, link.type)
          peersOf.set(self, peers)
        }
      }
    }

    const schemas = new Map<string, ProjectSchema | null>()
    const isApproved = async (e: Entry): Promise<boolean> => {
      if (!schemas.has(e.repoPath)) schemas.set(e.repoPath, await this.readSchema(e.repoPath))
      const schema = schemas.get(e.repoPath)
      const typeDef = schema ? findObjectTypeDef(schema, e.el.objectTypeRef) : null
      if (!typeDef || typeDef === 'unresolvable') return false
      return !!typeDef.statuses?.find((s) => s.name === e.el.status)?.isApproval
    }
    const repoRef = (p: string): ElementRepoRef | undefined =>
      p === repoPath ? undefined : { path: p, name: repoNames.get(p) ?? path.basename(p) }
    const elementType = (c: Category): 'requirement' | 'test_case' => (c === 'requirement' ? 'requirement' : 'test_case')

    const result: FlaggedElement[] = []
    for (const e of flagged) {
      const linked: FlaggedLinkedElement[] = []
      for (const [peerId, linkType] of peersOf.get(e.el.id) ?? []) {
        const peer = byId.get(peerId)
        if (!peer) continue // lien orphelin
        linked.push({
          elementId: peerId,
          elementType: elementType(peer.category),
          title: peer.el.title,
          status: peer.el.status,
          version: peer.el.version,
          linkType,
          approved: await isApproved(peer),
          repo: repoRef(peer.repoPath),
        })
      }
      linked.sort((a, b) => a.elementId.localeCompare(b.elementId))
      result.push({
        elementId: e.el.id,
        elementType: elementType(e.category),
        title: e.el.title,
        status: e.el.status,
        version: e.el.version,
        repo: repoRef(e.repoPath),
        linked,
      })
    }
    return result.sort((a, b) =>
      a.elementType === b.elementType
        ? a.elementId.localeCompare(b.elementId)
        : a.elementType === 'requirement' ? -1 : 1)
  }

  /**
   * T173 — lève le flag : retire la clé `needsRevalidation` du YAML de chaque élément (jamais
   * `false`), sans toucher statut, version, autres champs ni liens. Permis quel que soit le
   * statut (y compris approuvé ou terminal). Refusé pour un élément d'un nœud `readonly`.
   * Best-effort par élément : un échec est rapporté sans annuler les autres. Pas de commit.
   */
  async clear(repoPath: string, elementIds: string[], workspaceDir?: string): Promise<ClearRevalidationResult> {
    const result: ClearRevalidationResult = { cleared: [], unchanged: [], failed: [] }
    const repoPaths = await resolveWorkspaceRepoPaths(this.workspaceTree, repoPath, workspaceDir)
    const ctx = await this.buildContext(repoPath, repoPaths, workspaceDir)
    for (const id of new Set(elementIds)) {
      try {
        const found = await this.locate(id, ctx.repoPaths)
        if (!found) {
          result.failed.push({ id, reason: 'not_found' })
          continue
        }
        const outcome = await this.clearInRepo(found.p, id, found.category, ctx)
        if (outcome === 'readonly') result.failed.push({ id, reason: 'readonly' })
        else if (outcome === 'not_found') result.failed.push({ id, reason: 'not_found' })
        else result[outcome].push(id)
      } catch (err) {
        console.error(`[Revalidation] levée du flag de ${id} impossible:`, err)
        result.failed.push({ id, reason: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    }
    return result
  }

  /** Repos du workspace en lecture seule vus depuis le repo ouvert `repoPath` (même règle que
   *  le marquage) — réutilisé par ParametersService (T171) pour refuser les écritures. */
  async readonlyRepoPaths(repoPath: string, workspaceDir?: string): Promise<Set<string>> {
    return this.readonlyRepoPathsFor(await this.readSchema(repoPath), workspaceDir)
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async buildContext(repoPath: string, repoPaths: string[], workspaceDir?: string): Promise<MarkContext> {
    const openedSchema = await this.readSchema(repoPath)
    return {
      repoPaths,
      openedRepoPath: repoPath,
      openedSchema,
      readonlyRepoPaths: await this.readonlyRepoPathsFor(openedSchema, workspaceDir),
      workspaceDir,
    }
  }

  /**
   * Repos composants (mode workspace) montés sous un nœud submodule déclaré `readonly: true`
   * dans le schéma du repo ouvert. Un élément stocké dans un tel repo a un `objectTypeRef`
   * exprimé dans le schéma du composant, pas dans celui du repo ouvert : le readonly se lit
   * donc sur le repo, via le nom de montage (même correspondance nom de nœud ↔ nœud de l'arbre
   * workspace que `SchemaService.resolveComponentRepoPath`).
   */
  private async readonlyRepoPathsFor(openedSchema: ProjectSchema | null, workspaceDir?: string): Promise<Set<string>> {
    const out = new Set<string>()
    if (!openedSchema || !workspaceDir || !this.workspaceTree) return out
    const tree = await this.workspaceTree.readCache(workspaceDir)
    for (const node of tree?.nodes ?? []) {
      if (findSystemNode(openedSchema.nodes, node.name)?.readonly) out.add(node.repoPath)
    }
    return out
  }

  /** Nom affiché de chaque repo composant (label ?? name du nœud workspace) — même règle que
   *  l'analyse locale (T175). */
  private async repoNames(workspaceDir?: string): Promise<Map<string, string>> {
    const names = new Map<string, string>()
    if (!workspaceDir || !this.workspaceTree) return names
    const tree = await this.workspaceTree.readCache(workspaceDir)
    for (const node of tree?.nodes ?? []) {
      if (node.repoPath) names.set(node.repoPath, node.label ?? node.name)
    }
    return names
  }

  /** Repo et catégorie d'un élément, premier repo trouvé ; `null` si introuvable. */
  private async locate(id: string, repoPaths: string[]): Promise<{ p: string; category: Category } | null> {
    for (const p of repoPaths) {
      if (await this.reqIndex.findById(p, id)) return { p, category: 'requirement' }
      if (await this.testsIndex.findById(p, id)) return { p, category: 'test' }
    }
    return null
  }

  private async markOne(id: string, ctx: MarkContext): Promise<ImpactedElement | null> {
    const found = await this.locate(id, ctx.repoPaths)
    if (!found) return null // lien orphelin
    return this.markInRepo(found.p, id, found.category, ctx)
  }

  /** Vrai si l'élément ne doit pas être écrit : repo readonly, ou nœud readonly du repo ouvert. */
  private isReadonly(p: string, existing: Requirement | TestCase, ctx: MarkContext): boolean {
    if (ctx.readonlyRepoPaths.has(p)) return true
    // Élément du repo ouvert : son `objectTypeRef` se résout dans le schéma ouvert, qui peut
    // déclarer `readonly` sur le nœud (local ou submodule) propriétaire. Les éléments des
    // autres repos sont couverts par `readonlyRepoPaths` ci-dessus.
    return p === ctx.openedRepoPath && !!ctx.openedSchema
      && isRefInReadonlyNode(ctx.openedSchema, existing.objectTypeRef)
  }

  private findElement(p: string, id: string, category: Category): Promise<Requirement | TestCase | null> {
    return category === 'requirement' ? this.reqIndex.findById(p, id) : this.testsIndex.findById(p, id)
  }

  private async writeElement(p: string, category: Category, updated: Requirement | TestCase, workspaceDir?: string): Promise<string> {
    const dir = category === 'requirement' ? 'requirements' : 'tests'
    const targetRepo = (await this.schema.resolveComponentRepoPath(p, updated.objectTypeRef, workspaceDir)) ?? p
    await this.git.writeYaml(targetRepo, `${dir}/${updated.id}.yaml`, omitAuditFields(updated))
    if (category === 'requirement') this.reqIndex.upsert(p, updated as Requirement)
    else this.testsIndex.upsertTestCase(p, updated as TestCase)
    return targetRepo
  }

  private async markInRepo(p: string, id: string, category: Category, ctx: MarkContext): Promise<ImpactedElement | null> {
    if (ctx.readonlyRepoPaths.has(p)) return null
    const dir = category === 'requirement' ? 'requirements' : 'tests'
    // Même clé de verrou que RequirementsService/TestsService pour ce fichier (T159).
    return withKeyLock(`${p}::${dir}/${id}`, async () => {
      const existing = await this.findElement(p, id, category)
      if (!existing || existing.needsRevalidation) return null
      if (this.isReadonly(p, existing, ctx)) return null

      const ownSchema = await this.readSchema(p)
      const typeDef = ownSchema ? findObjectTypeDef(ownSchema, existing.objectTypeRef) : null
      if (typeDef && typeDef !== 'unresolvable'
        && typeDef.statuses?.find(s => s.name === existing.status)?.isTerminal) return null

      const targetRepo = await this.writeElement(p, category, { ...existing, needsRevalidation: true }, ctx.workspaceDir)
      return { id, category, repoPath: targetRepo }
    })
  }

  /** T173 — pas de filtre sur le statut terminal : lever un flag existant ne crée pas de bruit. */
  private async clearInRepo(
    p: string,
    id: string,
    category: Category,
    ctx: MarkContext,
  ): Promise<'cleared' | 'unchanged' | 'readonly' | 'not_found'> {
    const dir = category === 'requirement' ? 'requirements' : 'tests'
    return withKeyLock(`${p}::${dir}/${id}`, async () => {
      const existing = await this.findElement(p, id, category)
      if (!existing) return 'not_found'
      if (!existing.needsRevalidation) return 'unchanged'
      if (this.isReadonly(p, existing, ctx)) return 'readonly'
      const { needsRevalidation: _flag, ...rest } = existing
      await this.writeElement(p, category, rest as Requirement | TestCase, ctx.workspaceDir)
      return 'cleared'
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
