// GH63 — agent hôte (S3-2, S3-3, S3-8, S3-10) et client du service, sur un vrai socket Unix.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { SocketAgent } from '../src/agent-client'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const agent = require('../../../deploy/admin/host-agent/polenta-host-agent.js')

/** Exécuteur simulé : aucune commande réelle, trace des argv. */
function fakeExec(mods: Record<string, { enabled: boolean; active: boolean }>, opts: { setupCode?: number } = {}) {
  const calls: string[][] = []
  return {
    calls,
    reboots: 0,
    async run(argv: string[]) {
      calls.push(argv)
      if (argv[0] === 'fail2ban-client') return { code: 0, stdout: 'Status for the jail\n`- Banned IP list:\t203.0.113.9 2001:db8::1\n' }
      if (argv.includes('fail2ban-client')) return { code: 0, stdout: '' }
      if (argv[0] === 'ufw') return { code: 0, stdout: 'Status: active\n' }
      return { code: 0, stdout: '' }
    },
    async kitJson(args: string[], o: { onLine?: (l: string) => void }) {
      calls.push(['polenta-host', ...args])
      if (args[0] === 'status') return { code: 0, result: { host: 'h', hardening: { level: 'full', modules: Object.entries(mods).map(([name, m]) => ({ name, ...m })) } } }
      o.onLine?.('setup : étape 1')
      return { code: opts.setupCode ?? 0, result: { ok: true } }
    },
    reboot() {
      this.reboots++
    },
  }
}

const full = { fail2ban: { enabled: true, active: true }, firewall: { enabled: true, active: true }, 'ssh-hardening': { enabled: true, active: true } }
const none = { 'backup-cron': { enabled: true, active: true } }

const ask = async (exec: ReturnType<typeof fakeExec>, req: unknown) => {
  const v = agent.validate(req)
  if (!v) return { ok: false, error: 'invalid' }
  const logs: string[] = []
  const r = await agent.handle(v, (m: { log?: string }) => m.log && logs.push(m.log), exec)
  return { ...r, logs }
}

describe('agent : requêtes refusées (S3-3)', () => {
  it.each([
    [{ id: 'a', action: 'host.exec' }],
    [{ id: 'a', action: 'fail2ban.unban', params: { ip: '1.2.3' } }],
    [{ id: 'a', action: 'fail2ban.unban', params: { ip: '1.2.3.4; reboot' } }],
    [{ id: 'a', action: 'fail2ban.unban', params: { ip: '::gg' } }],
    [{ id: 'a', action: 'fail2ban.unban', params: { ip: '' } }],
    [{ id: 'a', action: 'fail2ban.unban', params: { ip: 'x'.repeat(10_000) } }],
    [{ id: 'a', action: 'fail2ban.unban', params: {} }],
    [{ id: 'a', action: 'host.status', params: { extra: 1 } }],
    [{ id: 'a', action: 'host.status', extra: 1 }],
    [{ id: 'a b', action: 'host.status' }],
    [{ id: 'a', action: 'host.setup', params: { sshHardeningConfirmed: 'oui' } }],
    [{ id: 'a', action: 'host.status', actor: 'pas un acteur' }],
    [{ id: 'a', action: 'constructor' }],
    [null],
    [['host.status']],
  ])('%j', async (req) => {
    const exec = fakeExec(full)
    expect(await ask(exec, req)).toMatchObject({ ok: false, error: 'invalid' })
    expect(exec.calls).toEqual([])
  })
})

