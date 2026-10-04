import { useState } from 'react'
import { flushSync } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { MergeOrigin } from '@polenta/types'
import { api } from '../../api'
import { useTabs } from '../../contexts/TabsContext'

/**
 * GH37 — opens (or reopens, with its draft) the resolution of a conflicting merge in a tab of its
 * own: shared by every entry point (Publier, graph merge/mergeInto, Rafraîchir).
 */
export function useOpenMergeResolution(projectId: string | null | undefined) {
  const qc = useQueryClient()
  const { openTab } = useTabs()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function open(repoPath: string, leftRef: string, rightRef: string, origin: MergeOrigin): Promise<boolean> {
    setPending(true)
    setError(null)
    try {
      const session = await api.mergeResolution.open(repoPath, leftRef, rightRef, origin)
      void qc.invalidateQueries({ queryKey: ['merge-resolution', 'list'] })
      // After an await, not in the click any more: without flushSync the router's (synchronous)
      // location update renders before the new tab becomes active, and TabsContext's tab-sync
      // effect rewrites the *previous* tab to /merge-resolve.
      flushSync(() => openTab('/merge-resolve', { id: session.id, projectId: projectId ?? '' }))
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setPending(false)
    }
  }

  return { open, pending, error }
}
