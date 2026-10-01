// Rendu paresseux d'un diagramme draw.io dans le viewer statique de richtext
// (StaticRichTextViewer, Vue Word lecture) - T163.
//
// StaticRichTextViewer rend le markdown en HTML pur (markdown-it, sans editeur
// Tiptap) pour tenir des centaines de champs a la fois. La fence `drawio` y
// emet un placeholder `<span class="static-drawio" data-drawio-*>` ; ce module
// monte le vrai viewer mxGraph vendore dans ce placeholder, uniquement quand il
// entre dans le viewport (IntersectionObserver cote appelant), une seule fois.
//
// Aucune interaction d'edition : pas de poignees, pas de rognage, pas de menu
// contextuel, pas de lightbox. Un clic traverse jusqu'au champ (qui passe alors
// en edition et monte le DrawioEmbedView interactif).

import { api } from '../api'
import i18n from '../i18n'
import { resolveDrawioTarget } from './drawioRender'
import { loadDrawioViewer, inlineDrawioViewerConfig } from './drawioViewerLoader'
import { parseCropAttr, type CropRectAttr } from '../tiptap/mediaAttrs'

// Repli de taille tant que le viewer n'a pas ete mesure - memes valeurs que
// FALLBACK_BOUNDS de DrawioEmbedView.
const FALLBACK_W = 400
const FALLBACK_H = 300

// Vue minimale du GraphViewer vendore : on n'a besoin que de demonter le graphe
// mxGraph au teardown (le viewer n'expose pas de `destroy()` et se retient
// lui-meme via un listener `matchMedia` non retirable - `graph.destroy()` libere
// au moins le gros, cf. commentaire dans renderStaticDrawio).
interface MxGraphLike {
  destroy?(): void
}
interface GraphViewerLike {
  graph?: MxGraphLike | null
}

export interface DrawioLayout {
  displayW: number
  displayH: number
  scale: number
  offsetX: number
  offsetY: number
}

/**
 * Geometrie du rendu, repliquee de ResizableMediaFrame en mode non-editable
 * (ni selection ni rognage interactif) - cf. ResizableMediaFrame.tsx "Geometrie
 * du contenu interne". `natural` = taille rendue mesuree du viewer (equivalent
 * de `fallbackSize` / `cropBounds` du composant live).
 */
export function computeDrawioLayout(
  natural: { width: number; height: number },
  width: number | null,
  height: number | null,
  crop: CropRectAttr | null,
): DrawioLayout {
  const safeNaturalW = natural.width > 0 ? natural.width : FALLBACK_W
  const safeNaturalH = natural.height > 0 ? natural.height : FALLBACK_H
  const displayW = width ?? safeNaturalW
  const displayH = height ?? safeNaturalH
  if (crop && crop.width > 0 && crop.height > 0) {
    const scale = displayW / crop.width
    return { displayW, displayH, scale, offsetX: -crop.x * scale, offsetY: -crop.y * scale }
  }
  const scale = displayW / safeNaturalW
  return { displayW, displayH, scale, offsetX: 0, offsetY: 0 }
}

interface PlaceholderAttrs {
  path: string
  nodeId?: string
  width: number | null
  height: number | null
  crop: CropRectAttr | null
}

