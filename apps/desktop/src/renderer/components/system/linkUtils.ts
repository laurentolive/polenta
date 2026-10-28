import type { LinkTypeDefinition, LinkWriteErrorCode, ObjectLink } from '@polenta/types'
import type { Candidate } from './LinkCombobox'

/** GH105 — clé de comparaison d'un chemin de repo (`c:\…` / `C:/…` selon la source). */
export function normRepoPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * GH105 — contexte de résolution des refs d'un type de lien sur le workspace : repo qui définit
 * le type, et repos qui déclarent chaque `<nœud>::<type>` (`api.links.types`).
 */
export interface CandidateRefScope {
  definingRepo: string
  declaredBy: Record<string, string[]>
}

// Règle dupliquée côté main dans `main/services/link-validation.util.ts` (GH16, serveur MCP) — garder les deux alignées.
export function matchesRefs(objectTypeRef: string, refs: string[] | undefined, category: string | undefined): boolean {
  if (!refs || refs.length === 0) return true
  return refs.some(r => r.includes('::') ? r === objectTypeRef : r === category)
}

/**
 * Candidats compatibles avec les refs. GH105 — avec `scope`, une ref `<nœud>::<type>` est aussi
 * résolue vers un repo (chaque repo a un nœud `root`) : si le repo qui définit le type de lien
 * déclare lui-même ce type, seuls ses objets ; sinon ceux des repos qui le déclarent. Même règle
 * que `matchesRefs` côté main (`link-validation.util.ts`).
 */
export function filterCandidatesByRefs(candidates: Candidate[], refs: string[] | undefined, scope?: CandidateRefScope): Candidate[] {
  if (!refs || refs.length === 0) return candidates
  return candidates.filter(c => refs.some(r => {
    if (!r.includes('::')) return r === c.category
    if (r !== c.objectTypeRef) return false
    if (!scope || !c.repoPath) return true
    const declaring = (scope.declaredBy[r] ?? []).map(normRepoPath)
    const repo = normRepoPath(c.repoPath)
    if (declaring.includes(normRepoPath(scope.definingRepo))) return repo === normRepoPath(scope.definingRepo)
    return declaring.length === 0 || declaring.includes(repo)
  }))
}

export function getLinkTypeLabel(
  lt: LinkTypeDefinition,
  objectTypeRef: string | undefined,
  category: string | undefined
): string {
  const canBeSource = matchesRefs(objectTypeRef ?? '', lt.sourceRefs, category)
  return canBeSource ? lt.labelSourceToTarget : lt.labelTargetToSource
}

export function getRelevantLinkTypes(
  linkTypes: LinkTypeDefinition[],
  objectTypeRef: string | undefined,
  category: string | undefined
): Array<{ lt: LinkTypeDefinition; canBeSource: boolean; canBeTarget: boolean }> {
  return linkTypes
    .map(lt => ({
      lt,
      canBeSource: matchesRefs(objectTypeRef ?? '', lt.sourceRefs, category),
      canBeTarget: matchesRefs(objectTypeRef ?? '', lt.targetRefs, category),
    }))
    .filter(({ canBeSource, canBeTarget }) => canBeSource || canBeTarget)
}

/** GH137 — sens d'une colonne de lien de la vue tableau : `both` = colonne unique `link::<type>`
 *  (le type affiché n'est que d'un côté du lien), `out` / `in` = colonnes `link-out::` / `link-in::`
 *  d'un type à la fois source et cible. */
export type LinkColumnDirection = 'both' | 'out' | 'in'

const LINK_COLUMN_PREFIXES: Array<[string, LinkColumnDirection]> = [['link::', 'both'], ['link-out::', 'out'], ['link-in::', 'in']]

