import { useEffect, useRef, useState } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { api } from '../api'
import { ResizableMediaFrame, type CropRect } from './ResizableMediaFrame'
import type { NodeContextMenuEntry } from './NodeContextMenu'
import type { ImageCropRect, ResizableImageOptions } from './ResizableImageExtension'

const FALLBACK_NATURAL = { width: 200, height: 150 }
// Taille max à laquelle une image sans dimension explicite (width/height
// `null`, jamais redimensionnée manuellement) est automatiquement ajustée au
// premier chargement, pour ne pas s'afficher en taille réelle (une grande
// photo insérée pouvait déborder très largement du champ richtext) — bornée
// à la largeur réelle de la zone d'édition quand elle est mesurable, avec une
// légère marge.
const AUTO_FIT_MAX_HEIGHT = 360
const AUTO_FIT_FALLBACK_WIDTH = 480
const AUTO_FIT_MARGIN = 24

// Un `src` de node `image` peut avoir trois origines (T76) :
// - `data:` : image collée/insérée avant T76 (contenu historique non migré,
//   cf. specs/T76.md Décision 2) — rendu direct, inchangé.
// - `http(s)://` : image référencée par URL externe (`richtext` "images via
//   URL", SPEC-REQ-requirements.md §3.2) — rendu direct, aucun accès repo.
// - tout le reste : chemin relatif au repo courant (nouvelle insertion T76),
//   résolu via `api.image.read`.
function isLiteralSrc(src: string): boolean {
  return src.startsWith('data:') || /^https?:\/\//.test(src)
}

type LoadState =
  | { status: 'literal' }
  | { status: 'loading' }
  | { status: 'no-repo' }
  | { status: 'not-found' }
  | { status: 'ok'; dataUri: string }

