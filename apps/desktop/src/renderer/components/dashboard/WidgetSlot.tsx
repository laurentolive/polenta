import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Widget } from '@polenta/types'
import {
  clampWidgetHeight, clampWidgetWidth, WIDGET_DEFAULT_HEIGHT, WIDGET_MAX_HEIGHT, WIDGET_MIN_HEIGHT, WIDGET_MIN_WIDTH, widgetDisplayWidth, widgetRequestedWidth,
} from '@polenta/types'
import { ResizeHandle } from './ResizeHandle'
import { nativeView } from './widgets/WidgetRenderer'

/** Dimensions à enregistrer : un nombre pose, `null` remet la valeur par défaut. */
export interface WidgetSizePatch {
  width?: number | null
  height?: number | null
}

interface Props {
  widget: Widget
  /** Largeur de la zone du dashboard (px) : borne l'affichage ; ignorée à l'impression. */
  zoneWidth: number
  printMode: boolean
  /** Poignées présentes : dashboard modifiable, hors impression et lecture seule. */
  onResize?: (patch: WidgetSizePatch) => Promise<void>
  /** Le pointeur est sur une poignée : la carte ne doit pas démarrer de glisser (réordonner). */
  onDragLock: (locked: boolean) => void
  /** Reçoit la hauteur à appliquer à la carte (glissement en cours, sinon enregistrée). */
  children: (size: { height: number | undefined; resizing: boolean }) => React.ReactNode
}

/**
 * GH435 — emplacement d'un widget dans le flux du dashboard (specs/GH435.md § 3.2, § 3.3). Porte la largeur
 * affichée (largeur demandée bornée par la zone), les poignées et la taille « en cours de glissement »
 * (`live`) : celle-ci reste appliquée jusqu'à ce que la relecture du dashboard apporte la valeur enregistrée,
 * pour que la carte ne saute pas au retour du serveur ; en cas d'échec elle est retirée (retour à la taille
 * enregistrée).
 */
export function WidgetSlot({ widget, zoneWidth, printMode, onResize, onDragLock, children }: Props) {
  const { t } = useTranslation()
  const slot = useRef<HTMLDivElement>(null)
  const [live, setLive] = useState<{ width?: number; height?: number } | null>(null)

  const requested = live?.width ?? widgetRequestedWidth(widget)
  const display = printMode ? clampWidgetWidth(requested) : widgetDisplayWidth(requested, zoneWidth)
  // Tableau sans hauteur enregistrée : la carte s'ajuste à son contenu (entre 160 et 720 px).
  const isTable = useMemo(() => nativeView(widget.spec)?.view === 'table', [widget.spec])
  const height = live?.height ?? widget.height ?? (isTable ? undefined : WIDGET_DEFAULT_HEIGHT)

  // Impression : largeur fixe, et une carte n'est jamais coupée entre deux pages.
  const style: React.CSSProperties = printMode
    ? { flex: `0 0 ${display}px`, breakInside: 'avoid' }
    : display === '100%'
      ? { flex: '0 0 100%' }
      : { flex: `0 1 ${display}px`, maxWidth: '100%', minWidth: `min(${WIDGET_MIN_WIDTH}px, 100%)` }

  const setDim = useCallback((kind: 'width' | 'height', value: number | null) => {
    setLive((prev) => {
      const next = { ...prev }
      if (value === null) delete next[kind]
      else next[kind] = value
      return Object.keys(next).length ? next : null
    })
  }, [])

  // Un enregistrement en cours ne doit pas effacer la taille d'un glissement plus récent (le même bord saisi
  // de nouveau avant la fin de la relecture) : chaque mise à jour en direct ou nouvel enregistrement
  // invalide les précédents.
  const generation = useRef({ width: 0, height: 0 })
  const setLiveDim = useCallback((kind: 'width' | 'height', value: number) => {
    generation.current[kind]++
    setDim(kind, value)
  }, [setDim])

  /** Fin d'un glissement : enregistre, puis rend la main à la valeur enregistrée. */
  const commit = useCallback((kind: 'width' | 'height', value: number | null) => {
    if (value === null || !onResize) return setDim(kind, null)
    const mine = ++generation.current[kind]
    setDim(kind, value)
    onResize({ [kind]: value })
      .catch(() => { /* l'erreur est affichée par la page */ })
      .finally(() => { if (generation.current[kind] === mine) setDim(kind, null) })
  }, [onResize, setDim])

  const slotRect = () => slot.current?.getBoundingClientRect()

  return (
    <div ref={slot} className="relative" style={style} data-testid="widget-slot">
      {children({ height, resizing: live !== null })}
      {onResize && !printMode && (
        <>
          {/* Zone étroite : toutes les cartes sont pleine largeur, la largeur n'est pas réglable. */}
          {display !== '100%' && (
            <ResizeHandle
              axis="x"
              label={t('dashboardPage.resize.width')}
              testId="widget-resize-w"
              getStartSize={() => slotRect()?.width ?? widgetRequestedWidth(widget)}
              getBounds={() => [clampWidgetWidth(0, zoneWidth), clampWidgetWidth(Number.MAX_SAFE_INTEGER, zoneWidth)]}
              onLive={(w) => setLiveDim('width', w)}
              onEnd={(w) => commit('width', w)}
              onReset={() => { onResize({ width: null }).catch(() => { /* idem */ }) }}
              onPointerInside={onDragLock}
            />
          )}
          <ResizeHandle
            axis="y"
            label={t('dashboardPage.resize.height')}
            testId="widget-resize-h"
            getStartSize={() => slotRect()?.height ?? height ?? WIDGET_DEFAULT_HEIGHT}
            getBounds={() => [WIDGET_MIN_HEIGHT, WIDGET_MAX_HEIGHT]}
            onLive={(h) => setLiveDim('height', clampWidgetHeight(h))}
            onEnd={(h) => commit('height', h)}
            onReset={() => { onResize({ height: null }).catch(() => { /* idem */ }) }}
            onPointerInside={onDragLock}
          />
        </>
      )}
    </div>
  )
}
