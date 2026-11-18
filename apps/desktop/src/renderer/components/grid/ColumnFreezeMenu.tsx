import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

/** T151 / GH389 — menu du clic droit sur un en-tête : figer jusqu'à cette colonne, libérer. */
export function ColumnFreezeMenu({ x, y, colIdx, freezeColCount, onFreeze, onUnfreeze, onClose }: {
  x: number
  y: number
  colIdx: number
  freezeColCount: number
  onFreeze: (count: number) => void
  onUnfreeze: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const item = 'w-full text-left px-3 py-1.5 hover:bg-hover transition-colors text-ink'
  return (
    <div ref={ref} data-floating-menu className="fixed z-50 bg-surface border border-edge rounded-lg shadow-xl py-1 w-56 text-xs" style={{ left: x, top: y }} data-testid="column-freeze-menu">
      {freezeColCount !== colIdx + 1 && (
        <button type="button" className={item} onClick={() => { onFreeze(colIdx + 1); onClose() }} data-testid="column-freeze">
          {t('system.excelView.freezeColumns')}
        </button>
      )}
      {freezeColCount > 0 && (
        <button type="button" className={item} onClick={() => { onUnfreeze(); onClose() }} data-testid="column-unfreeze">
          {t('system.excelView.unfreezeColumns')}
        </button>
      )}
    </div>
  )
}
