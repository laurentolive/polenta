/**
 * GH63 — état de l'administration côté renderer : niveau de l'utilisateur (`GET /admin/api/me`, une
 * fois par session ; 403/404 = pas d'administration, sans erreur affichée), suivi d'un travail par
 * sondage (1 s, reprise après coupure réseau ou 401 pendant une mise à jour de la forge), travail
 * en cours pour le bandeau global.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AdminMe, JobView } from '@polenta/types'
import { capabilities } from '../platform'
import { ACTIVE_JOB_STATES, adminApi } from '../lib/adminApi'

let mePromise: Promise<AdminMe | null> | null = null

/** `null` : pas d'administration (desktop, non-propriétaire, ADMIN_UI=off, service injoignable). */
export function loadAdminMe(force = false): Promise<AdminMe | null> {
  if (!capabilities.serverAdmin) return Promise.resolve(null)
  if (!mePromise || force) mePromise = adminApi.status().catch(() => null)
  return mePromise
}

export function useAdminMe(): { me: AdminMe | null; loading: boolean; reload: () => void } {
  const [me, setMe] = useState<AdminMe | null>(null)
  const [loading, setLoading] = useState(capabilities.serverAdmin)
  const load = useCallback((force: boolean) => {
    if (!capabilities.serverAdmin) return
    setLoading(true)
    void loadAdminMe(force).then(m => {
      setMe(m)
      setLoading(false)
    })
  }, [])
  useEffect(() => load(false), [load])
  return { me, loading, reload: () => load(true) }
}

export interface FollowedJob {
  job: JobView | null
  lines: string[]
  /** Coupure (réseau, 401 pendant la mise à jour de la forge de l'instance) : le sondage continue. */
  disconnected: boolean
}

/** Suit un travail jusqu'à sa fin : état et journal, par décalage (pas de doublon après reprise). */
export function useJobFollow(jobId: string | null, onEnd?: (job: JobView) => void): FollowedJob {
  const [state, setState] = useState<FollowedJob>({ job: null, lines: [], disconnected: false })
  const offset = useRef(0)
  const endRef = useRef(onEnd)
  endRef.current = onEnd

  useEffect(() => {
    offset.current = 0
    setState({ job: null, lines: [], disconnected: false })
    if (!jobId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      try {
        const [job, chunk] = await Promise.all([adminApi.job(jobId), adminApi.log(jobId, offset.current)])
        if (stopped) return
        offset.current = chunk.offset
        setState(s => ({ job, lines: chunk.lines.length ? [...s.lines, ...chunk.lines] : s.lines, disconnected: false }))
        if (!ACTIVE_JOB_STATES.has(job.state) && chunk.eof) {
          endRef.current?.(job)
          return
        }
      } catch {
        if (stopped) return
        setState(s => ({ ...s, disconnected: true }))
      }
      timer = setTimeout(tick, 1000)
    }
    void tick()
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
    }
  }, [jobId])

  return state
}

/** Travail en cours (interface ou SSH) pour le bandeau global ; sondage 5 s tant qu'un niveau existe. */
export function useRunningJob(enabled: boolean): JobView | null {
  const [job, setJob] = useState<JobView | null>(null)
  useEffect(() => {
    if (!enabled) return
    let stopped = false
    const tick = () =>
      adminApi
        .jobs({ state: 'running' })
        .then(jobs => !stopped && setJob(jobs[0] ?? null))
        .catch(() => {})
    void tick()
    const t = setInterval(tick, 5000)
    return () => {
      stopped = true
      clearInterval(t)
    }
  }, [enabled])
  return job
}
