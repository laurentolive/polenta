import { useEffect, useState, useCallback, useRef } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import type { DrawioPage } from '@polenta/api-client'
import { api } from '../api'
import { resolveDrawioTarget } from '../lib/drawioRender'
import { loadDrawioViewer } from '../lib/drawioViewerLoader'
import type { DrawioEmbedOptions, DrawioCropRect } from './DrawioEmbedExtension'
import { ResizableMediaFrame, type MediaBounds } from './ResizableMediaFrame'
import type { NodeContextMenuEntry } from './NodeContextMenu'
import { DrawioPagePicker } from './DrawioPagePicker'

type LoadState =
  | { status: 'loading' }
  | { status: 'no-repo' }
  | { status: 'not-found' }
  | { status: 'invalid' }
  | { status: 'ok' }

// mxGraph CellState : coordonnées écran (déjà mises à l'échelle/translatées),
// suffisant pour positionner l'overlay de surlignage — pas besoin du reste
// de l'API mxGraph ici.
interface MxCellState {
  x: number
  y: number
  width: number
  height: number
}
interface MxGraphLike {
  getModel(): { getCell(id: string): unknown }
  getView(): { getState(cell: unknown): MxCellState | null }
}

const FALLBACK_BOUNDS: MediaBounds = { width: 400, height: 300 }

