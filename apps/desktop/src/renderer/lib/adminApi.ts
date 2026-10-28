/**
 * GH63 — client de `/admin/api/*` (version web seulement). Le serveur web relaie au service
 * d'administration ; les jetons ne passent jamais par le navigateur. Mutations : en-tête CSRF.
 */
import type { AdminMe, AuditLine, JobCreate, JobLogChunk, JobView } from '@polenta/types'
import { CSRF_HEADER_NAME, csrfToken } from './webSession'

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly runningJob?: { id: string; operation: string; actor: string; since: string },
  ) {
    super(message)
  }
}

async function call<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? 'GET'
  const res = await fetch(`/admin/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: method === 'POST' ? { 'Content-Type': 'application/json', [CSRF_HEADER_NAME]: csrfToken() } : {},
    body: method === 'POST' ? JSON.stringify(init.body ?? {}) : undefined,
  })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; runningJob?: AdminApiError['runningJob'] } } | null)?.error
    throw new AdminApiError(res.status, err?.code ?? String(res.status), err?.message ?? res.statusText, err?.runningJob)
  }
  return data as T
}

export interface InstanceRow {
  name: string
  domain: string
  org: string
  forgeVersion: string
  state: string
  complete: boolean
  disk: string
  lastBackup: string | null
  webDomain: string | null
}

export interface Snapshot {
  id: string
  time?: string
  tags?: string[]
  [k: string]: unknown
}

const q = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') s.set(k, String(v))
  const str = s.toString()
  return str ? `?${str}` : ''
}

export const adminApi = {
  me: () => call<AdminMe>('/me'),
  /** Découverte sans erreur HTTP (toujours 200) : `null` si pas d'administration pour cet utilisateur. */
  status: async (): Promise<AdminMe | null> => {
    const res = await fetch('/admin/status', { credentials: 'same-origin' })
    if (!res.ok) return null
    const body = (await res.json()) as { available: boolean; me?: AdminMe }
    return body.available && body.me ? body.me : null
  },
  instances: () => call<{ instances: InstanceRow[] }>('/instances').then(r => r.instances),
  backups: (instance: string) => call<{ instance: string; snapshots: Snapshot[] }>(`/backups/${encodeURIComponent(instance)}`),
  dns: (domain: string) => call<{ domain: string; verdict: string; message: string; expected: { type: string; name: string; value: string }[] }>(`/dns${q({ domain })}`),
  jobs: (filter: { state?: string; instance?: string } = {}) => call<{ jobs: JobView[] }>(`/jobs${q(filter)}`).then(r => r.jobs),
  job: (id: string) => call<JobView>(`/jobs/${encodeURIComponent(id)}`),
  log: (id: string, offset: number) => call<JobLogChunk>(`/jobs/${encodeURIComponent(id)}/log${q({ offset })}`),
  secret: (id: string) => call<{ secret: Record<string, unknown> }>(`/jobs/${encodeURIComponent(id)}/secret`),
  create: (job: JobCreate) => call<{ jobId: string }>('/jobs', { method: 'POST', body: job }).then(r => r.jobId),
  cancel: (id: string) => call<{ ok: true }>(`/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  audit: (filter: { from?: string; instance?: string } = {}) => call<{ lines: AuditLine[] }>(`/audit${q(filter)}`).then(r => r.lines),
  auditCsvUrl: (filter: { from?: string; instance?: string } = {}) => `/admin/api/audit.csv${q(filter)}`,
  // Sprint 5
  exports: () => call<{ exports: ExportRow[] }>('/exports').then(r => r.exports),
  exportDownloadUrl: (file: string) => `/admin/api/exports/${encodeURIComponent(file)}/download`,
  hostS3: () => call<{ s3: S3Info | null }>('/host/s3').then(r => r.s3),
  purgePreview: (name: string) => call<PurgeInventory>(`/s3/purge-preview${q({ name })}`),
  importPreview: (csv: string, instance?: string) => call<ImportPreview>('/users/import/preview', { method: 'POST', body: { csv, instance } }),
  accessReport: (instance?: string) => call<{ rows: AccessRow[] }>(`/users/access-report${q({ instance })}`),
  invite: (login: string, instance?: string) => call<{ login: string; inviteLink: string; message: string }>(`/users/invite${q({ login, instance })}`),
}

export interface ExportRow { file: string; instance: string; sizeBytes: number; sha256?: string; createdAt?: string }
export interface S3Info { endpoint: string; bucket: string; accessKeyHint: string; rotatedAt: string | null }
export interface PurgeInventory { instance: string; snapshots: number; objects: number; bytes: number; oldest?: string | null; newest?: string | null }
export interface ImportPreview {
  uploadId: string
  instance: string
  rows: { line: number; login: string; email?: string; teams?: string[] }[]
  rejected: { line: number; cause: string; login?: string }[]
  unknownTeams: string[]
}
export interface AccessRow { user: string; repo: string; permission: string; via?: string }

export const ACTIVE_JOB_STATES = new Set(['queued', 'running', 'rebooting'])