describe('agent : actions valides (S3-2, S3-4)', () => {
  it('host.status rend les modules', async () => {
    const r = await ask(fakeExec(full), { id: 'a', action: 'host.status' })
    expect(r).toMatchObject({ ok: true, result: { host: 'h', agentModules: { fail2ban: { active: true } } } })
  })

  it('fail2ban.unban IPv4 et IPv6 dans les deux prisons, sous verrou', async () => {
    for (const ip of ['203.0.113.9', '2001:db8::1']) {
      const exec = fakeExec(full)
      const r = await ask(exec, { id: 'a', action: 'fail2ban.unban', params: { ip } })
      expect(r).toMatchObject({ ok: true, result: { ip, jails: [{ jail: 'polenta-forge', ok: true }, { jail: 'sshd', ok: true }] } })
      const unbans = exec.calls.filter((c) => c.includes('unbanip'))
      expect(unbans).toHaveLength(2)
      expect(unbans[0].slice(0, 4)).toEqual(['flock', '-n', '-E', '5'])
      expect(unbans[0].slice(-1)).toEqual([ip])
    }
  })

  it('fail2ban.status, firewall.status, host.reboot', async () => {
    expect(await ask(fakeExec(full), { id: 'a', action: 'fail2ban.status' })).toMatchObject({
      ok: true,
      result: { jails: { 'polenta-forge': { banned: ['203.0.113.9', '2001:db8::1'] } } },
    })
    expect(await ask(fakeExec(full), { id: 'a', action: 'firewall.status' })).toMatchObject({ ok: true, result: { text: 'Status: active\n' } })
    const exec = fakeExec(full)
    expect(await ask(exec, { id: 'a', action: 'host.reboot' })).toMatchObject({ ok: true })
    expect(exec.reboots).toBe(1)
  })
})

describe('agent : setup et modules (S3-8, S3-10)', () => {
  it('ssh-hardening actif : confirmation requise (3), puis exécution relayée', async () => {
    const exec = fakeExec(full)
    expect(await ask(exec, { id: 'a', action: 'host.setup' })).toMatchObject({ ok: false, code: 3 })
    expect(exec.calls.some((c) => c[1] === 'setup')).toBe(false)
    const r = await ask(exec, { id: 'b', action: 'host.setup', params: { sshHardeningConfirmed: true }, actor: 'olga@ops' })
    expect(r).toMatchObject({ ok: true, logs: ['setup : étape 1'] })
  })

  it('module absent (HARDEN_HOST=none) : refus, aucune commande fail2ban/ufw', async () => {
    const exec = fakeExec(none)
    expect(await ask(exec, { id: 'a', action: 'fail2ban.unban', params: { ip: '203.0.113.9' } })).toMatchObject({ ok: false, error: 'module-absent:fail2ban', code: 6 })
    expect(await ask(exec, { id: 'a', action: 'firewall.status' })).toMatchObject({ ok: false, error: 'module-absent:firewall' })
    expect(exec.calls.filter((c) => c[0] !== 'polenta-host')).toEqual([])
  })
})

describe('client du service ↔ agent par socket', () => {
  let server: { close: (cb?: () => void) => void } | null = null
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())))

  it('requête, journal relayé, modules, état ; absent sans socket', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh63-agent-'))
    const sock = process.platform === 'win32' ? `\\\\.\\pipe\\gh63-agent-${process.pid}-${Date.now()}` : path.join(dir, 'agent.sock')
    server = agent.serve(sock, fakeExec(full))
    await new Promise((r) => setTimeout(r, 200))
    const c = new SocketAgent(sock)
    expect(await c.state()).toBe('up')
    const logs: string[] = []
    const r = await c.request('host.setup', { sshHardeningConfirmed: true }, 'olga@ops', (l) => logs.push(l))
    expect(r).toMatchObject({ ok: true })
    expect(logs).toEqual(['setup : étape 1'])
    expect(await c.modules()).toMatchObject({ docker: true, fail2ban: true, firewall: true, unattended: false })
    expect(await c.request('host.status', { x: 1 }, 'olga@ops')).toMatchObject({ ok: false, error: 'invalid' })
    const absent = new SocketAgent(path.join(dir, 'aucun.sock'))
    expect(await absent.state()).toBe('absent')
    expect(await absent.request('host.status', {}, 'olga@ops')).toMatchObject({ ok: false, code: 503 })
  })
})
