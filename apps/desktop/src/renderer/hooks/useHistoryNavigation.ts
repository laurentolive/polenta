import { useEffect, useRef } from 'react'
import { useTabs } from '../contexts/TabsContext'
import { IS_MAC } from '../components/layout/sidebarCollapse'
import { isEditableTarget } from '../lib/editableTarget'
import { historyNavDirection, stepHistory } from '../lib/tabHistory'

/** Sous Windows, un bouton latéral de la souris (ou une touche multimédia) arrive à la fois en
 *  événement DOM et en `app-command` du main : le second déclenchement est ignoré. */
const DEDUP_MS = 300

function modalOpen(): boolean {
  return !!document.querySelector('[role="dialog"], .fixed.inset-0')
}

/** GH228 — déclencheurs Précédent / Suivant des navigateurs : raccourcis clavier, boutons
 *  latéraux de la souris, et (desktop) `app-command` Windows / balayage macOS relayés par le
 *  main sur `nav:history`. */
export function useHistoryNavigation(): void {
  const { activeTab, attemptHistoryNav } = useTabs()
  const goRef = useRef((_delta: -1 | 1) => {})
  goRef.current = (delta) => {
    const index = stepHistory(activeTab, delta)
    if (index !== null) attemptHistoryNav(index)
  }

  useEffect(() => {
    let last: { delta: number; at: number; source: string } | null = null
    const trigger = (delta: -1 | 1, source: 'dom' | 'ipc') => {
      const now = Date.now()
      if (last && last.source !== source && last.delta === delta && now - last.at < DEDUP_MS) return
      last = { delta, at: now, source }
      goRef.current(delta)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const delta = historyNavDirection(e, IS_MAC, isEditableTarget(e.target))
      if (delta === null || modalOpen()) return
      e.preventDefault()
      trigger(delta, 'dom')
    }
    const mouseDelta = (e: MouseEvent) => (e.button === 3 ? -1 : e.button === 4 ? 1 : null)
    const onMouseDown = (e: MouseEvent) => { if (mouseDelta(e) !== null) e.preventDefault() }
    const onMouseUp = (e: MouseEvent) => {
      const delta = mouseDelta(e)
      if (delta === null) return
      e.preventDefault()
      if (!modalOpen()) trigger(delta, 'dom')
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    const unsubscribe = window.polenta?.on?.('nav:history', (direction: unknown) => {
      if (!modalOpen()) trigger(direction === 'forward' ? 1 : -1, 'ipc')
    })
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      unsubscribe?.()
    }
  }, [])
}
