import type { TabDragPayload } from '../../shared/tab-drag'

/**
 * GH343 — onglet reçu au démarrage d'une fenêtre créée par un glisser (`__adopt`, `main.tsx`) :
 * `TabsProvider` démarre avec lui (historique compris) au lieu d'un onglet neuf sur l'URL d'entrée.
 */
let bootTab: TabDragPayload['tab'] | null = null

export function setBootTab(tab: TabDragPayload['tab']): void {
  bootTab = tab
}

export function getBootTab(): TabDragPayload['tab'] | null {
  return bootTab
}
