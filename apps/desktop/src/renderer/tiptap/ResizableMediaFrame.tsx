import { useRef, useState } from 'react'
import { NodeContextMenu, type NodeContextMenuEntry } from './NodeContextMenu'

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface MediaBounds {
  width: number
  height: number
}

const MIN_SIZE = 40
// Borne la mise à l'échelle du contenu complet affiché en mode rognage : sans
// ça, rogner un contenu très grand (ex. un diagramme drawio) actuellement
// affiché très réduit ferait apparaître l'aperçu plein-format à une taille
// démesurée, débordant largement du document (cf. specs/T75-design.md
// "Risque technique").
const MAX_CROP_PREVIEW = 480

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max)
}

interface Props {
  /** Largeur/hauteur affichées en px. `null` = taille native (pas encore redimensionné). */
  width: number | null
  height: number | null
  /** Taille native/de référence, utilisée quand width/height sont `null` et comme ratio de redimensionnement. */
  fallbackSize: MediaBounds
  selected: boolean
  editable: boolean
  onResize: (width: number, height: number) => void
  /** Rectangle de rognage courant, en unités de `cropBounds` (pas des fractions). `null` = pas de rognage. */
  crop: CropRect | null
  /** Bornes valides du rognage (taille native image, ou bounding box diagramme). `null` = rognage indisponible. */
  cropBounds: MediaBounds | null
  onCropChange: (crop: CropRect | null) => void
  /** Items spécifiques à l'appelant (Remplacer le fichier, Supprimer, items drawio...) — "Redimensionner" et "Rogner" sont gérés par ce composant et ajoutés automatiquement en tête de menu. */
  extraMenuItems: NodeContextMenuEntry[]
  onSelectNode?: () => void
  /**
   * Rendu du contenu réel à sa taille native/complète (jamais pré-rogné) — le
   * cadrage est appliqué par ce composant via un décalage/mise à l'échelle
   * CSS. IMPORTANT : `children` reste toujours au même niveau structurel du
   * JSX (jamais démonté/remonté entre les modes normal/rognage) — un contenu
   * géré de façon impérative (ex. le conteneur mxgraph du viewer draw.io) ne
   * doit pas être recréé à chaque bascule de mode.
   */
  children: React.ReactNode
  className?: string
}

