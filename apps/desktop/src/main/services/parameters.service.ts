import * as path from 'path'
import type {
  ObjectTypeDefinition,
  Parameter,
  ParameterDeleteResult,
  ParameterUsage,
  ParameterWriteResult,
  ParametersFile,
  ProjectSchema,
  RepoParameters,
} from '@polenta/types'
import { PARAM_NAME_RE, extractFieldParamRefs, extractTestParamRefs } from '@polenta/types'
import type { GitService } from './git.service'
import type { RequirementsIndexService } from './requirements-index.service'
import type { TestsIndexService } from './tests-index.service'
import type { SchemaService } from './schema.service'
import type { PolentaRepoService } from './polenta-repo.service'
import type { WorkspaceTreeService } from './workspace-tree.service'
import type { RevalidationService } from './revalidation.service'
import { findObjectTypeDef } from './schema-lookup.util'
import { withKeyLock } from './serialize-writes.util'
import { resolveWorkspaceRepoPaths } from './workspace-repos.util'

const PARAMETERS_FILE = 'parameters/parameters.yaml'
const TEXT_FIELD_TYPES = new Set(['text', 'textarea', 'richtext'])

/** Contexte workspace calculé une fois par opération. */
interface WorkspaceCtx {
  /** Repo racine du workspace (repo produit), ou le repo lui-même hors workspace. */
  openedRepoPath: string
  repoPaths: string[]
  /** Nom de montage → repoPath, pour les nœuds de l'arbre workspace. */
  repoByMountName: Map<string, string>
  mountNameByRepo: Map<string, string>
  labelByRepo: Map<string, string>
  readonlyRepos: Set<string>
  workspaceDir?: string
}

/**
 * T171 — base de paramètres : un fichier `parameters/parameters.yaml` par repo (produit ou
 * composant), clés triées, référencé par `{nom}` / `{<nœud>::nom}` dans le texte des exigences
 * et des tests (grammaire unique : `@polenta/types` parameter-refs).
 *
 * - `{nom}` vise la base du repo qui contient l'élément ;
 * - `{<nœud>::nom}` vise la base du composant `<nœud>` **visible** depuis ce repo, c'est-à-dire
 *   déclaré dans ses dépendances `polenta-repo.yaml` (nom de montage, même convention que les
 *   `objectTypeRef` cross-composant). Un nœud local (ou inconnu) n'est pas un composant visible :
 *   la référence reste non résolue.
 *
 * La modification d'un paramètre utilisé par un élément approuvé marque cet élément et ses
 * éléments liés `needsRevalidation` via T172 (spec T171 §9).
 */
export class ParametersService {
  constructor(
    private readonly git: GitService,
    private readonly reqIndex: RequirementsIndexService,
    private readonly testsIndex: TestsIndexService,
    private readonly schema: SchemaService,
    private readonly polentaRepo: PolentaRepoService,
    private readonly revalidation: RevalidationService,
    private readonly workspaceTree?: WorkspaceTreeService,
  ) {}

  // ── Lecture ─────────────────────────────────────────────────────────────────

  /** Base de paramètres d'un repo, triée par nom. Fichier absent → base vide. */
  async read(repoPath: string): Promise<Parameter[]> {
    const file = await this.git.readYaml<Partial<ParametersFile>>(repoPath, PARAMETERS_FILE)
    const raw = file && typeof file.parameters === 'object' && file.parameters ? file.parameters : {}
    return Object.keys(raw).sort().map((name) => {
      const entry = (Object.prototype.hasOwnProperty.call(raw, name) && raw[name] && typeof raw[name] === 'object'
        ? raw[name] : {}) as Partial<Omit<Parameter, 'name'>>
      const p: Parameter = { name, value: entry.value == null ? '' : String(entry.value) }
      if (entry.unit != null && String(entry.unit) !== '') p.unit = String(entry.unit)
      if (entry.description != null && String(entry.description) !== '') p.description = String(entry.description)
      return p
    })
  }

