import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { api } from '../api'
import { markProjectJustClosed } from '../lib/projectCloseSignal'

export function useMenuEvents(): void {
  const navigate = useNavigate()

  useEffect(() => {
    const unsubOpen = window.polenta.on('menu:open-workspace', async () => {
      markProjectJustClosed()
      await api.workspace.clearLastOpened()
      navigate({ to: '/' })
    })
    const unsubClose = window.polenta.on('menu:close-project', async () => {
      markProjectJustClosed()
      await api.workspace.clearLastOpened()
      navigate({ to: '/' })
    })
    return () => {
      unsubOpen()
      unsubClose()
    }
  }, [navigate])
}