export function ResizableImageView({ node, extension, updateAttributes, selected, editor, deleteNode, getPos }: NodeViewProps) {
  const src = (node.attrs.src as string) ?? ''
  const alt = (node.attrs.alt as string) ?? ''
  const title = (node.attrs.title as string) ?? undefined
  const width = node.attrs.width as number | null
  const height = node.attrs.height as number | null
  // Stocké en fractions [0,1] de la taille native (cf. specs/T75-design.md §1)
  // — robuste à un remplacement de fichier par une image de dimensions
  // différentes, contrairement à un rectangle en pixels absolus.
  const cropFraction = node.attrs.crop as ImageCropRect | null
  const repoPath = (extension.options as ResizableImageOptions).repoPath
  // Taille native de l'image, connue seulement une fois chargée — sert de
  // référence pour le ratio de redimensionnement et les bornes du rognage.
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [state, setState] = useState<LoadState>(isLiteralSrc(src) ? { status: 'literal' } : { status: 'loading' })
  const [replaceError, setReplaceError] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // `src` change (insertion initiale, ou "Remplacer le fichier") : la taille
  // native précédente ne s'applique plus, il faut ré-attendre le prochain
  // onLoad plutôt que de garder une valeur périmée (sinon la nouvelle image
  // serait mise à l'échelle/rognée avec les dimensions de l'ancienne).
  useEffect(() => {
    setNatural(null)
  }, [src])

  useEffect(() => {
    if (isLiteralSrc(src)) {
      setState({ status: 'literal' })
      return
    }
    if (!repoPath) {
      setState({ status: 'no-repo' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    void api.image.read(repoPath, src).then(result => {
      if (cancelled) return
      if (!result) {
        setState({ status: 'not-found' })
        return
      }
      setState({ status: 'ok', dataUri: `data:${result.mimeType};base64,${result.base64}` })
    })
    return () => { cancelled = true }
  }, [repoPath, src])

  const bounds = natural ?? FALLBACK_NATURAL
  const crop: CropRect | null = cropFraction
    ? {
        x: cropFraction.x * bounds.width,
        y: cropFraction.y * bounds.height,
        width: cropFraction.width * bounds.width,
        height: cropFraction.height * bounds.height,
      }
    : null

  const handleReplace = async () => {
    if (!repoPath) return
    setReplaceError(null)
    const picked = await api.image.pickFile(repoPath)
    if (picked.status === 'canceled') return
    if (picked.status === 'error') {
      setReplaceError(picked.message)
      return
    }
    // Remplace la source en conservant position et taille actuelles (cf.
    // specs/T75.md point 10) ; le rognage — exprimé en fractions — reste
    // appliqué tel quel à la nouvelle image (même fenêtre relative).
    updateAttributes({ src: picked.path })
  }

  const menuItems: NodeContextMenuEntry[] = [
    { id: 'replace', label: 'Remplacer le fichier', disabled: !repoPath, onSelect: () => void handleReplace() },
    'separator',
    { id: 'delete', label: 'Supprimer', danger: true, onSelect: () => deleteNode() },
  ]

  const resolvedSrc = state.status === 'literal' ? src : state.status === 'ok' ? state.dataUri : null

  return (
    <NodeViewWrapper ref={wrapperRef} className="my-2 inline-block" data-drag-handle>
      <ResizableMediaFrame
        width={width}
        height={height}
        fallbackSize={bounds}
        selected={selected}
        editable={editor.isEditable}
        onResize={(w, h) => updateAttributes({ width: w, height: h })}
        crop={crop}
        cropBounds={resolvedSrc ? natural : null}
        onCropChange={c =>
          updateAttributes({
            crop: c && natural
              ? { x: c.x / natural.width, y: c.y / natural.height, width: c.width / natural.width, height: c.height / natural.height }
              : null,
          })
        }
        extraMenuItems={menuItems}
        onSelectNode={() => {
          const pos = getPos()
          if (typeof pos === 'number') editor.commands.setNodeSelection(pos)
        }}
      >
        {state.status === 'loading' && (
          <div className="p-3 text-xs text-ink-3">Chargement de l'image…</div>
        )}
        {state.status === 'no-repo' && (
          <div className="p-3 text-xs text-status-danger">Image : contexte repo indisponible</div>
        )}
        {state.status === 'not-found' && (
          <div className="p-3 text-xs text-status-danger">Image introuvable : {src}</div>
        )}
        {resolvedSrc && (
          <img
            src={resolvedSrc}
            alt={alt}
            title={title}
            onLoad={e => {
              const el = e.currentTarget
              const naturalSize = { width: el.naturalWidth, height: el.naturalHeight }
              setNatural(naturalSize)
              // Ajustement automatique une seule fois : seulement si l'image
              // n'a encore aucune taille explicite (jamais redimensionnée ni
              // déjà auto-ajustée) — un remplacement de fichier (T75 point 10)
              // ou un redimensionnement manuel fixent width/height, ce qui
              // désactive définitivement cet ajustement pour ce bloc.
              if (width == null && height == null) {
                const containerWidth = wrapperRef.current?.closest('.ProseMirror')?.clientWidth
                const maxWidth = Math.max(1, (containerWidth ?? AUTO_FIT_FALLBACK_WIDTH) - AUTO_FIT_MARGIN * 2)
                const scale = Math.min(1, maxWidth / naturalSize.width, AUTO_FIT_MAX_HEIGHT / naturalSize.height)
                if (scale < 1) {
                  updateAttributes({ width: Math.round(naturalSize.width * scale), height: Math.round(naturalSize.height * scale) })
                }
              }
            }}
            className="block rounded"
            style={{ width: '100%', height: '100%' }}
            draggable={false}
          />
        )}
      </ResizableMediaFrame>
      {replaceError && (
        <div className="mt-1 px-2 py-1 text-xs text-status-danger border border-status-danger-border rounded bg-surface inline-block">
          {replaceError}
          <button type="button" onClick={() => setReplaceError(null)} className="ml-2 text-ink-3 hover:text-ink">×</button>
        </div>
      )}
    </NodeViewWrapper>
  )
}