  /** Bases de tous les repos du workspace (repo ouvert en premier). */
  async list(repoPath: string, workspaceDir?: string): Promise<RepoParameters[]> {
    const ctx = await this.workspaceCtx(repoPath, workspaceDir)
    // Un seul parcours de tous les éléments pour compter les utilisations de tous les paramètres.
    const counts = new Map<string, Record<string, number>>()
    await this.forEachReference(ctx, (targetRepo, name) => {
      const byName = counts.get(targetRepo) ?? dict<number>()
      byName[name] = (byName[name] ?? 0) + 1
      counts.set(targetRepo, byName)
    })
    return Promise.all(ctx.repoPaths.map(async (p): Promise<RepoParameters> => {
      const parameters = await this.read(p)
      const byName = counts.get(p) ?? dict<number>()
      const out: RepoParameters = {
        repoPath: p,
        repoName: ctx.mountNameByRepo.get(p) ?? path.basename(p),
        readonly: ctx.readonlyRepos.has(p),
        parameters,
        usageCounts: Object.fromEntries(parameters.map(x => [x.name, byName[x.name] ?? 0])),
      }
      const label = ctx.labelByRepo.get(p) ?? (await this.readSchema(p))?.nodes?.find(n => n.name === 'root')?.label
      if (label) out.label = label
      return out
    }))
  }

  /** Exigences et tests qui référencent le paramètre `name` de la base de `repoPath`, dans tous
   *  les repos du workspace (références locales et cross-composant). */
  async usages(repoPath: string, name: string, workspaceDir?: string): Promise<ParameterUsage[]> {
    const ctx = await this.workspaceCtx(repoPath, workspaceDir)
    return this.findUsages(ctx, repoPath, name)
  }

  // ── Écriture ────────────────────────────────────────────────────────────────

  async create(repoPath: string, param: Parameter, workspaceDir?: string): Promise<ParameterWriteResult> {
    if (!PARAM_NAME_RE.test(param.name ?? '')) {
      throw new Error(`Nom de paramètre invalide : "${param.name}" (caractères autorisés : lettres, chiffres, _ et -)`)
    }
    const ctx = await this.workspaceCtx(repoPath, workspaceDir)
    this.assertWritable(ctx, repoPath)
    await this.mutate(repoPath, (params) => {
      if (params[param.name]) throw new Error(`Le paramètre "${param.name}" existe déjà`)
      params[param.name] = toEntry(param)
    })
    // Création : les références jusque-là non résolues de ce nom changent de texte affiché.
    return { marked: await this.markApprovedUsers(ctx, repoPath, param.name) }
  }

  async update(
    repoPath: string,
    name: string,
    patch: Omit<Parameter, 'name'>,
    workspaceDir?: string,
  ): Promise<ParameterWriteResult> {
    const ctx = await this.workspaceCtx(repoPath, workspaceDir)
    this.assertWritable(ctx, repoPath)
    let textChanged = false
    await this.mutate(repoPath, (params) => {
      const existing = params[name]
      if (!existing) throw new Error(`Le paramètre "${name}" n'existe pas`)
      const next = toEntry({ name, ...patch })
      textChanged = (existing.value ?? '') !== next.value || (existing.unit ?? '') !== (next.unit ?? '')
      params[name] = next
    })
    // Seuls `value`/`unit` changent le texte affiché ; la description seule ne marque rien.
    return { marked: textChanged ? await this.markApprovedUsers(ctx, repoPath, name) : [] }
  }