function parseDimension(raw: string | null): number | null {
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function readAttrs(el: HTMLElement): PlaceholderAttrs {
  const cropRaw = el.getAttribute('data-drawio-crop')
  let crop: CropRectAttr | null = null
  if (cropRaw) {
    try {
      crop = parseCropAttr(JSON.parse(cropRaw))
    } catch {
      crop = null
    }
  }
  return {
    path: el.getAttribute('data-drawio-path') ?? '',
    nodeId: el.getAttribute('data-drawio-node-id') || undefined,
    width: parseDimension(el.getAttribute('data-drawio-width')),
    height: parseDimension(el.getAttribute('data-drawio-height')),
    crop,
  }
}

function showError(placeholder: HTMLElement, key: string, path: string): void {
  const err = document.createElement('span')
  err.className = 'text-status-danger text-xs italic'
  err.textContent = i18n.t(key, { path })
  placeholder.replaceChildren(err)
}

// Etale la construction des viewers sur des frames successives quand plusieurs
// diagrammes entrent dans le viewport en meme temps : sans ca, N `new
// GraphViewer` synchrones s'enchainent dans le meme flush. Ce n'est pas une file
// coordonnee (QO2) - juste une politesse d'ordonnancement.
function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

/**
 * Monte le viewer draw.io dans `placeholder`. A appeler une seule fois par
 * placeholder (l'appelant `unobserve` des la premiere intersection).
 * Renvoie un teardown : annule toute etape asynchrone en vol, coupe le
 * ResizeObserver de mesure et demonte le graphe mxGraph.
 */
export function renderStaticDrawio(
  placeholder: HTMLElement,
  repoPath: string,
  /** GH34 — appelé une fois : `true` quand le diagramme est rendu et mis en page, `false` en
   *  erreur (badge d'erreur affiché). Sert à la capture en image pour l'export Word. */
  onDone?: (ok: boolean) => void,
): () => void {
  const { path, nodeId, width, height, crop } = readAttrs(placeholder)
  let done = false
  const finish = (ok: boolean) => {
    if (done) return
    done = true
    onDone?.(ok)
  }
  const fail = (key: string) => {
    showError(placeholder, key, path)
    finish(false)
  }
  let cancelled = false
  let resizeObs: ResizeObserver | null = null
  let viewer: GraphViewerLike | null = null

  const disposeViewer = () => {
    // Le GraphViewer vendore n'a pas de destroy() et s'enregistre aupres d'un
    // MediaQueryList sans jamais se retirer ; `graph.destroy()` libere au moins
    // le graphe mxGraph, sa vue et ses handlers. Nuller `viewer.graph` rend le
    // callback dark-mode residuel inoffensif (il garde sur `this.graph != null`).
    try {
      viewer?.graph?.destroy?.()
    } catch {
      /* best effort */
    }
    if (viewer) viewer.graph = null
    viewer = null
  }

  const teardown = () => {
    cancelled = true
    resizeObs?.disconnect()
    resizeObs = null
    disposeViewer()
  }

  if (!path) {
    finish(false)
    return teardown
  }

  const run = async () => {
    let pages
    try {
      pages = await api.drawio.read(repoPath, path)
    } catch {
      pages = null
    }
    if (cancelled) return
    if (!pages || pages.length === 0) {
      fail('system.richTextViewer.drawioNotFound')
      return
    }

    const target = resolveDrawioTarget(pages, nodeId)
    const page = pages[target.pageIndex]
    if (!page || !page.xml) {
      fail('system.richTextViewer.drawioInvalid')
      return
    }

    try {
      await loadDrawioViewer()
    } catch {
      if (!cancelled) fail('system.richTextViewer.drawioInvalid')
      return
    }
    if (cancelled) return
    if (!window.GraphViewer) {
      fail('system.richTextViewer.drawioInvalid')
      return
    }

    // -- Structure DOM ------------------------------------------------------
    // outer (taille d'affichage, clip) > inner (taille = "naturelle" du
    // diagramme, mise a l'echelle/decalee) > container mxgraph. overlay
    // transparent au-dessus : capte le pointeur (les formes SVG du viewer
    // posent leur propre pointer-events, cf. DrawioEmbedView) sans
    // gestionnaire - le clic remonte alors au onClick du champ, qui passe en
    // edition.
    //
    // `inner` a une taille EXPLICITE des le depart (provisoire, = dims stockees
    // ou repli 400x300, comme le composant live). C'est indispensable : sans
    // largeur non nulle sur le conteneur mxgraph, GraphViewer (checkVisibleState)
    // differe la creation du graphe via un MutationObserver et notre callback
    // reçoit un viewer dont `.graph` n'est pas encore pret - impossible a
    // demonter proprement au teardown.
    const provW = width ?? FALLBACK_W
    const provH = height ?? FALLBACK_H

    const outer = document.createElement('span')
    outer.style.cssText =
      'display:inline-block;position:relative;overflow:hidden;' +
      'border:1px solid var(--edge);border-radius:4px;background:var(--print-bg);' +
      `width:${provW}px;height:${provH}px`

    const inner = document.createElement('span')
    inner.style.cssText =
      'display:block;position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;' +
      `width:${provW}px;height:${provH}px`

    const container = document.createElement('div')
    container.className = 'mxgraph'
    container.setAttribute('data-mxgraph', inlineDrawioViewerConfig(page.xml))

    const overlay = document.createElement('span')
    overlay.style.cssText = 'position:absolute;inset:0'

    inner.appendChild(container)
    outer.appendChild(inner)
    outer.appendChild(overlay)
    placeholder.replaceChildren(outer)

    // Mesure en content-box (comme DrawioEmbedView, via ResizeObserver
    // contentRect / clientWidth) : le viewer pose une bordure 1px sur le
    // conteneur mxgraph, offsetWidth donnerait ~2px de trop et une echelle
    // legerement differente de la Vue Edition.
    const applyLayout = (naturalW: number, naturalH: number) => {
      if (naturalW <= 0 || naturalH <= 0) return
      const l = computeDrawioLayout({ width: naturalW, height: naturalH }, width, height, crop)
      outer.style.width = `${l.displayW}px`
      outer.style.height = `${l.displayH}px`
      inner.style.width = `${naturalW}px`
      inner.style.height = `${naturalH}px`
      inner.style.left = `${l.offsetX}px`
      inner.style.top = `${l.offsetY}px`
      inner.style.transform = `scale(${l.scale})`
    }

    await nextFrame()
    if (cancelled) return

    try {
      window.GraphViewer.createViewerForElement(container, v => {
        // Capturer la reference AVANT tout return : si le teardown a couru
        // entre-temps on doit quand meme pouvoir demonter ce viewer.
        viewer = v as GraphViewerLike
        if (cancelled) {
          disposeViewer()
          return
        }
        // Mesure immediate (le graphe est cree de maniere synchrone puisque le
        // conteneur a une largeur non nulle), puis suivi des redimensionnements
        // internes du viewer (resize:true) jusqu'au teardown.
        applyLayout(container.clientWidth, container.clientHeight)
        finish(true)
        resizeObs = new ResizeObserver(entries => {
          if (cancelled) return
          const box = entries[entries.length - 1]?.contentRect
          if (box) applyLayout(box.width, box.height)
        })
        resizeObs.observe(container)
      })
    } catch {
      if (!cancelled) fail('system.richTextViewer.drawioInvalid')
    }
  }

  // .catch de derniere ligne : un throw inattendu ne doit jamais remonter en
  // unhandledrejection ; le placeholder garde alors son badge de repli.
  void run().catch(() => finish(false))

  return teardown
}
