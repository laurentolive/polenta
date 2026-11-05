import type { TransitionIssue } from '@polenta/types'

/**
 * GH206 — notifications des contraintes de transition, affichées par `TransitionNoticeHost` (racine de
 * l'appli). Un passage notifié (`transitionWarnings` d'une réponse) ne demande aucune confirmation ;
 * un refus (`TRANSITION_BLOCKED`) s'affiche de la même façon, en erreur.
 */
export interface TransitionNotice {
  id: number
  kind: 'warning' | 'blocked'
  objectId?: string
  messages: string[]
}

type Listener = (notice: TransitionNotice) => void
const listeners = new Set<Listener>()
let nextId = 1

export function subscribeTransitionNotices(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function emit(notice: Omit<TransitionNotice, 'id'>): void {
  const full = { ...notice, id: nextId++ }
  for (const l of listeners) l(full)
}

/** Réponse d'une écriture : notifie ses `transitionWarnings`, s'il y en a. */
export function notifyTransitionResult(result: unknown, objectId?: string): void {
  const warnings = (result as { transitionWarnings?: TransitionIssue[] } | null | undefined)?.transitionWarnings
  if (warnings?.length) emit({ kind: 'warning', objectId, messages: warnings.map(w => w.message) })
}

const BLOCKED = 'TRANSITION_BLOCKED:'

/** Motifs d'un refus `TRANSITION_BLOCKED`, ou null pour une autre erreur. */
export function transitionBlockedMessages(err: unknown): string[] | null {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const at = message.indexOf(BLOCKED)
  if (at < 0) return null
  return message.slice(at + BLOCKED.length).split(' ; ').map(m => m.trim()).filter(Boolean)
}

/** Erreur d'écriture : notifie un refus de transition ; renvoie false pour toute autre erreur. */
export function notifyTransitionError(err: unknown, objectId?: string): boolean {
  const messages = transitionBlockedMessages(err)
  if (!messages) return false
  emit({ kind: 'blocked', objectId, messages })
  return true
}
