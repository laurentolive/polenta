import type { LinkTypeDefinition, ObjectLink } from '@polenta/types'
import type { Candidate } from './LinkCombobox'

export function matchesRefs(objectTypeRef: string, refs: string[] | undefined, category: string | undefined): boolean {
  if (!refs || refs.length === 0) return true
  return refs.some(r => r.includes('::') ? r === objectTypeRef : r === category)
}

export function filterCandidatesByRefs(candidates: Candidate[], refs: string[] | undefined): Candidate[] {
  if (!refs || refs.length === 0) return candidates
  return candidates.filter(c => refs.some(r =>
    r.includes('::') ? r === c.objectTypeRef : r === c.category
  ))
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
