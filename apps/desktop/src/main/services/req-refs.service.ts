import type { ObjectLink, ProjectSchema, Requirement } from '@polenta/types'
import { REQ_REF_SYSTEM_FIELDS } from '@polenta/types'
import type { GitService } from './git.service'
import type { RequirementsIndexService } from './requirements-index.service'
import type { SchemaService } from './schema.service'
import { findObjectTypeDef } from './schema-lookup.util'
import { matchCoverageLink } from './traceability.service'

const SYSTEM_FIELD_SET = new Set<string>(REQ_REF_SYSTEM_FIELDS)

export interface SourcedRequirement {
  req: Requirement
  repoPath: string
}

/** Exigences et liens de tous les repos du workspace, à l'état courant ou à un tag. */
export interface ReqRefSource {
  requirements: Map<string, SourcedRequirement & { terminal: boolean }>
  links: ObjectLink[]
  /** Repos où le tag est introuvable (lecture au tag seulement). */
  tagMissingRepos: Set<string>
  /** Tous les repos lus, pour distinguer « tag introuvable partout ». */
  repoPaths: string[]
}

/**
 * T179 — exigences liées à un test pour les références `{req.<champ>}` : même définition du lien
 * de couverture que la matrice (`matchCoverageLink`, les deux sens, tout type), exigences
 * terminales exclues, liens orphelins ignorés.
 */
export class ReqRefsService {
  constructor(
    private readonly git: GitService,
    private readonly reqIndex: RequirementsIndexService,
    private readonly schema: SchemaService,
  ) {}

  /** Lit exigences et liens de `repoPaths` : au tag `tag` (sans repli sur l'état courant, champs
   *  dérivés pris sur l'historique jusqu'au tag), sinon à l'état courant (index). */
  async loadSource(repoPaths: string[], tag?: string): Promise<ReqRefSource> {
    const source: ReqRefSource = { requirements: new Map(), links: [], tagMissingRepos: new Set(), repoPaths }
    await Promise.all(repoPaths.map(async (repoPath) => {
      const loaded = tag ? await this.readAtTag(repoPath, tag) : await this.readCurrent(repoPath)
      if (!loaded) { source.tagMissingRepos.add(repoPath); return }
      const schema = await this.schema.get(repoPath).catch((): ProjectSchema | null => null)
      for (const req of loaded.requirements) {
        // Un id en double sur le workspace : le premier repo lu l'emporte (préfixes uniques en pratique).
        if (source.requirements.has(req.id)) continue
        source.requirements.set(req.id, { req, repoPath, terminal: isTerminal(schema, req) })
      }
      source.links.push(...loaded.links)
    }))
    return source
  }

  /** Exigences non terminales liées au test, sans doublon, triées par ID (ordre naturel). */
  linkedRequirements(source: ReqRefSource, testId: string): SourcedRequirement[] {
    const tcIds = new Set([testId])
    const reqIds = new Set(source.requirements.keys())
    const found = new Map<string, SourcedRequirement>()
    for (const link of source.links) {
      const match = matchCoverageLink(link, tcIds, reqIds)
      if (!match) continue
      const entry = source.requirements.get(match.reqId)
      if (!entry || entry.terminal) continue
      found.set(match.reqId, { req: entry.req, repoPath: entry.repoPath })
    }
    return [...found.values()].sort((a, b) => a.req.id.localeCompare(b.req.id, undefined, { numeric: true }))
  }

  private async readCurrent(repoPath: string): Promise<{ requirements: Requirement[]; links: ObjectLink[] }> {
    const [requirements, links] = await Promise.all([
      this.reqIndex.findAll(repoPath),
      this.reqIndex.findAllLinks(repoPath),
    ])
    return { requirements, links }
  }

  private async readAtTag(repoPath: string, tag: string): Promise<{ requirements: Requirement[]; links: ObjectLink[] } | null> {
    const oid = await this.git.resolveTagOid(repoPath, tag)
    if (!oid) return null
    const [files, linksData, history] = await Promise.all([
      this.git.listFilesAtRef(repoPath, oid, 'requirements').catch(() => [] as string[]),
      this.git.readYamlRef<{ links?: ObjectLink[] }>(repoPath, oid, 'links/links.yaml'),
      this.git.fileHistoryMap(repoPath, 'requirements', oid),
    ])
    const requirements: Requirement[] = []
    await Promise.all(files.filter(f => f.endsWith('.yaml')).map(async (file) => {
      const req = await this.git.readYamlRef<Requirement>(repoPath, oid, file)
      if (!req?.id) return
      const h = history.get(file)
      requirements.push({
        ...req,
        createdAt: h?.createdAt ?? null,
        createdBy: h?.createdBy ?? null,
        updatedAt: h?.updatedAt ?? null,
        updatedBy: h?.updatedBy ?? null,
      } as Requirement)
    }))
    return { requirements, links: linksData?.links ?? [] }
  }
}

/** Valeur brute du champ `<champ>` d'une exigence : champ système/dérivé, sinon champ
 *  personnalisé ; `undefined` si le champ n'existe pas. `needsRevalidation` absent vaut `false`. */
export function reqFieldValue(req: Requirement, field: string): unknown {
  if (SYSTEM_FIELD_SET.has(field)) {
    if (field === 'needsRevalidation') return !!req.needsRevalidation
    // Lien Jira : sa clé (PROJ-123), plus lisible dans un test qu'un objet sérialisé.
    if (field === 'jiraLinks') return (req.jiraLinks ?? []).map(l => l?.key)
    return (req as unknown as Record<string, unknown>)[field]
  }
  const fields = (req.fields ?? {}) as Record<string, unknown>
  return Object.prototype.hasOwnProperty.call(fields, field) ? fields[field] : undefined
}

function isTerminal(schema: ProjectSchema | null, req: Requirement): boolean {
  const resolved = schema ? findObjectTypeDef(schema, req.objectTypeRef) : null
  const typeDef = resolved && resolved !== 'unresolvable' ? resolved : null
  const statusDef = typeDef?.statuses?.find(s => s.name === req.status)
  // Type non résolvable : repli sur le nom de statut conventionnel (comme T171).
  return statusDef ? !!statusDef.isTerminal : req.status === 'obsolete'
}