export function DrawioEmbedView({ node, extension, updateAttributes, selected, editor, deleteNode, getPos }: NodeViewProps) {
  const path = (node.attrs.path as string) ?? ''
  const nodeId = (node.attrs.nodeId as string | null) ?? undefined
  const width = node.attrs.width as number | null
  const height = node.attrs.height as number | null
  const crop = node.attrs.crop as DrawioCropRect | null
  const repoPath = (extension.options as DrawioEmbedOptions).repoPath
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [highlightRect, setHighlightRect] = useState<MxCellState | null>(null)
  const [graphBounds, setGraphBounds] = useState<MediaBounds | null>(null)
  const [pagePicker, setPagePicker] = useState<
    { mode: 'replace' | 'change-page'; path: string; pages: DrawioPage[]; top: number; left: number } | null
  >(null)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<{ showLightbox(): void } | null>(null)
  // Jeton de requête : une réponse tardive d'un chargement précédent (path/nodeId
  // ayant changé entre-temps) ne doit pas écraser un état plus récent.
  const requestIdRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setHighlightRect(null)
    setGraphBounds(null)
    // Le viewer précédent (s'il existe) va être détruit par le prochain
    // `container.innerHTML = ''` ci-dessous — sans ce reset, un double-clic
    // survenant pendant ce rechargement (déclenché par ex. par le retour de
    // focus fenêtre, cf. l'effet plus bas) pouvait invoquer showLightbox()
    // sur une instance déjà obsolète dont le conteneur vient d'être vidé.
    viewerRef.current = null
    if (!repoPath || !path) {
      setState({ status: 'no-repo' })
      return
    }
    const pages = await api.drawio.read(repoPath, path)
    if (requestId !== requestIdRef.current) return
    if (!pages || pages.length === 0) {
      setState({ status: 'not-found' })
      return
    }
    const target = resolveDrawioTarget(pages, nodeId)
    const page = pages[target.pageIndex]
    if (!page || !page.xml) {
      setState({ status: 'invalid' })
      return
    }
    try {
      await loadDrawioViewer()
    } catch {
      if (requestId !== requestIdRef.current) return
      setState({ status: 'invalid' })
      return
    }
    if (requestId !== requestIdRef.current) return
    const container = containerRef.current
    if (!container) return
    container.innerHTML = ''
    container.className = 'mxgraph'
    container.setAttribute('data-mxgraph', JSON.stringify({
      xml: page.xml,
      // Pas de clé `toolbar` du tout : le viewer teste `null != graphConfig.toolbar`
      // pour décider d'appeler addToolbar() — une chaîne vide passe ce test
      // (elle n'est pas `null`) et crée quand même la barre d'outils (fond
      // #eeeeee, exactement le rectangle gris signalé). Absente, la clé vaut
      // `undefined` et addToolbar() n'est jamais appelé.
      resize: true,
      nav: false,
      // Désactive le clic simple natif du viewer qui ouvre sa propre
      // "lightbox" (grand popup zoom/pan/print) — ce viewer embarqué gère
      // désormais son propre clic (sélection ProseMirror pour redimensionner)
      // et son propre double-clic (cf. handleOpenLightbox ci-dessous, qui
      // invoque la même lightbox mais explicitement). Sans ce flag, le clic
      // natif consommait l'événement avant qu'il n'atteigne notre gestion
      // (sélection du node / menu contextuel), et affichait un rectangle de
      // survol gris signalant la zone cliquable.
      lightbox: 0,
    }))
    window.GraphViewer?.createViewerForElement(container, viewer => {
      if (requestId !== requestIdRef.current) return
      setState({ status: 'ok' })
      viewerRef.current = viewer as { showLightbox(): void }
      const graph = (viewer as { graph: MxGraphLike }).graph
      if (target.highlightCellId) {
        try {
          const cell = graph.getModel().getCell(target.highlightCellId)
          const cellState = cell ? graph.getView().getState(cell) : null
          if (cellState) setHighlightRect(cellState)
        } catch {
          // Surlignage best-effort : une divergence d'API interne du viewer ne
          // doit pas empêcher l'affichage du diagramme lui-même.
        }
      }
    })
  }, [repoPath, path, nodeId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  // Mesure la taille réelle rendue par le viewer une fois le diagramme visible
  // plutôt que de se fier à `graph.getGraphBounds()` : le viewer dimensionne
  // son conteneur en pratique à `getGraphBounds() + 2*border + 1` (marge
  // interne non exposée de façon fiable par l'API). ResizeObserver plutôt
  // qu'une mesure ponctuelle (immédiate + un requestAnimationFrame) : le
  // redimensionnement interne du viewer (resize:true) peut survenir après —
  // constaté en usage réel, "Rogner" restait grisé indéfiniment (cropBounds
  // jamais renseigné) car les deux tentatives de mesure arrivaient trop tôt.
  // ResizeObserver réagit quel que soit le moment où la taille se stabilise.
  useEffect(() => {
    if (state.status !== 'ok') return
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) setGraphBounds({ width, height })
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [state.status])

  const handleOpenExternal = () => {
    if (repoPath && path) void api.drawio.openExternal(repoPath, path)
  }

  // Double-clic → grand popup in-app (zoom/pan/nav/print), fourni nativement
  // par le viewer draw.io lui-même (cf. `lightbox: 0` dans la config, qui
  // désactive uniquement le déclenchement automatique au clic simple, pas la
  // fonctionnalité elle-même). "Ouvrir dans draw.io" (app externe) reste
  // accessible séparément depuis le menu contextuel.
  const handleOpenLightbox = () => {
    viewerRef.current?.showLightbox()
  }

  const handleReplaceFile = async () => {
    if (!repoPath) return
    const picked = await api.drawio.pickFile(repoPath)
    if (picked.status !== 'ok') return
    const pages = await api.drawio.read(repoPath, picked.path)
    if (!pages || pages.length === 0) {
      setPickerError('Aucune page draw.io trouvée dans ce fichier.')
      return
    }
    if (pages.length === 1) {
      updateAttributes({ path: picked.path, nodeId: null, crop: null })
      return
    }
    const rect = wrapperRef.current?.getBoundingClientRect()
    setPagePicker({ mode: 'replace', path: picked.path, pages, top: (rect?.bottom ?? 0) + 2, left: rect?.left ?? 0 })
  }

  const handleChangePage = async () => {
    if (!repoPath || !path) return
    const pages = await api.drawio.read(repoPath, path)
    if (!pages || pages.length === 0) {
      setPickerError('Aucune page draw.io trouvée dans ce fichier.')
      return
    }
    const rect = wrapperRef.current?.getBoundingClientRect()
    setPagePicker({ mode: 'change-page', path, pages, top: (rect?.bottom ?? 0) + 2, left: rect?.left ?? 0 })
  }

  const menuItems: NodeContextMenuEntry[] = [
    { id: 'open-external', label: 'Ouvrir dans draw.io', disabled: !repoPath || !path, onSelect: handleOpenExternal },
    { id: 'change-page', label: 'Changer de page/node-id', disabled: state.status !== 'ok', onSelect: () => void handleChangePage() },
    'separator',
    { id: 'replace', label: 'Remplacer le fichier', onSelect: () => void handleReplaceFile() },
    { id: 'delete', label: 'Supprimer', danger: true, onSelect: () => deleteNode() },
  ]

  return (
    <NodeViewWrapper ref={wrapperRef} className="my-2 inline-block" data-drag-handle>
      <ResizableMediaFrame
        width={width}
        height={height}
        fallbackSize={graphBounds ?? FALLBACK_BOUNDS}
        selected={selected}
        editable={editor.isEditable}
        onResize={(w, h) => updateAttributes({ width: w, height: h })}
        crop={crop}
        cropBounds={graphBounds}
        onCropChange={c => updateAttributes({ crop: c })}
        extraMenuItems={menuItems}
        onSelectNode={() => {
          const pos = getPos()
          if (typeof pos === 'number') editor.commands.setNodeSelection(pos)
        }}
        className="border border-edge rounded bg-surface"
      >
        <div style={{ width: '100%', height: '100%' }}>
          {state.status === 'loading' && (
            <div className="p-3 text-xs text-ink-3">Chargement du diagramme…</div>
          )}
          {state.status === 'no-repo' && (
            <div className="p-3 text-xs text-red-500">Diagramme draw.io : contexte repo indisponible</div>
          )}
          {state.status === 'not-found' && (
            <div className="p-3 text-xs text-red-500">Diagramme introuvable : {path}</div>
          )}
          {state.status === 'invalid' && (
            <div className="p-3 text-xs text-red-500">Diagramme invalide : {path}</div>
          )}
          <div
            style={{ display: state.status === 'ok' ? 'block' : 'none', width: '100%', height: '100%' }}
            className="relative cursor-pointer bg-white"
          >
            {/*
              pointer-events désactivé sur le rendu lui-même : le viewer
              officiel dessine ses formes en SVG avec `pointer-events`
              explicite sur les éléments de forme (pour son propre usage
              interne, ex. liens/tooltips), ce qui REMPLACE l'héritage de
              `none` posé ici — insuffisant à lui seul (constaté : le
              double-clic ne fonctionnait qu'en dehors des formes, jamais
              dessus). D'où l'overlay transparent ci-dessous, au-dessus de
              tout, qui intercepte réellement chaque clic avant qu'il
              n'atteigne le rendu.
            */}
            <div ref={containerRef} style={{ pointerEvents: 'none' }} />
            <div className="absolute inset-0" onDoubleClick={handleOpenLightbox} />
            {highlightRect && (
              <div
                style={{
                  position: 'absolute',
                  left: highlightRect.x - 4,
                  top: highlightRect.y - 4,
                  width: highlightRect.width + 8,
                  height: highlightRect.height + 8,
                  border: '2.5px solid #ff8a00',
                  borderRadius: 4,
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>
        </div>
      </ResizableMediaFrame>
      {pagePicker && (
        <DrawioPagePicker
          top={pagePicker.top}
          left={pagePicker.left}
          pages={pagePicker.pages}
          onPick={pageId => {
            if (pagePicker.mode === 'replace') {
              updateAttributes({ path: pagePicker.path, nodeId: pageId, crop: null })
            } else {
              updateAttributes({ nodeId: pageId, crop: null })
            }
          }}
          onClose={() => setPagePicker(null)}
        />
      )}
      {pickerError && (
        <div className="mt-1 px-2 py-1 text-xs text-red-500 border border-red-400/50 rounded bg-surface inline-block">
          {pickerError}
          <button type="button" onClick={() => setPickerError(null)} className="ml-2 text-ink-3 hover:text-ink">×</button>
        </div>
      )}
    </NodeViewWrapper>
  )
}
