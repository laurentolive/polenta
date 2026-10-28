/**
 * GH63 — client de l'agent hôte (socket Unix, design §5.6). Seul canal du service vers l'hôte hors
 * Docker. Protocole JSON par lignes : requête `{id, action, params, actor}`, lignes `{id, log}`
 * pendant l'exécution, réponse `{id, ok, result | error, code}`.
 */
import net from 'node:net'
import type { AgentState, HostModules } from '@polenta/types'

export type AgentAction = 'host.status' | 'host.setup' | 'host.reboot' | 'fail2ban.status' | 'fail2ban.unban' | 'firewall.status'

export interface AgentResponse {
  ok: boolean
  result?: Record<string, unknown>
  error?: string
  code?: number
}

export interface AgentClient {
  state(): Promise<AgentState>
  /** Modules actifs déclarés par l'agent (`host.status`), `null` si l'agent est absent. */
  modules(): Promise<Partial<HostModules> | null>
  request(action: AgentAction, params: Record<string, unknown>, actor: string, onLog?: (line: string) => void): Promise<AgentResponse>
}

export const absentAgent: AgentClient = {
  state: async () => 'absent',
  modules: async () => null,
  request: async () => ({ ok: false, error: 'agent-absent', code: 503 }),
}

let seq = 0

export class SocketAgent implements AgentClient {
  private cache: { at: number; modules: Partial<HostModules> | null } | null = null

  constructor(
    private readonly socketPath: string,
    private readonly opts: { cacheMs?: number; now?: () => number } = {},
  ) {}

  async state(): Promise<AgentState> {
    return new Promise((resolve) => {
      const c = net.connect(this.socketPath)
      const done = (s: AgentState) => {
        c.destroy()
        resolve(s)
      }
      c.setTimeout(1000, () => done('absent'))
      c.on('connect', () => done('up'))
      c.on('error', () => done('absent'))
    })
  }

  async modules(): Promise<Partial<HostModules> | null> {
    const now = (this.opts.now ?? Date.now)()
    if (this.cache && now - this.cache.at < (this.opts.cacheMs ?? 60_000)) return this.cache.modules
    const r = await this.request('host.status', {}, 'service@polenta-admin')
    let modules: Partial<HostModules> | null = null
    if (r.ok && r.result) {
      const raw = (r.result.agentModules ?? {}) as Record<string, { active?: boolean }>
      modules = { docker: true }
      for (const k of ['firewall', 'fail2ban', 'unattended', 'ssh-hardening', 'backup-cron', 'fail2ban-forge'] as const) {
        modules[k] = raw[k]?.active === true
      }
    }
    this.cache = { at: now, modules }
    return modules
  }

  request(action: AgentAction, params: Record<string, unknown>, actor: string, onLog?: (line: string) => void): Promise<AgentResponse> {
    const id = `r${process.pid}-${Date.now()}-${++seq}`
    // L'agent valide l'acteur (login@instance) ; un acteur interne garde ce format.
    const safeActor = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}@[a-z0-9][a-z0-9-]{1,30}$/.test(actor) ? actor : 'service@polenta-admin'
    return new Promise((resolve) => {
      const c = net.connect(this.socketPath)
      let buf = ''
      let settled = false
      const finish = (r: AgentResponse) => {
        if (settled) return
        settled = true
        c.destroy()
        resolve(r)
      }
      c.setEncoding('utf8')
      c.on('connect', () => c.write(JSON.stringify({ id, action, params, actor: safeActor }) + '\n'))
      c.on('data', (chunk: string) => {
        buf += chunk
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl)
          buf = buf.slice(nl + 1)
          let msg: { id?: string; log?: string; ok?: boolean; result?: Record<string, unknown>; error?: string; code?: number }
          try {
            msg = JSON.parse(line)
          } catch {
            continue
          }
          if (msg.id !== id && msg.id !== null) continue
          if (typeof msg.log === 'string') onLog?.(msg.log)
          else if (typeof msg.ok === 'boolean') finish({ ok: msg.ok, result: msg.result, error: msg.error, code: msg.code })
        }
      })
      c.on('error', () => finish({ ok: false, error: 'agent-absent', code: 503 }))
      c.on('close', () => finish({ ok: false, error: 'agent-closed', code: 1 }))
    })
  }
}
