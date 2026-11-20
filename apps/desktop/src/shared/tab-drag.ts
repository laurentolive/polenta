/**
 * GH343 — glisser un onglet d'une fenêtre à une autre (ou hors de la fenêtre) : contenu transporté.
 * Partagé main / renderer : le main tient le glisser en cours, le renderer le remplit et le reçoit.
 */

export interface TabDragEntry {
  pathname: string
  searchParams: Record<string, string>
  title: string
}

export interface TabDragPayload {
  /** Onglet : page courante, titre et historique Précédent / Suivant (GH228). */
  tab: TabDragEntry & { history: TabDragEntry[]; historyIndex: number }
  /** Projet de la page (`projectId`), `null` hors projet. */
  projectId: string | null
  /** Nombre d'onglets de la fenêtre source au début du glisser (dernier onglet → pas de nouvelle fenêtre). */
  tabCount: number
  /** Saisie non sauvegardée de l'éditeur de la page (`renderer/lib/tabDraft.ts`), JSON. */
  draft?: { key: string; state: unknown }
}

/** Type MIME du glisser HTML5 : sa valeur est l'id du glisser, rien d'autre. */
export const TAB_DRAG_MIME = 'application/x-polenta-tab'

/** Taille max du payload sérialisé (saisie d'un éditeur de diff comprise). */
export const MAX_TAB_DRAG_BYTES = 5 * 1024 * 1024

function isEntry(v: unknown): v is TabDragEntry {
  if (!v || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  return typeof e.pathname === 'string' && e.pathname.startsWith('/') && typeof e.title === 'string'
    && !!e.searchParams && typeof e.searchParams === 'object'
    && Object.values(e.searchParams as Record<string, unknown>).every(x => typeof x === 'string')
}

/** Contrôle d'un payload reçu d'un renderer (forme, taille). */
export function isTabDragPayload(v: unknown): v is TabDragPayload {
  if (!v || typeof v !== 'object') return false
  const p = v as Record<string, unknown>
  const tab = p.tab as Record<string, unknown> | undefined
  if (!isEntry(tab) || !Array.isArray(tab!.history) || tab!.history.length === 0 || !tab!.history.every(isEntry)) return false
  const index = tab!.historyIndex
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= (tab!.history as unknown[]).length) return false
  if (p.projectId !== null && typeof p.projectId !== 'string') return false
  if (typeof p.tabCount !== 'number' || p.tabCount < 1) return false
  if (p.draft !== undefined) {
    const d = p.draft as Record<string, unknown> | null
    if (!d || typeof d.key !== 'string') return false
  }
  try {
    return JSON.stringify(v).length <= MAX_TAB_DRAG_BYTES
  } catch {
    return false
  }
}
