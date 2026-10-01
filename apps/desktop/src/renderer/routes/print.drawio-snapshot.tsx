import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { api } from '../api'
import { renderStaticDrawio } from '../lib/staticDrawio'

interface SnapshotItem {
  path: string
  nodeId?: string | null
  width?: number | null
  height?: number | null
  crop?: unknown
}

// Délai maximal de rendu d'un diagramme : au-delà, il est signalé en échec (repli texte côté Word).
const ITEM_TIMEOUT_MS = 10_000

/**
 * Route technique (GH34 sprint 3) — capture des diagrammes draw.io en image pour l'export Word à
 * partir d'un gabarit. Chargée dans une fenêtre cachée par `drawio-snapshot.ts` (main), selon le
 * même mécanisme que les routes `/print/*` du PDF. Rend chaque diagramme l'un après l'autre avec
 * le viewer de la Vue Word (`renderStaticDrawio` : même page, même ancre, même taille et même
 * rognage qu'à l'écran), puis transmet son rectangle au main, qui capture la zone avant de passer
 * au suivant. `index = -1` signale la fin.
 */
export const Route = createFileRoute('/print/drawio-snapshot')({
  component: DrawioSnapshotPage,
  validateSearch: (s: Record<string, unknown>) => ({
    repoPath: (s['repoPath'] as string) ?? '',
    itemsJson: (s['itemsJson'] as string) ?? '[]',
  }),
})

function DrawioSnapshotPage() {
  const { repoPath, itemsJson } = Route.useSearch()
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let items: SnapshotItem[]
    try {
      items = JSON.parse(itemsJson) as SnapshotItem[]
    } catch {
      items = []
    }
    let cancelled = false

    const run = async () => {
      for (let i = 0; i < items.length && !cancelled; i++) {
        const host = hostRef.current
        if (!host) return
        const placeholder = placeholderFor(items[i])
        host.replaceChildren(placeholder)

        let teardown: () => void = () => {}
        const ok = await new Promise<boolean>(resolve => {
          const timer = setTimeout(() => resolve(false), ITEM_TIMEOUT_MS)
          teardown = renderStaticDrawio(placeholder, repoPath, result => {
            clearTimeout(timer)
            resolve(result)
          })
        })
        // Deux frames : la mise en page finale (échelle, rognage) est peinte avant la capture.
        await nextFrame()
        await nextFrame()
        const box = ok ? (placeholder.firstElementChild as HTMLElement | null)?.getBoundingClientRect() : null
        const rect = box && box.width > 0 && box.height > 0
          ? { x: box.left, y: box.top, width: box.width, height: box.height }
          : null
        await api.export.drawioSnapshotReady(i, rect).catch(() => {})
        teardown()
      }
      if (!cancelled) await api.export.drawioSnapshotReady(-1, null).catch(() => {})
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [repoPath, itemsJson])

  return (
    <div className="bg-white min-h-screen">
      {/* Diagramme seul, sans le cadre de la Vue Word (bordure, arrondi) : c'est le contenu du
          document qui l'encadre, s'il le souhaite. */}
      <style>{'.gh34-drawio-snapshot > span > span { border: 0 !important; border-radius: 0 !important; }'}</style>
      <div ref={hostRef} className="gh34-drawio-snapshot" style={{ position: 'absolute', left: 0, top: 0 }} />
    </div>
  )
}

/** Placeholder au format produit par `StaticRichTextViewer` (lu par `renderStaticDrawio`). */
function placeholderFor(item: SnapshotItem): HTMLElement {
  const el = document.createElement('span')
  el.className = 'static-drawio'
  el.style.display = 'inline-block'
  el.setAttribute('data-drawio-path', item.path)
  if (item.nodeId) el.setAttribute('data-drawio-node-id', item.nodeId)
  if (item.width) el.setAttribute('data-drawio-width', String(item.width))
  if (item.height) el.setAttribute('data-drawio-height', String(item.height))
  if (item.crop) el.setAttribute('data-drawio-crop', JSON.stringify(item.crop))
  return el
}

function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}
