import path from 'node:path'
import {
  flattenSystemNodes,
  type LinkWriteErrorCode,
  type ProjectSchema,
  type WorkspaceLink,
  type WorkspaceLinkType,
  type WorkspaceObject,
} from '@polenta/types'
import type { GitService } from './git.service'
import type { RequirementsIndexService } from './requirements-index.service'
import type { TestsIndexService } from './tests-index.service'
import type { SchemaService } from './schema.service'
import type { WorkspaceTreeService } from './workspace-tree.service'
import type { RevalidationService } from './revalidation.service'
import type { CampaignsService } from './campaigns.service'
import { resolveWorkspaceRepoPaths } from './workspace-repos.util'
import { isRefInReadonlyNode } from './schema-lookup.util'
import {
  validateLinkEntries,
  type LinkEntryDto,
  type LinkEntryError,
  type ResolvedLinkObject,
} from './link-validation.util'

/** Erreur d'écriture de lien ; le message commence par le code (`READONLY_REPO: …`), seul le
 *  message traversant l'IPC. */
export class LinkWriteError extends Error {
  constructor(readonly code: LinkWriteErrorCode, reason: string) {
    super(`${code}: ${reason}`)
    this.name = 'LinkWriteError'
  }
}

export interface WorkspaceLinkTypes {
  linkTypes: WorkspaceLinkType[]
  /** Ref `<nœud>::<type>` → repos dont le schéma déclare ce type (résolution des refs, D2). */
  declaredBy: Record<string, string[]>
}

/** Clé de comparaison d'un chemin de repo (le même repo peut arriver sous deux écritures,
 *  `c:\…` / `C:/…`, selon qu'il vient de l'appelant ou de l'arbre du workspace). */
function repoKey(p: string): string {
  const r = path.resolve(p)
  return process.platform === 'win32' ? r.toLowerCase() : r
}

/** Ajoute `value` au groupe `key` (création à la volée). */
function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const group = map.get(key)
  if (group) group.push(value)
  else map.set(key, [value])
}

interface ObjectEntry extends ResolvedLinkObject {
  title: string
  status: string
  repoPath: string
}

/** État du workspace lu une fois par opération. */
interface WorkspaceContext {
  rootRepoPath: string
  workspaceDir?: string
  /** Repos du workspace, racine d'abord. */
  repoPaths: string[]
  /** Clés (`repoKey`) des repos en lecture seule. */
  readonlyRepos: Set<string>
  /** Libellé par clé de repo. */
  labels: Map<string, string>
}

/**
 * GH105 — liens inter-repos (specs/GH105-design.md D1–D5). Agrège objets, liens et types de lien
 * sur les repos du workspace (repo racine + composants, `resolveWorkspaceRepoPaths`) ; un lien
 * est écrit dans le repo de l'objet côté `sourceRefs` et jamais recopié ailleurs.
 *
 * Sans `workspaceDir` (projet mono-repo, appels historiques), seul `rootRepoPath` est lu : même
 * comportement qu'avant GH105.
 */
export class WorkspaceLinksService {
  constructor(
    private readonly reqIndex: RequirementsIndexService,
    private readonly testsIndex: TestsIndexService,
    private readonly schema: SchemaService,
    private readonly git: GitService,
    private readonly workspaceTree?: WorkspaceTreeService,
    private readonly revalidation?: RevalidationService,
    /** Campagnes résolues pour la validation (liens MCP vers une campagne, GH16) ; jamais
     *  proposées comme candidats (`listObjects`). */
    private readonly campaigns?: CampaignsService,
  ) {}

  /** Exigences et tests de tous les repos du workspace (working tree : non commités compris). */
  async listObjects(rootRepoPath: string, workspaceDir?: string): Promise<WorkspaceObject[]> {
    const ctx = await this.context(rootRepoPath, workspaceDir)
    const table = await this.collectObjects(ctx.repoPaths, false)
    return [...table.values()].map((o) => ({
      id: o.id, title: o.title, status: o.status, objectTypeRef: o.objectTypeRef ?? '',
      category: o.category as WorkspaceObject['category'],
      repoPath: o.repoPath, repoLabel: this.labelOf(ctx, o.repoPath),
    }))
  }

  /**
   * Liens de tous les `links.yaml` du workspace, avec leur repo de stockage. `fresh` relit les
   * fichiers (process sans watcher : serveur MCP). Un même id dans deux repos : le premier
   * (racine d'abord) l'emporte.
   */
  async listLinks(rootRepoPath: string, workspaceDir?: string, fresh = false): Promise<WorkspaceLink[]> {
    return this.collectLinks(await this.context(rootRepoPath, workspaceDir), fresh)
  }

