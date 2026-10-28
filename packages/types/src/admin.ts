// GH63 — administration du serveur depuis Polenta : types partagés entre le service interne
// `polenta-admin` (apps/admin-service), le web-server et le renderer (specs/GH63-design.md §4).

export type AdminLevel = 'instance' | 'host'
export type AgentState = 'up' | 'absent'
export type HostModuleName =
  | 'docker'
  | 'firewall'
  | 'fail2ban'
  | 'unattended'
  | 'ssh-hardening'
  | 'backup-cron'
  | 'fail2ban-forge'
export type HostModules = Record<HostModuleName, boolean>

export interface AdminMe {
  level: AdminLevel
  instance: string
  hostName: string
  agent: AgentState
  modules: HostModules
  caddyMode: 'managed' | 'external'
}

export type JobState =
  | 'queued'
  | 'running'
  | 'rebooting'
  | 'succeeded'
  | 'failed'
  | 'rolled-back'
  | 'cancelled'
  | 'interrupted'

export type OperationId =
  | 'instance.list'
  | 'instance.add'
  | 'instance.stop'
  | 'instance.start'
  | 'instance.sync'
  | 'instance.remove'
  | 'forge.update'
  | 'backup.run'
  | 'backup.list'
  | 'backup.keys'
  | 'backup.restore'
  | 'export.run'
  | 'export.delete'
  | 'web.enable'
  | 'web.disable'
  | 'dns.check'
  | 'host.setup'
  | 'fail2ban.unban'
  | 'fail2ban.status'
  | 'firewall.status'
  | 'host.reboot'
  | 's3.rotate'
  | 's3.purge'
  | 'users.import'
  | 'users.accessReport'
  | 'users.invite'

export interface JobCreate {
  operation: OperationId
  instance?: string
  params?: Record<string, unknown>
  confirm?: string | boolean
}

export interface JobView {
  id: string
  operation: OperationId | string
  instance: string | null
  actor: { login: string; instance: string; ip?: string }
  origin: 'ui' | 'ssh'
  state: JobState
  createdAt: string
  startedAt?: string
  endedAt?: string
  steps: { name: string; state: 'pending' | 'running' | 'done' | 'failed' }[]
  cancellable: boolean
  logSize: number
  /** Résultat sans secret ; `oneTime: true` si une valeur à usage unique attend (`GET /jobs/:id/secret`). */
  result?: Record<string, unknown>
  error?: { code: number; cause: string; message: string }
}

export interface JobLogChunk {
  offset: number
  lines: string[]
  eof: boolean
}

export type AuditResult = 'accepted' | 'succeeded' | 'failed' | 'rolled-back' | 'cancelled' | 'refused' | 'interrupted'

export interface AuditLine {
  ts: string
  actor: string
  actorInstance: string
  ip?: string
  origin: 'ui' | 'ssh'
  operation: string
  target: string
  params: Record<string, unknown>
  jobId?: string
  result: AuditResult
  reason?: string
}

export interface AdminApiError {
  ok: false
  error: {
    code: string
    message: string
    runningJob?: { id: string; operation: string; actor: string; since: string }
  }
}
