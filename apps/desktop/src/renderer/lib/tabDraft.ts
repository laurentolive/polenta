import { useEffect, useRef } from 'react'

/**
 * GH343 (D1) — saisie non sauvegardée qui suit un onglet glissé dans une autre fenêtre.
 *
 * Seule la page de l'onglet actif est montée : un éditeur au plus déclare sa saisie à la fois
 * (`useTabDraft`). Au départ du glisser, `captureActiveDraft` la lit (JSON) ; à l'arrivée,
 * `stageIncomingDraft` la met en attente, et l'éditeur de même clé la reprend une seule fois quand
 * ses données sont prêtes (`takeStagedDraft`, ou la restauration de `useTabDraft`). La clé identifie
 * éditeur + objet (`form:<repo>::<id>`, `schema:<repo>`…) : une autre page ne la reprend jamais.
 * Fenêtre d'arrivée déjà sur la même page (pas de remontage) : la saisie est remise directement à
 * l'éditeur affiché.
 *
 * État du module = état du renderer, donc propre à chaque fenêtre.
 */

interface Registration {
  key: string
  snapshot: () => unknown
  restore?: (state: unknown) => void
  isReady: () => boolean
}

let active: Registration | null = null
let staged: { key: string; state: unknown } | null = null

/** Saisie de l'éditeur de la page affichée, `undefined` s'il n'y a rien à transférer. */
export function captureActiveDraft(): { key: string; state: unknown } | undefined {
  if (!active) return undefined
  const state = active.snapshot()
  if (state === null || state === undefined) return undefined
  // Copie JSON : rien de vivant (fonctions, Map) ne part, et la taille est connue du main.
  return { key: active.key, state: JSON.parse(JSON.stringify(state)) }
}

/** Saisie reçue avec un onglet : remise à l'éditeur affiché s'il est déjà le bon, sinon en attente. */
export function stageIncomingDraft(draft: { key: string; state: unknown } | undefined): void {
  if (draft && active && active.key === draft.key && active.restore && active.isReady()) {
    staged = null
    active.restore(draft.state)
    return
  }
  staged = draft ?? null
}

/** Saisie en attente pour cette clé, une seule fois. */
export function takeStagedDraft<T>(key: string): T | undefined {
  if (!staged || staged.key !== key) return undefined
  const { state } = staged
  staged = null
  return state as T
}

/** Test seulement. */
export function resetTabDraftsForTest(): void {
  active = null
  staged = null
}

/** Déclaration d'un éditeur (utilisée par `useTabDraft`) ; retourne son retrait. */
export function registerTabDraft(
  key: string,
  snapshot: () => unknown,
  restore?: (state: unknown) => void,
  isReady: () => boolean = () => true,
): () => void {
  const registration: Registration = { key, snapshot, restore, isReady }
  active = registration
  // Une autre page s'est affichée : la saisie en attente ne la concerne pas (navigation suivante).
  if (staged && staged.key !== key) staged = null
  return () => { if (active === registration) active = null }
}

/**
 * Déclare la saisie transférable de l'éditeur de la page. `snapshot` : saisie en cours, ou `null`
 * sans modification. `restore` (facultatif) : appelé une fois, quand `ready`, avec la saisie reçue
 * d'une autre fenêtre pour la même clé. `key` `null` : rien à déclarer (données pas encore lues).
 */
export function useTabDraft<T>(
  key: string | null,
  snapshot: () => T | null,
  restore?: (state: T) => void,
  ready = true,
): void {
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot
  const restoreRef = useRef(restore)
  restoreRef.current = restore
  const readyRef = useRef(ready)
  readyRef.current = ready

  useEffect(() => {
    if (!key) return
    return registerTabDraft(
      key,
      () => snapshotRef.current(),
      state => restoreRef.current?.(state as T),
      () => readyRef.current && !!restoreRef.current,
    )
  }, [key])

  useEffect(() => {
    if (!key || !ready || !restoreRef.current) return
    const incoming = takeStagedDraft<T>(key)
    if (incoming !== undefined) restoreRef.current(incoming)
  }, [key, ready])
}