  /** Union par nom des types de lien des schémas du workspace (racine d'abord, D3). */
  async linkTypes(rootRepoPath: string, workspaceDir?: string): Promise<WorkspaceLinkTypes> {
    const repoPaths = await this.repoPaths(rootRepoPath, workspaceDir)
    return this.unionLinkTypes(repoPaths, await this.loadSchemas(repoPaths))
  }

  /**
   * Valide un lot et calcule le repo de stockage de chaque entrée (repo de l'objet côté
   * `sourceRefs`) ; une entrée dont l'objet propriétaire n'est pas modifiable (repo en lecture
   * seule, ou nœud `readonly` de son schéma) est en erreur `READONLY_REPO`.
   */
  async plan(
    rootRepoPath: string,
    entries: LinkEntryDto[],
    workspaceDir?: string,
    fresh = false,
  ): Promise<{ valid: Array<{ index: number; dto: LinkEntryDto; storedIn: string }>; errors: LinkEntryError[] }> {
    const ctx = await this.context(rootRepoPath, workspaceDir)
    const [table, schemas, existing] = await Promise.all([
      this.objectTable(ctx.repoPaths, entries),
      this.loadSchemas(ctx.repoPaths),
      this.collectLinks(ctx, fresh),
    ])
    const { linkTypes, declaredBy } = this.unionLinkTypes(ctx.repoPaths, schemas)
    const { valid, errors } = validateLinkEntries(
      linkTypes, entries, (id) => table.get(id) ?? null, existing, workspaceDir ? declaredBy : undefined,
    )
    const planned: Array<{ index: number; dto: LinkEntryDto; storedIn: string }> = []
    for (const v of valid) {
      const owner = table.get(v.ownerId)!
      const repoLabel = this.labelOf(ctx, owner.repoPath)
      if (ctx.readonlyRepos.has(repoKey(owner.repoPath))) {
        errors.push({ index: v.index, code: 'READONLY_REPO', reason: `Le lien serait stocké dans ${repoLabel} (repo de ${owner.id}), en lecture seule.` })
        continue
      }
      const schema = schemas.get(repoKey(owner.repoPath))
      if (schema && owner.objectTypeRef && isRefInReadonlyNode(schema, owner.objectTypeRef)) {
        errors.push({ index: v.index, code: 'READONLY_REPO', reason: `${owner.id} appartient à un composant en lecture seule de ${repoLabel} : il ne peut pas être la source d'un lien.` })
        continue
      }
      planned.push({ index: v.index, dto: v.dto, storedIn: owner.repoPath })
    }
    errors.sort((a, b) => a.index - b.index)
    return { valid: planned, errors }
  }

  /**
   * Écrit les entrées valides d'un lot, groupées par repo de stockage. `createLinks` refait le
   * contrôle de doublon sous verrou, dans le repo de stockage seulement : une entrée devenue
   * doublon entre-temps dans ce repo passe en erreur.
   */
  async createLinks(
    rootRepoPath: string,
    entries: LinkEntryDto[],
    createdBy: string,
    workspaceDir?: string,
    fresh = false,
  ): Promise<{ created: Array<{ index: number; link: WorkspaceLink }>; errors: LinkEntryError[] }> {
    const { valid, errors } = await this.plan(rootRepoPath, entries, workspaceDir, fresh)
    const byRepo = new Map<string, typeof valid>()
    for (const v of valid) pushTo(byRepo, v.storedIn, v)
    const created: Array<{ index: number; link: WorkspaceLink }> = []
    for (const [repo, group] of byRepo) {
      const written = await this.reqIndex.createLinks(repo, group.map((g) => g.dto), createdBy)
      written.forEach((link, i) => {
        const { index, dto } = group[i]
        if (link) created.push({ index, link: { ...link, storedIn: repo, readonly: false } })
        else errors.push({ index, code: 'DUPLICATE_LINK', reason: `Un lien "${dto.type}" relie déjà ${dto.sourceId} et ${dto.targetId} (créé entre-temps).` })
      })
    }
    created.sort((a, b) => a.index - b.index)
    errors.sort((a, b) => a.index - b.index)
    return { created, errors }
  }

  /** Création d'un lien depuis l'UI : lève `LinkWriteError` si l'entrée est refusée. */
  async createLink(rootRepoPath: string, dto: LinkEntryDto, workspaceDir?: string, createdBy = 'user'): Promise<WorkspaceLink> {
    const { created, errors } = await this.createLinks(rootRepoPath, [dto], createdBy, workspaceDir)
    if (errors.length > 0) throw new LinkWriteError(errors[0].code, errors[0].reason)
    return created[0].link
  }

