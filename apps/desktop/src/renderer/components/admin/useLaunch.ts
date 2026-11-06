import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { JobCreate } from '@polenta/types'
import { AdminApiError, adminApi } from '../../lib/adminApi'

/** GH63 — lancement d'un travail : identifiant suivi, message d'erreur lisible (409 : qui, quoi, depuis). */
export function useLaunch() {
  const { t } = useTranslation()
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** Identifiant du travail créé (GH305 : suivi par l'appelant), `null` en cas de refus. */
  async function launch(job: JobCreate): Promise<string | null> {
    setError(null)
    try {
      const id = await adminApi.create(job)
      setJobId(id)
      return id
    } catch (err) {
      if (err instanceof AdminApiError && err.status === 409 && err.runningJob) {
        const { operation, actor, since } = err.runningJob
        const at = Number.isNaN(Date.parse(since)) ? since : new Date(since).toLocaleString()
        setError(t('admin.errors.locked', { operation: t(`admin.op.${operation}`, { defaultValue: operation }), actor, since: at }))
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
      return null
    }
  }

  return { jobId, error, launch, clear: () => setJobId(null), setError }
}
