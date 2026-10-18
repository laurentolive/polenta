import type { LinkTypeDefinition, ObjectLink } from '@polenta/types'
import { LinkCombobox, type Candidate, type ExistingLinkChip } from './LinkCombobox'
import { filterCandidatesByRefs, getPeerId, matchesRefs } from './linkUtils'
import { isSameRepo, useWorkspaceLinksContext, type WorkspaceLinks } from '../../hooks/useWorkspaceLinks'
import { api } from '../../api'

/**
 * Sens affichés d'un type de lien pour un objet. Toujours afficher les liens existants, même dans
 * le sens non canonique pour le schéma actuel (ex. schéma modifié après coup) — sinon un lien créé
 * avant un changement de sourceRefs/targetRefs devient invisible et impossible à délier. La
 * création reste limitée au sens déclaré (`canBeSource` / `canBeTarget`).
 */
export function linkTypeVisibility(lt: LinkTypeDefinition, objectId: string, objectTypeRef: string, category: string | undefined, objectLinks: ObjectLink[]) {
  const links = objectLinks.filter(l => l.type === lt.name)
  const outgoing = links.filter(l => l.sourceId === objectId)
  const incoming = links.filter(l => l.targetId === objectId)
  const canBeSource = matchesRefs(objectTypeRef, lt.sourceRefs, category)
  const canBeTarget = matchesRefs(objectTypeRef, lt.targetRefs, category)
  return {
    outgoing, incoming, canBeSource, canBeTarget,
    showOutgoing: canBeSource || outgoing.length > 0,
    showIncoming: canBeTarget || incoming.length > 0,
  }
}

/**
 * GH105 — éditeur des liens d'un objet pour un type de lien (sortants et/ou entrants), partagé par
 * les vues Édition, Excel et Word. Avec le contexte `useWorkspaceLinks` (vue Système, recherche) :
 * candidats de tout le workspace filtrés par repo, pastilles résolues (titre, repo, introuvable,
 * lecture seule), écriture côté source. Sans contexte : comportement antérieur (repo courant).
 */
export function LinkTypeEditor({
  lt,
  objectId,
  objectTypeRef,
  category,
  objectLinks,
  repoPath,
  candidates,
  direction = 'both',
  onLinkChange,
  onNavigateToObject,
  autoFocus,
}: {
  lt: LinkTypeDefinition
  objectId: string
  objectTypeRef: string
  category: string | undefined
  /** Liens de l'objet (tous types : filtrés ici). */
  objectLinks: ObjectLink[]
  /** Repo de l'objet édité. */
  repoPath?: string
  /** Candidats sans contexte workspace (appelants historiques). */
  candidates: Candidate[]
  direction?: 'both' | 'out' | 'in'
  /** Après une écriture, sans contexte workspace (le contexte invalide lui-même ses requêtes). */
  onLinkChange?: () => void
  onNavigateToObject?: (peerId: string, opts?: { newTab?: boolean }) => void
  autoFocus?: boolean
}) {
  const ws = useWorkspaceLinksContext()
  const v = linkTypeVisibility(lt, objectId, objectTypeRef, category, objectLinks)
  const showOutgoing = direction !== 'in' && v.showOutgoing
  const showIncoming = direction !== 'out' && v.showIncoming

  const scope = ws?.scopeOf(lt)
  const pool = ws ? ws.candidates : candidates
  // Objet édité dans un repo en lecture seule : il ne peut pas être la source d'un nouveau lien.
  const selfReadonly = ws?.objectsById.get(objectId)?.readonly ?? false
  // L'objet édité est la cible : le candidat serait la source, le lien serait écrit dans son repo.
  const sourceCandidates = filterCandidatesByRefs(pool, lt.sourceRefs, scope).filter(c => !c.readonly)
  const targetCandidates = selfReadonly ? [] : filterCandidatesByRefs(pool, lt.targetRefs, scope)

  const chip = (l: ObjectLink): ExistingLinkChip => describeLink(l, objectId, repoPath, ws)

  const add = async (sourceId: string, targetId: string) => {
    if (ws) return ws.createLink(lt.name, sourceId, targetId)
    if (repoPath) await api.requirements.linkCreate(repoPath, { type: lt.name, sourceId, targetId })
    onLinkChange?.()
  }
  const remove = async (linkId: string) => {
    if (ws) return ws.deleteLink(linkId)
    if (repoPath) await api.requirements.linkDelete(repoPath, linkId)
    onLinkChange?.()
  }

  return (
    <>
      {showOutgoing && (
        <LinkCombobox
          label={lt.labelSourceToTarget}
          existingLinks={v.outgoing.map(chip)}
          candidates={v.canBeSource ? targetCandidates : []}
          onAdd={peerId => add(objectId, peerId)}
          onRemove={remove}
          onNavigateToObject={onNavigateToObject}
          autoFocus={autoFocus}
        />
      )}
      {showIncoming && (
        <LinkCombobox
          label={lt.labelTargetToSource}
          existingLinks={v.incoming.map(chip)}
          candidates={v.canBeTarget ? sourceCandidates : []}
          onAdd={peerId => add(peerId, objectId)}
          onRemove={remove}
          onNavigateToObject={onNavigateToObject}
          autoFocus={autoFocus}
        />
      )}
    </>
  )
}

/** Pastille d'un lien : objet lié résolu sur le workspace, repo de stockage en lecture seule. */
export function describeLink(link: ObjectLink, objectId: string, repoPath: string | undefined, ws: WorkspaceLinks | null): ExistingLinkChip {
  const peerId = getPeerId(link, objectId)
  if (!ws) return { linkId: link.id, peerId }
  const peer = ws.objectsById.get(peerId)
  const stored = ws.linksById.get(link.id)
  return {
    linkId: link.id,
    peerId,
    peerTitle: peer?.title,
    peerRepoLabel: peer && !isSameRepo(peer.repoPath, repoPath) ? peer.repoLabel : undefined,
    missing: ws.objectsLoaded && !peer,
    readonly: stored?.readonly ?? false,
    storedInLabel: stored ? (ws.repoLabelOf(stored.storedIn) ?? stored.storedIn) : undefined,
  }
}