  /** Refusée tant qu'un élément non terminal référence le paramètre (spec §9). */
  async delete(repoPath: string, name: string, workspaceDir?: string): Promise<ParameterDeleteResult> {
    const ctx = await this.workspaceCtx(repoPath, workspaceDir)
    this.assertWritable(ctx, repoPath)
    const usages = await this.findUsages(ctx, repoPath, name)
    if (usages.some(u => !u.isTerminal)) return { deleted: false, usages }
    await this.mutate(repoPath, (params) => {
      if (!params[name]) throw new Error(`Le paramètre "${name}" n'existe pas`)
      delete params[name]
    })
    return { deleted: true }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Lecture-modification-écriture sérialisée par repo ; clés réécrites triées (diffs stables). */
  private async mutate(repoPath: string, fn: (params: Record<string, Omit<Parameter, 'name'>>) => void): Promise<void> {
    await withKeyLock(`${repoPath}::parameters`, async () => {
      const current = await this.read(repoPath)
      const params = dict<Omit<Parameter, 'name'>>()
      for (const p of current) params[p.name] = toEntry(p)
      fn(params)
      const sorted = dict<Omit<Parameter, 'name'>>()
      for (const key of Object.keys(params).sort()) sorted[key] = params[key]
      await this.git.writeYaml(repoPath, PARAMETERS_FILE, { parameters: sorted } satisfies ParametersFile)
    })
  }

  private assertWritable(ctx: WorkspaceCtx, repoPath: string): void {
    if (ctx.readonlyRepos.has(repoPath)) {
      throw new Error(`Repo en lecture seule : paramètres non modifiables (${repoPath})`)
    }
  }

  /** Marque (T172, `includeSelf`) chaque utilisateur approuvé non terminal du paramètre. */
  private async markApprovedUsers(ctx: WorkspaceCtx, repoPath: string, name: string) {
    const usages = await this.findUsages(ctx, repoPath, name)
    const marked: ParameterWriteResult['marked'] = []
    const seen = new Set<string>()
    for (const u of usages) {
      if (!u.isApproval || u.isTerminal || seen.has(u.elementId)) continue
      seen.add(u.elementId)
      const done = await this.revalidation.markImpactedBy(ctx.openedRepoPath, u.elementId, ctx.workspaceDir, { includeSelf: true })
      marked.push(...done)
    }
    return marked
  }

  private async findUsages(ctx: WorkspaceCtx, paramRepo: string, name: string): Promise<ParameterUsage[]> {
    const usages: ParameterUsage[] = []
    const seen = new Set<string>()
    await this.forEachReference(ctx, (targetRepo, refName, el) => {
      if (targetRepo !== paramRepo || refName !== name) return
      const id = `${el.repoPath}::${el.id}`
      if (seen.has(id)) return
      seen.add(id)
      usages.push(toUsage(el.id, el.category, el.title, el.status, el.typeDef, el.repoPath, el.key))
    })
    return usages.sort((a, b) => a.elementId.localeCompare(b.elementId))
  }

  /**
   * Parcourt chaque référence de paramètre de chaque exigence et test de tous les repos du
   * workspace, et la résout vers (repo de la base visée, nom). Une référence `{nœud::nom}` vers
   * un nœud non visible depuis le repo de l'élément est ignorée (non résolue). Champs scannés :
   * exigences → champs text/textarea/richtext du type (tous les champs chaîne si le type n'est
   * pas résolvable) ; tests → preconditions, étapes (action, expectedResult), postconditions.
   */
  private async forEachReference(
    ctx: WorkspaceCtx,
    visit: (targetRepo: string, name: string, el: {
      id: string; category: 'requirement' | 'test'; title: string; status: string
      typeDef: ObjectTypeDefinition | null; repoPath: string; key: string
    }) => void,
  ): Promise<void> {
    for (const r of ctx.repoPaths) {
      const schema = await this.readSchema(r)
      const visible = await this.visibleComponents(ctx, r)
      const target = (key: string): [string, string] | null => {
        const i = key.indexOf('::')
        if (i === -1) return [r, key]
        const repo = visible.get(key.slice(0, i))
        return repo ? [repo, key.slice(i + 2)] : null
      }
      for (const req of await this.reqIndex.findAll(r)) {
        const typeDef = resolveTypeDef(schema, req.objectTypeRef)
        const fieldNames = typeDef
          ? (typeDef.fields ?? []).filter(f => TEXT_FIELD_TYPES.has(f.type)).map(f => f.name)
          : Object.keys(req.fields ?? {})
        for (const key of extractFieldParamRefs(req.fields, fieldNames)) {
          const t = target(key)
          if (t) visit(t[0], t[1], { id: req.id, category: 'requirement', title: req.title, status: req.status, typeDef, repoPath: r, key })
        }
      }
      for (const tc of await this.testsIndex.findAll(r)) {
        const typeDef = resolveTypeDef(schema, tc.objectTypeRef)
        for (const key of extractTestParamRefs(tc)) {
          const t = target(key)
          if (t) visit(t[0], t[1], { id: tc.id, category: 'test', title: tc.title, status: tc.status, typeDef, repoPath: r, key })
        }
      }
    }
  }

  /** Composants visibles depuis `repoPath` : ses dépendances `polenta-repo.yaml` montées dans
   *  le workspace (nom de montage → repoPath). */
  private async visibleComponents(ctx: WorkspaceCtx, repoPath: string): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const manifest = await this.polentaRepo.readManifest(repoPath).catch(() => null)
    for (const dep of manifest?.dependencies ?? []) {
      const repo = ctx.repoByMountName.get(dep.name)
      if (repo) out.set(dep.name, repo)
    }
    return out
  }

