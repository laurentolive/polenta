/**
 * GH46 — protocole de l'éditeur draw.io embarqué (`proto=json`, webapp v32.7.7, vérifié dans
 * `js/app.min.js`). Fonctions pures : pas de DOM, pas d'IPC.
 *
 *   éditeur → Polenta : `{event:"init"}` (prêt) · `{event:"load"}` (chargé) ·
 *                       `{event:"export", format:"xml", xml}` (réponse à `export`) · `{event:"exit"}`
 *   Polenta → éditeur : `{action:"load", xml}` · `{action:"export", format:"xml"}`
 */

/** Page de l'éditeur embarqué, servie par le serveur web (voir `vite.web.config.ts`, `drawio-editor/`). */
export const EDITOR_PATH = '/drawio-editor/index.html'

/**
 * URL de l'iframe. `offline=1` coupe les services distants de l'éditeur ; les boutons Enregistrer et
 * Fermer sont ceux de Polenta, hors de l'iframe (`noSaveBtn`, `noExitBtn`).
 */
export function editorSrc(lang: string): string {
  const params = new URLSearchParams({
    embed: '1',
    proto: 'json',
    offline: '1',
    spin: '1',
    noSaveBtn: '1',
    noExitBtn: '1',
    lang: lang || 'fr',
  })
  return `${EDITOR_PATH}?${params.toString()}`
}

/** Message envoyé à l'éditeur pour charger un diagramme. */
export function loadMessage(xml: string): string {
  return JSON.stringify({ action: 'load', xml })
}

/** Message demandant à l'éditeur son XML courant (réponse : événement `export`). */
export function exportMessage(): string {
  return JSON.stringify({ action: 'export', format: 'xml' })
}

export type EditorEvent =
  | { type: 'init' }
  | { type: 'load' }
  | { type: 'export'; xml: string }
  | { type: 'exit' }

/**
 * Message reçu de l'éditeur → événement typé, ou null (autres événements, données illisibles).
 * L'éditeur envoie des chaînes JSON en mode `proto=json`.
 */
export function parseEditorEvent(data: unknown): EditorEvent | null {
  let value: unknown = data
  if (typeof data === 'string') {
    try {
      value = JSON.parse(data)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object') return null
  const msg = value as { event?: unknown; format?: unknown; xml?: unknown }
  switch (msg.event) {
    case 'init':
      return { type: 'init' }
    case 'load':
      return { type: 'load' }
    case 'exit':
      return { type: 'exit' }
    case 'export':
      if (msg.format === 'xml' && typeof msg.xml === 'string') return { type: 'export', xml: msg.xml }
      return null
    default:
      return null
  }
}

/**
 * Un message n'est accepté que s'il vient de l'iframe de l'éditeur et de la même origine que Polenta.
 * `frame` est `iframe.contentWindow` (null tant que l'iframe n'existe pas).
 */
export function isFromEditor(event: { source: unknown; origin: string }, frame: unknown, origin: string): boolean {
  return frame !== null && frame !== undefined && event.source === frame && event.origin === origin
}
