// Charge le viewer officiel draw.io (vendoré depuis jgraph/drawio, licence
// Apache-2.0 — voir public/vendor/DRAWIO-VIEWER-LICENSE.txt) pour un rendu
// des diagrammes fidèle au moteur mxGraph réel, au lieu d'un rendu SVG
// approximatif écrit dans ce dépôt.
//
// Le script définit par défaut plusieurs chemins vers viewer.diagrams.net
// (styles/shapes/stencils/proxy/police mathématique) via le pattern
// `window.X = window.X || "https://..."`. On les pré-positionne AVANT de
// charger le script pour empêcher tout appel réseau : une chaîne vide est
// falsy en JS donc insuffisante pour bloquer le fallback ; on utilise un
// chemin local qui échouera silencieusement (404 same-origin) plutôt que de
// contacter un serveur externe. Seules les bibliothèques de formes étendues
// (AWS/Azure/UML...) sont concernées — les formes de base utilisées dans les
// diagrammes système/bloc de ce projet sont embarquées dans le bundle et ne
// dépendent d'aucun de ces chemins.
const OFFLINE_PLACEHOLDER = './__drawio-network-disabled__'

const NETWORK_GLOBALS = [
  'PROXY_URL',
  'STYLE_PATH',
  'SHAPES_PATH',
  'STENCIL_PATH',
  'DRAW_MATH_URL',
  'GRAPH_IMAGE_PATH',
] as const

declare global {
  interface Window {
    GraphViewer?: {
      createViewerForElement: (el: HTMLElement, callback?: (viewer: unknown) => void) => void
    }
  }
}

let loadPromise: Promise<void> | null = null

export function loadDrawioViewer(): Promise<void> {
  if (window.GraphViewer) return Promise.resolve()
  if (loadPromise) return loadPromise

  for (const key of NETWORK_GLOBALS) {
    const w = window as unknown as Record<string, string>
    if (!w[key]) w[key] = OFFLINE_PLACEHOLDER
  }

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = '/vendor/drawio-viewer.min.js'
    script.async = true
    script.onload = () => {
      if (window.GraphViewer) resolve()
      else reject(new Error('drawio-viewer.min.js chargé mais GraphViewer indisponible'))
    }
    script.onerror = () => reject(new Error('Échec du chargement de drawio-viewer.min.js'))
    document.head.appendChild(script)
  })
  return loadPromise
}
