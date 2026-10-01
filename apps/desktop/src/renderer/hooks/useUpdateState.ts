import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdateState } from '@polenta/types'
import { api } from '../api'

const KEY = ['update-state']

/** GH26 — état de la mise à jour auto : lecture initiale (fenêtre montée après l'événement)
 *  puis mises à jour poussées par le main via 'update:state-changed'. */
export function useUpdateState(): UpdateState | undefined {
  const qc = useQueryClient()

  useEffect(() => {
    return window.polenta.on('update:state-changed', (...args: unknown[]) => {
      qc.setQueryData(KEY, args[0] as UpdateState)
    })
  }, [qc])

  const { data } = useQuery({ queryKey: KEY, queryFn: () => api.update.getState(), staleTime: Infinity })
  return data
}
