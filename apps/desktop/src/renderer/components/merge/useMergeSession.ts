import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { MergeFileDetail, MergeFileDraft, MergeSessionInfo, MergeValidation } from '@polenta/types'
import { api } from '../../api'

/** GH37 — session de résolution (main, brouillon persisté) vue du renderer. */
export function useMergeSession(id: string) {
  const qc = useQueryClient()
  const session = useQuery({
    queryKey: ['merge-resolution', id],
    queryFn: () => api.mergeResolution.get(id),
    enabled: !!id,
    staleTime: Infinity,
  })

  const setSession = (s: MergeSessionInfo) => qc.setQueryData(['merge-resolution', id], s)

  async function saveFile(path: string, draft: MergeFileDraft): Promise<void> {
    setSession(await api.mergeResolution.saveFile(id, path, draft))
    // The file detail carries the draft too: keep it in step, so reopening the file shows it.
    qc.setQueryData<MergeFileDetail>(['merge-resolution', id, 'file', path], d => (d ? { ...d, draft, state: draft.state } : d))
  }

  return { session, setSession, saveFile }
}

export function useMergeFile(id: string, path: string | null) {
  return useQuery({
    queryKey: ['merge-resolution', id, 'file', path],
    queryFn: () => api.mergeResolution.getFile(id, path!),
    enabled: !!id && !!path,
    staleTime: Infinity,
  })
}

/** Validation (main) of the output text, debounced — `null` while pending. */
export function useOutputValidation(id: string, path: string | null, text: string | null, delayMs = 300) {
  const [result, setResult] = useState<{ text: string; validation: MergeValidation } | null>(null)
  const seq = useRef(0)
  useEffect(() => {
    if (!path || text === null) return
    const mine = ++seq.current
    const timer = setTimeout(() => {
      api.mergeResolution.validate(id, path, text)
        .then(validation => { if (seq.current === mine) setResult({ text, validation }) })
        .catch(() => { /* validation is advisory here — finalize revalidates in main */ })
    }, delayMs)
    return () => clearTimeout(timer)
  }, [id, path, text, delayMs])
  // A result for an older text is not shown as current.
  return result && result.text === text ? result.validation : null
}