export function ResizableMediaFrame({
  width, height, fallbackSize, selected, editable, onResize,
  crop, cropBounds, onCropChange, extraMenuItems, onSelectNode, children, className,
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // `cropping` est dérivé de `draftCrop` plutôt que d'être un état séparé : les
  // deux ne doivent jamais diverger (un état à deux booléens qui doivent
  // toujours changer ensemble est une source de bug si un futur point de
  // sortie du mode crop oublie de mettre à jour l'un des deux).
  const [draftCrop, setDraftCrop] = useState<CropRect | null>(null)
  const cropping = draftCrop !== null
  const outerRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const displayWidth = width ?? fallbackSize.width
  const displayHeight = height ?? fallbackSize.height
  const aspectRatio = fallbackSize.width / fallbackSize.height

  function clampRect(next: CropRect, bounds: MediaBounds): CropRect {
    const x = clamp(next.x, 0, bounds.width - 1)
    const y = clamp(next.y, 0, bounds.height - 1)
    return {
      x,
      y,
      width: clamp(next.width, 1, bounds.width - x),
      height: clamp(next.height, 1, bounds.height - y),
    }
  }

  function startCrop() {
    if (!cropBounds) return
    // `crop` peut avoir été stocké lors d'une session de rognage précédente,
    // sous des bornes (`cropBounds`) potentiellement différentes (ex. le
    // viewer draw.io a mesuré une taille légèrement différente au rechargement,
    // cf. ResizeObserver) — sans ce clamp, le rectangle initial pouvait être
    // hors bornes ou dégénéré (largeur/hauteur incohérentes), ce qui rendait
    // l'overlay et ses poignées quasi invisibles/inutilisables dès l'ouverture
    // (constaté : une seule poignée visible, non fonctionnelle).
    setDraftCrop(crop ? clampRect(crop, cropBounds) : { x: 0, y: 0, width: cropBounds.width, height: cropBounds.height })
  }

  function confirmCrop() {
    if (draftCrop && draftCrop.width > 0 && draftCrop.height > 0) onCropChange(draftCrop)
    setDraftCrop(null)
  }

  function cancelCrop() {
    setDraftCrop(null)
  }

  // Pas d'entrée "Redimensionner" : un simple clic sélectionne déjà le bloc
  // et affiche les poignées, l'action serait redondante dans le menu.
  const menuEntries: NodeContextMenuEntry[] = [
    { id: 'crop', label: 'Rogner', disabled: !cropBounds, onSelect: startCrop },
    'separator',
    ...extraMenuItems,
  ]

  function handleContextMenu(e: React.MouseEvent) {
    if (!editable) return
    e.preventDefault()
    onSelectNode?.()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  // ── Redimensionnement ────────────────────────────────────────────────────
  // Mutation directe du style DOM pendant le drag (comme pour le rognage
  // ci-dessous) : seul `onResize` (commit au pointerup) déclenche une mise à
  // jour React/ProseMirror, pour un rendu fluide pendant le glissement.
  function handleResizeStart(e: React.PointerEvent, corner: 'nw' | 'ne' | 'sw' | 'se') {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = displayWidth
    const sign = corner === 'ne' || corner === 'se' ? 1 : -1

    function nextSize(clientX: number) {
      const dx = (clientX - startX) * sign
      let nextW = clamp(startW + dx, MIN_SIZE, 4000)
      let nextH = nextW / aspectRatio
      if (nextH < MIN_SIZE) {
        nextH = MIN_SIZE
        nextW = nextH * aspectRatio
      }
      return { nextW, nextH }
    }
    // Le bloc reste en flux normal, ancré à son coin haut-gauche en
    // permanence (jamais de décalage `left`/`top`, sur aucune poignée) : la
    // taille affichée (`width`/`height`) est le seul état persisté (attributs
    // du node) — il n'existe pas d'équivalent "décalage horizontal" qui
    // survivrait à un rechargement du document. Une tentative précédente
    // décalait visuellement le cadre pendant le glissement des poignées
    // ouest/nord pour donner l'impression d'un ancrage au coin opposé, mais
    // ce décalage n'étant pas persistable, le bloc "sautait" en arrière au
    // relâchement (retour au flux normal) — corrigé en supprimant le
    // décalage : le bloc grossit/rétrécit toujours depuis son coin
    // haut-gauche, quelle que soit la poignée tirée.
    function apply(nextW: number, nextH: number) {
      const el = outerRef.current
      if (!el) return
      el.style.width = `${nextW}px`
      el.style.height = `${nextH}px`
    }
    function onMove(ev: PointerEvent) {
      const { nextW, nextH } = nextSize(ev.clientX)
      apply(nextW, nextH)
    }
    function onUp(ev: PointerEvent) {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const { nextW, nextH } = nextSize(ev.clientX)
      onResize(Math.round(nextW), Math.round(nextH))
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // ── Géométrie du contenu interne ─────────────────────────────────────────
  // `children` est toujours rendu dans un même div positionné en absolu à
  // l'intérieur du conteneur externe — seuls l'échelle et le décalage
  // changent selon le mode, jamais la présence/position de `children` dans
  // l'arbre React (cf. doc du prop `children` ci-dessus).
  let contentScale: number
  let offsetX: number
  let offsetY: number
  if (cropping) {
    // Affiche le contenu complet (non rogné), borné à une taille de
    // prévisualisation raisonnable quel que soit l'écart entre la taille
    // d'affichage courante et la taille native/complète du contenu.
    contentScale = Math.min(
      displayWidth / fallbackSize.width,
      MAX_CROP_PREVIEW / fallbackSize.width,
      MAX_CROP_PREVIEW / fallbackSize.height,
    )
    offsetX = 0
    offsetY = 0
  } else if (crop) {
    contentScale = displayWidth / crop.width
    offsetX = -crop.x * contentScale
    offsetY = -crop.y * contentScale
  } else {
    contentScale = displayWidth / fallbackSize.width
    offsetX = 0
    offsetY = 0
  }
  const contentWidth = fallbackSize.width * contentScale
  const contentHeight = fallbackSize.height * contentScale

  const rect = draftCrop ?? { x: 0, y: 0, width: fallbackSize.width, height: fallbackSize.height }

  // ── Rognage ──────────────────────────────────────────────────────────────
  // Comme pour le redimensionnement : mutation directe du style de l'overlay
  // pendant le drag, commit React (setDraftCrop) uniquement au pointerup —
  // évite un re-render de tout le cadre (poignées, menu, calcul d'échelle) à
  // chaque pointermove.
  function handleCropDrag(e: React.PointerEvent, mode: 'move' | 'nw' | 'ne' | 'sw' | 'se') {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const start = rect
    const bounds = cropBounds ?? fallbackSize
    let latest = start

    function next(ev: PointerEvent): CropRect {
      const dx = (ev.clientX - startX) / contentScale
      const dy = (ev.clientY - startY) / contentScale
      if (mode === 'move') {
        return clampRect({ ...start, x: start.x + dx, y: start.y + dy }, bounds)
      }
      const patch: CropRect = { ...start }
      if (mode.includes('w')) { patch.x = start.x + dx; patch.width = start.width - dx }
      if (mode.includes('e')) { patch.width = start.width + dx }
      if (mode.includes('n')) { patch.y = start.y + dy; patch.height = start.height - dy }
      if (mode.includes('s')) { patch.height = start.height + dy }
      return clampRect(patch, bounds)
    }
    function onMove(ev: PointerEvent) {
      latest = next(ev)
      const el = overlayRef.current
      if (el) {
        el.style.left = `${latest.x * contentScale}px`
        el.style.top = `${latest.y * contentScale}px`
        el.style.width = `${latest.width * contentScale}px`
        el.style.height = `${latest.height * contentScale}px`
      }
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDraftCrop(latest)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      ref={outerRef}
      className={`relative inline-block align-top ${className ?? ''}`}
      style={{
        width: displayWidth,
        height: displayHeight,
        left: 0,
        top: 0,
        // En mode rognage, l'aperçu (contenu complet + overlay + boutons
        // Valider/Annuler) peut visuellement déborder de la boîte réservée
        // dans le flux du document (overflow: visible, cf. plus bas) — sans
        // z-index, le contenu suivant du richtext (qui vient après dans le
        // DOM) le recouvrait puisqu'il n'est pas positionné plus haut.
        zIndex: cropping ? 50 : undefined,
      }}
      onContextMenu={handleContextMenu}
    >
      {/*
        Le clip du contenu (overflow) est isolé sur ce conteneur intermédiaire,
        séparé du conteneur externe (`outerRef`) qui porte les poignées : ces
        dernières sont positionnées légèrement hors du cadre (-5px) pour rester
        centrées sur le bord — si elles étaient enfants d'un élément
        `overflow: hidden` (comme c'était le cas ici), cette même règle les
        aurait quasi entièrement rognées, les rendant invisibles/incliquables.
      */}
      <div style={{ position: 'absolute', inset: 0, overflow: cropping ? 'visible' : 'hidden' }}>
        {/*
          Le contenu est toujours rendu à sa taille naturelle (`fallbackSize`)
          puis mis à l'échelle via `transform: scale()` (origine haut-gauche) —
          fonctionne uniformément pour un <img> comme pour un contenu rendu de
          façon impérative à taille fixe (conteneur mxgraph du viewer draw.io),
          sans dépendre d'un remplissage en pourcentage côté enfant.
        */}
        <div
          style={{
            position: 'absolute',
            left: offsetX,
            top: offsetY,
            width: fallbackSize.width,
            height: fallbackSize.height,
            transform: `scale(${contentScale})`,
            transformOrigin: '0 0',
          }}
        >
          {children}
        </div>
      </div>

      {cropping && (
        <>
          <div
            ref={overlayRef}
            onPointerDown={e => handleCropDrag(e, 'move')}
            className="absolute border-2 border-status-warning-solid bg-status-warning-solid/10 cursor-move"
            style={{
              left: rect.x * contentScale,
              top: rect.y * contentScale,
              width: rect.width * contentScale,
              height: rect.height * contentScale,
            }}
          >
            {(['nw', 'ne', 'sw', 'se'] as const).map(corner => (
              <div
                key={corner}
                onPointerDown={e => handleCropDrag(e, corner)}
                className="absolute w-2.5 h-2.5 bg-status-info-fg border border-status-warning-solid rounded-sm"
                style={{
                  cursor: corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize',
                  top: corner.startsWith('n') ? -5 : undefined,
                  bottom: corner.startsWith('s') ? -5 : undefined,
                  left: corner.endsWith('w') ? -5 : undefined,
                  right: corner.endsWith('e') ? -5 : undefined,
                }}
              />
            ))}
          </div>
          <div className="absolute flex justify-end gap-2 p-1" style={{ top: contentHeight, left: 0, width: Math.max(contentWidth, displayWidth) }}>
            <button type="button" onPointerDown={e => e.stopPropagation()} onClick={cancelCrop} className="px-2 py-1 text-xs rounded border border-edge bg-surface text-ink-2 hover:bg-hover shadow">
              Annuler
            </button>
            <button type="button" onPointerDown={e => e.stopPropagation()} onClick={confirmCrop} className="px-2 py-1 text-xs rounded bg-status-info-solid text-status-info-fg hover:opacity-90 shadow">
              Valider
            </button>
          </div>
        </>
      )}

      {!cropping && selected && editable && (
        <>
          {(['nw', 'ne', 'sw', 'se'] as const).map(corner => (
            <div
              key={corner}
              onPointerDown={e => handleResizeStart(e, corner)}
              className="absolute w-2.5 h-2.5 bg-status-info-fg border border-status-neutral-solid rounded-sm shadow"
              style={{
                cursor: corner === 'nw' || corner === 'se' ? 'nwse-resize' : 'nesw-resize',
                top: corner.startsWith('n') ? -5 : undefined,
                bottom: corner.startsWith('s') ? -5 : undefined,
                left: corner.endsWith('w') ? -5 : undefined,
                right: corner.endsWith('e') ? -5 : undefined,
              }}
            />
          ))}
        </>
      )}

      {menu && <NodeContextMenu x={menu.x} y={menu.y} items={menuEntries} onClose={() => setMenu(null)} />}
    </div>
  )
}
