import type { LinkRefScope, LinkTypeDefinition, LinkWriteErrorCode, ObjectLink } from '@polenta/types'

/**
 * GH16 — validation stricte d'un lot de liens à créer via le serveur MCP
 * (specs/GH16.md §2, specs/GH16-design.md §3.2). Pur : la résolution des objets
 * (lectures disque, workspace) est faite par l'appelant et injectée via `resolve`.
 *
 * GH105 — partagée par le MCP et le chemin IPC de l'UI (`WorkspaceLinksService`) : objets et
 * types de lien du workspace, refs résolues avec le repo de l'objet (`LinkRefScope`).
 */

export type LinkErrorCode = LinkWriteErrorCode

export interface LinkEntryDto {
  type: string
  sourceId: string
  targetId: string
}

export interface LinkEntryError {
  index: number
  code: LinkErrorCode
  reason: string
}

/** Objet résolu par l'appelant pour un ID. La catégorie vient du dossier de stockage
 *  (`requirements/`, `tests/`, `campaigns/`), pas du schéma — cf. GH16-design.md §4.1. */
export interface ResolvedLinkObject {
  id: string
  category: 'requirement' | 'test' | 'campaign'
  objectTypeRef?: string
  /** GH105 — repo qui stocke l'objet ; absent = résolution sans contexte de repo (mono-repo). */
  repoPath?: string
}

/** GH105 — type de lien accompagné, en mode workspace, du repo dont le schéma le définit. */
export type ScopedLinkType = LinkTypeDefinition & { definingRepo?: string }

/**
 * Même règle que `renderer/components/system/linkUtils.ts::matchesRefs` (dupliquée : le
 * main n'importe pas le renderer) — une ref `nœud::type` est comparée à l'`objectTypeRef`,
 * sinon à la catégorie ; une liste vide ou absente accepte tout.
 *
 * GH105 — avec `scope` (mode workspace), une ref `nœud::type` est en plus résolue vers un repo,
 * chaque repo ayant son propre nœud `root` : si le repo qui définit le type de lien déclare
 * lui-même ce type, seuls ses objets correspondent ; sinon, ceux des repos qui le déclarent.
 */
export function matchesRefs(obj: ResolvedLinkObject, refs: string[] | undefined, scope?: LinkRefScope): boolean {
  if (!refs || refs.length === 0) return true
  return refs.some((r) => {
    if (!r.includes('::')) return r === obj.category
    if (r !== obj.objectTypeRef) return false
    if (!scope || obj.repoPath === undefined) return true
    const declaring = scope.declaredBy[r] ?? []
    if (declaring.includes(scope.definingRepo)) return obj.repoPath === scope.definingRepo
    return declaring.length === 0 || declaring.includes(obj.repoPath)
  })
}

/** GH105 — portée de résolution d'un type de lien (absente hors mode workspace). */
export function refScopeOf(lt: ScopedLinkType, declaredBy?: Record<string, string[]>): LinkRefScope | undefined {
  return lt.definingRepo !== undefined && declaredBy ? { definingRepo: lt.definingRepo, declaredBy } : undefined
}

/** Clé non orientée : un lien A→B et un lien B→A du même type sont des doublons. */
function pairKey(type: string, a: string, b: string): string {
  return a < b ? `${type}|${a}|${b}` : `${type}|${b}|${a}`
}

/**
 * Entrée valide. `ownerId` = objet côté `sourceRefs` du type de lien (GH105 : le lien est stocké
 * dans son repo) — `sourceId` si le sens fourni est accepté, sinon `targetId` (le sens fourni est
 * conservé dans le lien).
 */
export interface ValidLinkEntry {
  index: number
  dto: LinkEntryDto
  ownerId: string
}

export function validateLinkEntries(
  linkTypes: ScopedLinkType[],
  entries: LinkEntryDto[],
  resolve: (id: string) => ResolvedLinkObject | null,
  existing: ObjectLink[],
  declaredBy?: Record<string, string[]>,
): { valid: ValidLinkEntry[]; errors: LinkEntryError[] } {
  const valid: ValidLinkEntry[] = []
  const errors: LinkEntryError[] = []

  // Valeur = id du lien existant (cité dans l'erreur), ou null pour une entrée du lot.
  const seen = new Map<string, string | null>()
  for (const l of existing) seen.set(pairKey(l.type, l.sourceId, l.targetId), l.id)

  entries.forEach((dto, index) => {
    const fail = (code: LinkErrorCode, reason: string): void => {
      errors.push({ index, code, reason })
    }

    const lt = linkTypes.find((t) => t.name === dto.type)
    if (!lt) {
      return fail('LINK_TYPE_NOT_FOUND', `Type de lien "${dto.type}" absent de schema.linkTypes.`)
    }
    // GH104 — une liste présente mais vide (dernier type cible supprimé) rend le type de lien
    // invalide, comme `isLinkTypeValid` côté renderer : elle n'accepte rien, jamais « tout ».
    if (lt.sourceRefs?.length === 0 || lt.targetRefs?.length === 0) {
      return fail('LINK_TYPE_INCOMPATIBLE', `Le type "${lt.name}" est invalide : sourceRefs ou targetRefs vide.`)
    }
    if (dto.sourceId === dto.targetId) {
      return fail('SELF_LINK', `Un objet ne peut pas être lié à lui-même (${dto.sourceId}).`)
    }

    const source = resolve(dto.sourceId)
    const target = resolve(dto.targetId)
    if (!source || !target) {
      const missing = [
        !source ? `source "${dto.sourceId}"` : null,
        !target ? `cible "${dto.targetId}"` : null,
      ].filter(Boolean).join(' et ')
      return fail('OBJECT_NOT_FOUND', `Objet introuvable : ${missing}.`)
    }

    const scope = refScopeOf(lt, declaredBy)
    const forward = matchesRefs(source, lt.sourceRefs, scope) && matchesRefs(target, lt.targetRefs, scope)
    const backward = matchesRefs(target, lt.sourceRefs, scope) && matchesRefs(source, lt.targetRefs, scope)
    if (!forward && !backward) {
      return fail(
        'LINK_TYPE_INCOMPATIBLE',
        `Le type "${lt.name}" (sourceRefs: [${(lt.sourceRefs ?? []).join(', ')}], targetRefs: ` +
          `[${(lt.targetRefs ?? []).join(', ')}]) n'accepte pas ${source.id} (${source.category}` +
          `${source.objectTypeRef ? `, ${source.objectTypeRef}` : ''}) ↔ ${target.id} ` +
          `(${target.category}${target.objectTypeRef ? `, ${target.objectTypeRef}` : ''}), dans aucun sens.`,
      )
    }

    const key = pairKey(dto.type, dto.sourceId, dto.targetId)
    if (seen.has(key)) {
      const existingId = seen.get(key)
      return fail(
        'DUPLICATE_LINK',
        existingId
          ? `Un lien "${dto.type}" relie déjà ${dto.sourceId} et ${dto.targetId} (${existingId}).`
          : `Entrée en double dans le lot (${dto.type} ${dto.sourceId} ↔ ${dto.targetId}).`,
      )
    }
    seen.set(key, null)
    valid.push({ index, dto, ownerId: forward ? dto.sourceId : dto.targetId })
  })

  return { valid, errors }
}
