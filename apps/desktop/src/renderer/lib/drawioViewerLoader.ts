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

/**
 * Valeur de l'attribut `data-mxgraph` pour un rendu inline via
 * `GraphViewer.createViewerForElement` — partagée par l'embed éditable
 * (DrawioEmbedView) et le rendu lecture seule de la Vue Word (staticDrawio),
 * pour qu'un ajustement de config ne diverge pas entre les deux.
 *
 * IMPORTANT : **jamais** de clé `toolbar`, même à `""` — le viewer teste
 * `null != graphConfig.toolbar` pour décider d'appeler `addToolbar()` ; une
 * chaîne vide passe ce test et crée quand même la barre d'outils (fond #eeeeee,
 * le rectangle gris). Absente, la clé vaut `undefined` et la barre n'est jamais
 * créée. `lightbox: 0` désactive le clic natif qui ouvrirait la grande lightbox
 * du viewer ; `nav: false` masque les flèches de navigation de page ;
 * `resize: true` laisse le viewer dimensionner son conteneur au diagramme.
 */
export function inlineDrawioViewerConfig(xml: string): string {
  return JSON.stringify({ xml, resize: true, nav: false, lightbox: 0 })
}

// URL du script résolue relativement à CE module, pas à la racine du document :
// dans l'app packagée le renderer est servi en file:// (loadFile), où un chemin
// absolu `/vendor/...` pointe vers la racine du disque (file:///C:/vendor/...)
// → échec de chargement → "Diagramme invalide" sur tous les diagrammes (seul le
// dev, servi en http://localhost, fonctionnait). Un chemin relatif au document
// ne suffit pas non plus : le routeur (history navigateur) change son pathname.
// `../vendor/` depuis ce module = `src/renderer/vendor/` en dev (/lib/…) comme
// en build (/assets/<chunk>.js). Passé via une variable pour que Vite ne tente
// pas de résoudre `new URL('…', import.meta.url)` comme un asset au build.
const VIEWER_SCRIPT_REL = '../vendor/drawio-viewer.min.js'
const VIEWER_SCRIPT_URL = new URL(VIEWER_SCRIPT_REL, import.meta.url).href

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
    script.src = VIEWER_SCRIPT_URL
    script.async = true
    script.onload = () => {
      if (window.GraphViewer) resolve()
      else reject(new Error('drawio-viewer.min.js chargé mais GraphViewer indisponible'))
    }
    script.onerror = () => {
      script.remove()
      reject(new Error(`Échec du chargement de ${VIEWER_SCRIPT_URL}`))
    }
    document.head.appendChild(script)
  })
  // Un échec ne doit pas rester mémorisé : sinon plus aucun diagramme ne peut
  // se charger avant un redémarrage de l'app, même si la cause a disparu.
  loadPromise.catch(() => {
    loadPromise = null
  })
  return loadPromise
}
