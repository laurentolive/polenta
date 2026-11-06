import type { UpdateState } from '@polenta/types'

/** GH302 — ce que le bouton montre, déduit de l'état du main (desktop) ou du pont (web). */
export type UpdateView =
  | { kind: 'available'; version: string; managed: boolean }
  | { kind: 'downloading'; version: string; progress: number }
  | { kind: 'ready'; version: string }
  | { kind: 'error'; version: string }
  /** Web : le serveur sert une autre version que celle chargée par la page. */
  | { kind: 'reload'; version: string }
  /** Web, administrateur : une release plus récente que celle de l'instance existe. */
  | { kind: 'release'; version: string }

export function updateView(state: UpdateState | undefined, web: boolean, admin: boolean): UpdateView | null {
  if (!state) return null
  if (web) {
    if (state.servedVersion) return { kind: 'reload', version: state.servedVersion }
    if (admin && state.status === 'available' && state.availableVersion) return { kind: 'release', version: state.availableVersion }
    return null
  }
  const version = state.availableVersion
  if (!version) return null
  switch (state.status) {
    case 'available': return { kind: 'available', version, managed: state.managed === true }
    case 'downloading': return { kind: 'downloading', version, progress: state.progress ?? 0 }
    case 'ready': return { kind: 'ready', version }
    case 'error': return { kind: 'error', version }
    default: return null
  }
}