  private async workspaceCtx(repoPath: string, workspaceDir?: string): Promise<WorkspaceCtx> {
    const tree = workspaceDir && this.workspaceTree ? await this.workspaceTree.readCache(workspaceDir) : null
    const openedRepoPath = tree?.logicalTree?.repoPath ?? repoPath
    const repoPaths = await resolveWorkspaceRepoPaths(this.workspaceTree, openedRepoPath, workspaceDir)
    if (!repoPaths.includes(repoPath)) repoPaths.push(repoPath)
    const repoByMountName = new Map<string, string>()
    const mountNameByRepo = new Map<string, string>()
    const labelByRepo = new Map<string, string>()
    for (const n of tree?.nodes ?? []) {
      repoByMountName.set(n.name, n.repoPath)
      mountNameByRepo.set(n.repoPath, n.name)
      if (n.label) labelByRepo.set(n.repoPath, n.label)
    }
    const ctx: WorkspaceCtx = {
      openedRepoPath,
      repoPaths,
      repoByMountName,
      mountNameByRepo,
      labelByRepo,
      readonlyRepos: await this.revalidation.readonlyRepoPaths(openedRepoPath, workspaceDir),
      workspaceDir,
    }
    return ctx
  }

  private async readSchema(repoPath: string): Promise<ProjectSchema | null> {
    try {
      return await this.schema.get(repoPath)
    } catch {
      return null
    }
  }
}

/** Dictionnaire sans prototype : un nom de paramètre valide peut être `constructor`,
 *  `toString`… (grammaire PARAM_NAME_RE), qui ne doit pas rencontrer Object.prototype. */
function dict<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

function toEntry(p: Parameter | (Omit<Parameter, 'name'> & { name: string })): Omit<Parameter, 'name'> {
  const entry: Omit<Parameter, 'name'> = { value: p.value == null ? '' : String(p.value) }
  if (p.unit != null && String(p.unit).trim() !== '') entry.unit = String(p.unit).trim()
  if (p.description != null && String(p.description).trim() !== '') entry.description = String(p.description).trim()
  return entry
}

function resolveTypeDef(schema: ProjectSchema | null, objectTypeRef: string): ObjectTypeDefinition | null {
  if (!schema) return null
  const resolved = findObjectTypeDef(schema, objectTypeRef)
  return resolved && resolved !== 'unresolvable' ? resolved : null
}

function toUsage(
  elementId: string,
  category: 'requirement' | 'test',
  title: string,
  status: string,
  typeDef: ObjectTypeDefinition | null,
  repoPath: string,
  ref: string,
): ParameterUsage {
  const statusDef = typeDef?.statuses?.find(s => s.name === status)
  return {
    elementId,
    category,
    title,
    status,
    // Type non résolvable : repli sur les noms de statuts conventionnels.
    isApproval: statusDef ? !!statusDef.isApproval : status === 'approved',
    isTerminal: statusDef ? !!statusDef.isTerminal : status === 'obsolete',
    repoPath,
    ref,
  }
}
