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
