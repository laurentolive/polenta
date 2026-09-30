import type { LinkTypeDefinition, ObjectLink } from '@polenta/types'

/**
 * GH16 — validation stricte d'un lot de liens à créer via le serveur MCP
 * (specs/GH16.md §2, specs/GH16-design.md §3.2). Pur : la résolution des objets
 * (lectures disque, workspace) est faite par l'appelant et injectée via `resolve`.
 *
 * Garde de la seule surface MCP : le chemin IPC de l'UI (`requirements:link-create`)
 * ne valide rien, l'UI filtrant en amont ses candidats (`linkUtils.ts`).
 */

export type LinkErrorCode =
  | 'LINK_TYPE_NOT_FOUND'
  | 'SELF_LINK'
  | 'OBJECT_NOT_FOUND'
  | 'LINK_TYPE_INCOMPATIBLE'
  | 'DUPLICATE_LINK'
  | 'LINK_NOT_FOUND'

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
}

/**
 * Même règle que `renderer/components/system/linkUtils.ts::matchesRefs` (dupliquée : le
 * main n'importe pas le renderer) — une ref `nœud::type` est comparée à l'`objectTypeRef`,
 * sinon à la catégorie ; une liste vide ou absente accepte tout.
 */
export function matchesRefs(obj: ResolvedLinkObject, refs: string[] | undefined): boolean {
  if (!refs || refs.length === 0) return true
  return refs.some((r) => (r.includes('::') ? r === obj.objectTypeRef : r === obj.category))
}

/** Clé non orientée : un lien A→B et un lien B→A du même type sont des doublons. */
function pairKey(type: string, a: string, b: string): string {
  return a < b ? `${type}|${a}|${b}` : `${type}|${b}|${a}`
}

export function validateLinkEntries(
  linkTypes: LinkTypeDefinition[],
  entries: LinkEntryDto[],
  resolve: (id: string) => ResolvedLinkObject | null,
  existing: ObjectLink[],
): { valid: Array<{ index: number; dto: LinkEntryDto }>; errors: LinkEntryError[] } {
  const valid: Array<{ index: number; dto: LinkEntryDto }> = []
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

    const forward = matchesRefs(source, lt.sourceRefs) && matchesRefs(target, lt.targetRefs)
    const backward = matchesRefs(target, lt.sourceRefs) && matchesRefs(source, lt.targetRefs)
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
    valid.push({ index, dto })
  })

  return { valid, errors }
}