/** Type de lien et sens d'une clé de colonne, `null` si ce n'est pas une colonne de lien. */
export function parseLinkColumn(key: string): { typeName: string; direction: LinkColumnDirection } | null {
  for (const [prefix, direction] of LINK_COLUMN_PREFIXES) {
    if (key.startsWith(prefix)) return { typeName: key.slice(prefix.length), direction }
  }
  return null
}

export function isLinkColumn(key: string): boolean {
  return parseLinkColumn(key) !== null
}

/** Clés de colonne proposées pour `lt` dans la vue tableau du type affiché. */
export function linkColumnKeys(lt: LinkTypeDefinition, objectTypeRef: string | undefined, category: string | undefined): string[] {
  const canBeSource = matchesRefs(objectTypeRef ?? '', lt.sourceRefs, category)
  const canBeTarget = matchesRefs(objectTypeRef ?? '', lt.targetRefs, category)
  return canBeSource && canBeTarget ? [`link-out::${lt.name}`, `link-in::${lt.name}`] : [`link::${lt.name}`]
}

/** Titre d'une colonne de lien : libellé du sens (`link::` garde la règle de `getLinkTypeLabel`). */
export function linkColumnLabel(
  lt: LinkTypeDefinition, direction: LinkColumnDirection, objectTypeRef: string | undefined, category: string | undefined,
): string {
  if (direction === 'out') return lt.labelSourceToTarget
  if (direction === 'in') return lt.labelTargetToSource
  return getLinkTypeLabel(lt, objectTypeRef, category)
}

/**
 * GH137 — normalise les colonnes de lien d'une liste de champs visibles pour le type affiché, sans
 * rien réécrire : `link::<type>` d'un type « deux sens » vaut ses deux colonnes de sens (à sa place,
 * sortants puis entrants) ; `link-out::` / `link-in::` d'un type redevenu « un sens » vaut `link::`.
 * Type de lien inconnu : clé laissée telle quelle. Sans doublon.
 */
export function normalizeLinkColumns(
  fields: string[], linkTypes: LinkTypeDefinition[], objectTypeRef: string | undefined, category: string | undefined,
): string[] {
  const out: string[] = []
  for (const f of fields) {
    const parsed = parseLinkColumn(f)
    const lt = parsed && linkTypes.find(l => l.name === parsed.typeName)
    const keys = !lt
      ? [f]
      : parsed!.direction === 'both' ? linkColumnKeys(lt, objectTypeRef, category)
        : linkColumnKeys(lt, objectTypeRef, category).length === 2 ? [f] : [`link::${lt.name}`]
    for (const k of keys) if (!out.includes(k)) out.push(k)
  }
  return out
}

export function getPeerId(link: ObjectLink, objectId: string): string {
  return link.sourceId === objectId ? link.targetId : link.sourceId
}

export function isLinkTypeValid(lt: LinkTypeDefinition): boolean {
  return (lt.sourceRefs?.length ?? 0) > 0 && (lt.targetRefs?.length ?? 0) > 0
}

const LINK_ERROR_CODES: LinkWriteErrorCode[] = [
  'LINK_TYPE_NOT_FOUND', 'SELF_LINK', 'OBJECT_NOT_FOUND', 'LINK_TYPE_INCOMPATIBLE',
  'DUPLICATE_LINK', 'LINK_NOT_FOUND', 'READONLY_REPO',
]

/**
 * GH105 — code et motif d'une erreur d'écriture de lien. Le main lève `LinkWriteError`
 * (`READONLY_REPO: <motif>`) ; l'IPC Electron préfixe le message (`Error invoking remote method
 * '…': Error: …`), le client web le transmet tel quel — le code est cherché n'importe où.
 */
export function parseLinkError(err: unknown): { code: LinkWriteErrorCode | null; reason: string } {
  const message = err instanceof Error ? err.message : String(err)
  for (const code of LINK_ERROR_CODES) {
    const i = message.indexOf(`${code}: `)
    if (i >= 0) return { code, reason: message.slice(i + code.length + 2) }
  }
  return { code: null, reason: message }
}