  /** Supprime des liens par id, chacun dans le repo qui le stocke ; repo en lecture seule refusé. */
  async deleteLinks(
    rootRepoPath: string,
    ids: string[],
    workspaceDir?: string,
    dryRun = false,
  ): Promise<{ deleted: WorkspaceLink[]; errors: LinkEntryError[] }> {
    const ctx = await this.context(rootRepoPath, workspaceDir)
    const byId = new Map((await this.collectLinks(ctx, true)).map((l) => [l.id, l]))
    const errors: LinkEntryError[] = []
    const found: Array<{ index: number; link: WorkspaceLink }> = []
    const seen = new Set<string>()
    for (const [index, id] of ids.entries()) {
      const link = byId.get(id)
      if (!link || seen.has(id)) {
        errors.push({ index, code: 'LINK_NOT_FOUND', reason: `Lien "${id}" introuvable${seen.has(id) ? ' (déjà traité dans ce lot)' : ''}.` })
        continue
      }
      seen.add(id)
      if (link.readonly) {
        errors.push({ index, code: 'READONLY_REPO', reason: `Lien "${id}" stocké dans ${this.labelOf(ctx, link.storedIn)}, en lecture seule.` })
        continue
      }
      found.push({ index, link })
    }
    if (dryRun) return { deleted: found.map((f) => f.link), errors }

    const byRepo = new Map<string, typeof found>()
    for (const f of found) pushTo(byRepo, f.link.storedIn, f)
    const deleted: WorkspaceLink[] = []
    for (const [repo, group] of byRepo) {
      // deleteLinks relit le fichier sous verrou : un lien supprimé entre-temps n'est plus là.
      const done = new Set(await this.reqIndex.deleteLinks(repo, group.map((g) => g.link.id)))
      for (const g of group) {
        if (done.has(g.link.id)) deleted.push(g.link)
        else errors.push({ index: g.index, code: 'LINK_NOT_FOUND', reason: `Lien "${g.link.id}" supprimé entre-temps par un autre processus.` })
      }
    }
    errors.sort((a, b) => a.index - b.index)
    return { deleted, errors }
  }

