import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { CornerDownRight, Eraser, Square, SquareTerminal, X } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import { useTerminal } from '../../contexts/TerminalContext'

const HEIGHT_MIN = 80
const HEIGHT_MAX_RATIO = 0.7

function repoName(repoPath: string): string {
  return repoPath.split(/[\\/]/).filter(Boolean).pop() ?? repoPath
}

/**
 * GH238 — panneau bas des vues Version : en-tête, émulateur xterm, état « Git Bash introuvable ».
 * Toujours monté (sous `<main>` dans `AppLayout`), masqué par CSS : le DOM de xterm reste attaché
 * et garde son contenu quand le panneau est fermé ou qu'on quitte les vues Version.
 */
export function TerminalPanel() {
  const { t } = useTranslation()
  const term = useTerminal()
  const panelRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!menu) return
    const closeMenu = () => setMenu(null)
    window.addEventListener('mousedown', closeMenu)
    window.addEventListener('blur', closeMenu)
    return () => {
      window.removeEventListener('mousedown', closeMenu)
      window.removeEventListener('blur', closeMenu)
    }
  }, [menu])

  if (!term) return null

  const handleResizeMouseDown = (e: ReactMouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = term.height
    const column = panelRef.current?.parentElement
    const max = (column?.clientHeight ?? window.innerHeight) * HEIGHT_MAX_RATIO
    const onMouseMove = (ev: MouseEvent) => {
      term.setHeight(Math.round(Math.min(max, Math.max(HEIGHT_MIN, startHeight + startY - ev.clientY))))
    }
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  const running = term.status === 'running' || term.status === 'installing'
  const showCd = term.status === 'running' && !!term.sessionRepo && term.selectedRepoPath !== term.sessionRepo
  const menuAction = (fn: () => void) => () => {
    setMenu(null)
    fn()
  }

  return (
    <div
      ref={panelRef}
      data-testid="terminal-panel"
      className={term.visible ? 'flex flex-col shrink-0 bg-surface' : 'hidden'}
      style={{ height: term.height }}
    >
      <div
        className="bg-edge hover:bg-status-info-solid cursor-row-resize shrink-0 transition-colors"
        style={{ height: 4 }}
        onMouseDown={handleResizeMouseDown}
      />
      <div className="flex items-center gap-2 px-3 py-1 border-b border-edge shrink-0 text-xs">
        <SquareTerminal size={13} className="text-ink-2 shrink-0" />
        <span className="font-medium text-ink">{term.shellName || t('terminal.title')}</span>
        {term.sessionRepo && (
          <span className="text-ink-3 truncate" title={term.sessionRepo}>{repoName(term.sessionRepo)}</span>
        )}
        {showCd && (
          <button
            type="button"
            className="btn-secondary-sm flex items-center gap-1"
            onClick={term.cdToSelected}
            title={term.selectedRepoPath}
          >
            <CornerDownRight size={12} />
            {t('terminal.cdToSelected', { repo: repoName(term.selectedRepoPath) })}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" className="btn-icon text-prim" onClick={term.clear} title={t('terminal.clear')}>
            <Eraser size={13} />
          </button>
          {running && (
            <button type="button" className="btn-icon text-prim" onClick={term.kill} title={t('terminal.kill')}>
              <Square size={12} />
            </button>
          )}
          <button type="button" className="btn-icon text-prim" onClick={term.close} title={t('terminal.close')}>
            <X size={14} />
          </button>
        </div>
      </div>
      <div
        className="relative flex-1 min-h-0"
        // Les touches du terminal ne remontent pas aux raccourcis des vues (F7, Ctrl+S, Ctrl+B…) ;
        // Ctrl+ù est traité avant, en capture (TerminalContext).
        onKeyDown={e => e.stopPropagation()}
        onContextMenu={e => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        <div ref={term.setHost} data-testid="terminal-host" className="absolute inset-0 pl-2 pt-1" />
        {(term.status === 'not-found' || term.status === 'detecting') && (
          <div className="absolute inset-0 bg-surface flex flex-col items-center justify-center gap-3 text-sm text-ink-2">
            {term.status === 'detecting' ? (
              <p>{t('common.loading')}</p>
            ) : (
              <>
                <p>{t('terminal.notFound')}</p>
                <div className="flex gap-2">
                  <button type="button" className="btn-primary-sm" onClick={term.install}>
                    {t('terminal.installGit')}
                  </button>
                  <button type="button" className="btn-secondary-sm" onClick={term.recheck}>
                    {t('terminal.recheck')}
                  </button>
                </div>
                {!term.winget && <p className="text-xs text-ink-3">{t('terminal.installHint')}</p>}
              </>
            )}
          </div>
        )}
      </div>
      {menu && (
        <div
          className="fixed z-50 min-w-[140px] rounded border border-edge bg-surface shadow-lg py-1 text-xs"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button type="button" className="block w-full text-left px-3 py-1 hover:bg-surface-hover" onClick={menuAction(term.copySelection)}>
            {t('terminal.copy')}
          </button>
          <button type="button" className="block w-full text-left px-3 py-1 hover:bg-surface-hover" onClick={menuAction(term.paste)}>
            {t('terminal.paste')}
          </button>
          <button type="button" className="block w-full text-left px-3 py-1 hover:bg-surface-hover" onClick={menuAction(term.clear)}>
            {t('terminal.clear')}
          </button>
        </div>
      )}
    </div>
  )
}