  /** Suppression d'un lien depuis l'UI : lève `LinkWriteError` si refusée. */
  async deleteLink(rootRepoPath: string, linkId: string, workspaceDir?: string): Promise<void> {
    const { errors } = await this.deleteLinks(rootRepoPath, [linkId], workspaceDir)
    if (errors.length > 0) throw new LinkWriteError(errors[0].code, errors[0].reason)
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Repos du workspace, racine d'abord ; dédoublonnés sur le chemin résolu (le repo racine peut
   *  figurer aussi dans l'arbre sous une autre écriture). */
  private async repoPaths(rootRepoPath: string, workspaceDir?: string): Promise<string[]> {
    const seen = new Set<string>()
    const out: string[] = []
    for (const p of await resolveWorkspaceRepoPaths(this.workspaceTree, rootRepoPath, workspaceDir)) {
      const k = repoKey(p)
      if (seen.has(k)) continue
      seen.add(k)
      out.push(p)
    }
    return out
  }

  /**
   * Repos, repos en lecture seule et libellés, lus une fois. Lecture seule : composant épinglé
   * (HEAD détaché, même règle que `isRepoReadonly` du renderer) ou monté sous un nœud `readonly`
   * du repo racine (`RevalidationService`).
   */
  private async context(rootRepoPath: string, workspaceDir?: string): Promise<WorkspaceContext> {
    const [repoPaths, fromSchema, tree] = await Promise.all([
      this.repoPaths(rootRepoPath, workspaceDir),
      this.revalidation?.readonlyRepoPaths(rootRepoPath, workspaceDir) ?? Promise.resolve(new Set<string>()),
      workspaceDir && this.workspaceTree ? this.workspaceTree.readCache(workspaceDir) : Promise.resolve(null),
    ])
    const rootKey = repoKey(rootRepoPath)
    const readonlyRepos = new Set<string>([...fromSchema].map(repoKey))
    const detached = await Promise.all(repoPaths.map(async (p) =>
      repoKey(p) !== rootKey && (await this.git.currentBranch(p).catch(() => '')) === 'HEAD'))
    repoPaths.forEach((p, i) => { if (detached[i]) readonlyRepos.add(repoKey(p)) })
    const labels = new Map<string, string>()
    for (const node of tree?.nodes ?? []) labels.set(repoKey(node.repoPath), node.label || node.name)
    return { rootRepoPath, workspaceDir, repoPaths, readonlyRepos, labels }
  }

  private labelOf(ctx: WorkspaceContext, repoPath: string): string {
    return ctx.labels.get(repoKey(repoPath)) ?? path.basename(repoPath)
  }

  /**
   * Objets des repos donnés, lus en parallèle puis fusionnés racine d'abord : un id présent dans
   * deux repos garde le premier (unicité des préfixes, règle 10 — signalé).
   */
  private async collectObjects(repoPaths: string[], withCampaigns: boolean): Promise<Map<string, ObjectEntry>> {
    const perRepo = await Promise.all(repoPaths.map(async (p): Promise<ObjectEntry[]> => {
      const [reqs, tests, campaigns] = await Promise.all([
        this.reqIndex.findAll(p, {}),
        this.testsIndex.findAll(p),
        withCampaigns && this.campaigns ? this.campaigns.list(p) : Promise.resolve([]),
      ])
      return [
        ...reqs.map((r) => ({ id: r.id, title: r.title, status: r.status, objectTypeRef: r.objectTypeRef, category: 'requirement' as const, repoPath: p })),
        ...tests.map((t) => ({ id: t.id, title: t.title, status: t.status, objectTypeRef: t.objectTypeRef, category: 'test' as const, repoPath: p })),
        ...campaigns.map((c) => ({ id: c.id, title: c.title ?? c.id, status: c.status, objectTypeRef: c.objectTypeRef, category: 'campaign' as const, repoPath: p })),
      ]
    }))
    const table = new Map<string, ObjectEntry>()
    for (const entries of perRepo) {
      for (const o of entries) {
        if (table.has(o.id)) {
          console.warn(`[WorkspaceLinks] ID ${o.id} présent dans plusieurs repos — ${o.repoPath} ignoré`)
          continue
        }
        table.set(o.id, o)
      }
    }
    return table
  }

  /**
   * Table de résolution (exigences, tests, campagnes). Si un id du lot est introuvable, les index
   * sont invalidés (objet créé par un autre process après leur construction) et la table
   * reconstruite une fois.
   */
  private async objectTable(repoPaths: string[], entries: LinkEntryDto[]): Promise<Map<string, ObjectEntry>> {
    let table = await this.collectObjects(repoPaths, true)
    if (entries.some((e) => !table.has(e.sourceId) || !table.has(e.targetId))) {
      for (const p of repoPaths) {
        this.reqIndex.invalidate(p)
        this.testsIndex.invalidate(p)
      }
      table = await this.collectObjects(repoPaths, true)
    }
    return table
  }

  private async collectLinks(ctx: WorkspaceContext, fresh: boolean): Promise<WorkspaceLink[]> {
    const perRepo = await Promise.all(ctx.repoPaths.map((p) => (fresh ? this.reqIndex.reloadLinks(p) : this.reqIndex.findAllLinks(p))))
    const seen = new Set<string>()
    const out: WorkspaceLink[] = []
    perRepo.forEach((links, i) => {
      const p = ctx.repoPaths[i]
      const readonly = ctx.readonlyRepos.has(repoKey(p))
      for (const l of links) {
        if (seen.has(l.id)) continue
        seen.add(l.id)
        out.push({ ...l, storedIn: p, readonly })
      }
    })
    return out
  }

  /** Schéma de chaque repo, par clé de repo (absent si illisible). */
  private async loadSchemas(repoPaths: string[]): Promise<Map<string, ProjectSchema>> {
    const schemas = await Promise.all(repoPaths.map((p) => this.schema.get(p).catch(() => null)))
    const out = new Map<string, ProjectSchema>()
    repoPaths.forEach((p, i) => { if (schemas[i]) out.set(repoKey(p), schemas[i]!) })
    return out
  }

  private unionLinkTypes(repoPaths: string[], schemas: Map<string, ProjectSchema>): WorkspaceLinkTypes {
    const linkTypes: WorkspaceLinkType[] = []
    const declaredBy: Record<string, string[]> = {}
    for (const p of repoPaths) {
      const schema = schemas.get(repoKey(p))
      if (!schema) continue
      for (const { node } of flattenSystemNodes(schema.nodes ?? [])) {
        for (const ot of node.objectTypes ?? []) (declaredBy[`${node.name}::${ot.name}`] ??= []).push(p)
      }
      for (const lt of schema.linkTypes ?? []) {
        if (!lt.name) continue
        const existing = linkTypes.find((t) => t.name === lt.name)
        if (!existing) {
          linkTypes.push({ ...lt, definingRepo: p })
        } else if (existing.definingRepo !== p) {
          console.warn(`[WorkspaceLinks] type de lien "${lt.name}" défini dans ${existing.definingRepo} et ${p} — ${existing.definingRepo} retenu`)
        }
      }
    }
    return { linkTypes, declaredBy }
  }
}
