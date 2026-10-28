#!/usr/bin/env node
'use strict'
/**
 * GH63 — agent hôte `polenta-host-agent` (specs/GH63-design.md §5.6). Seul composant qui agit sur
 * l'hôte hors Docker : redémarrage, fail2ban, état du pare-feu, `polenta-host setup`. Service systemd
 * root, sans dépendance, joignable seulement par un socket Unix (`/run/polenta/agent.sock`, 0660
 * root:polenta-agent) ; aucun port réseau.
 *
 * Protocole : JSON délimité par lignes. Requête `{id, action, params, actor?}` ; pendant l'exécution,
 * lignes `{id, log}` ; réponse finale `{id, ok: true, result}` ou `{id, ok: false, error, code?}`.
 * Liste FERMÉE d'actions, paramètres validés un à un : action inconnue, paramètre en trop ou mal formé
 * → `{ok:false, error:'invalid'}`, rien n'est exécuté. Commandes en tableau (execFile), jamais de shell.
 */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')

const SOCKET = process.env.POLENTA_AGENT_SOCKET || '/run/polenta/agent.sock'
const ROOT = process.env.POLENTA_ROOT || '/opt/polenta'
const POLENTA_HOST = process.env.POLENTA_HOST_BIN || '/usr/local/bin/polenta-host'
const SOCKET_GROUP = process.env.POLENTA_AGENT_GROUP || 'polenta-agent'
const MAX_LINE = 4096
const JAILS = ['polenta-forge', 'sshd']
const ACTOR_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}@[a-z0-9][a-z0-9-]{1,30}$/

const isIp = (v) => typeof v === 'string' && v.length <= 45 && net.isIP(v) !== 0

/** Table fermée : paramètres autorisés (validateur par clé), délai maximal, module requis. */
const ACTIONS = {
  'host.status': { params: {}, timeoutMs: 120_000 },
  'host.setup': { params: { sshHardeningConfirmed: (v) => typeof v === 'boolean' }, timeoutMs: 45 * 60_000 },
  'host.reboot': { params: {}, timeoutMs: 30_000 },
  'fail2ban.status': { params: {}, timeoutMs: 30_000, module: 'fail2ban' },
  'fail2ban.unban': { params: { ip: isIp }, required: ['ip'], timeoutMs: 60_000, module: 'fail2ban' },
  'firewall.status': { params: {}, timeoutMs: 30_000, module: 'firewall' },
}

/** Valide une requête ; `null` si invalide (rien ne sera exécuté). */
function validate(req) {
  if (!req || typeof req !== 'object' || Array.isArray(req)) return null
  const keys = Object.keys(req)
  if (keys.some((k) => !['id', 'action', 'params', 'actor'].includes(k))) return null
  if (typeof req.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(req.id)) return null
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, req.action)) return null
  if (req.actor !== undefined && (typeof req.actor !== 'string' || !ACTOR_RE.test(req.actor))) return null
  const def = ACTIONS[req.action]
  const params = req.params === undefined ? {} : req.params
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null
  for (const [k, v] of Object.entries(params)) {
    const check = def.params[k]
    if (!check || !check(v)) return null
  }
  for (const k of def.required || []) if (params[k] === undefined) return null
  return { id: req.id, action: req.action, params, actor: req.actor || 'inconnu@inconnue', def }
}

/** Lance une commande (tableau), relaie les lignes de sortie, rend {code, stdout}. */
function run(argv, { timeoutMs, onLine, env }) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } })
    let stdout = ''
    let buf = ''
    const line = (chunk) => {
      buf += chunk.toString('utf8')
      const parts = buf.split('\n')
      buf = parts.pop() || ''
      for (const p of parts) onLine && onLine(p.replace(/\x1b\[[0-9;]*m/g, ''))
    }
    child.stdout.on('data', (d) => {
      if (stdout.length < 1_000_000) stdout += d.toString('utf8')
      line(d)
    })
    child.stderr.on('data', line)
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ code: 127, stdout })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (buf && onLine) onLine(buf)
      resolve({ code: code === null ? 10 : code, stdout })
    })
  })
}

/** Exécuteur réel, remplaçable dans les tests. */
const realExec = {
  run,
  /**
   * Résultat JSON d'une commande du kit (fd 3 du script → fichier temporaire). La commande tourne dans
   * une unité systemd transitoire (`systemd-run --pipe --wait`) : hors du bac à sable de l'agent (pas
   * de réseau ici ; `setup` en a besoin pour apt), journal relayé ligne à ligne.
   */
  async kitJson(args, opts) {
    const dir = fs.mkdtempSync(path.join(path.dirname(SOCKET), 'agent-'))
    const file = path.join(dir, 'result.json')
    const env = { ...opts.env, POLENTA_RESULT_FILE: file }
    const cmd = [POLENTA_HOST, ...args, '--json', '--non-interactive']
    const argv =
      process.env.POLENTA_AGENT_KIT_RUNNER === 'direct'
        ? cmd
        : ['systemd-run', '--quiet', '--wait', '--pipe', '--collect', ...Object.entries(env).map(([k, v]) => `--setenv=${k}=${v}`), ...cmd]
    const r = await run(argv, { ...opts, env })
    let result = null
    try {
      result = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      result = null
    }
    fs.rmSync(dir, { recursive: true, force: true })
    return { code: r.code, result }
  },
  reboot() {
    // Laisse le temps à la réponse de partir, puis redémarre.
    setTimeout(() => spawn('systemctl', ['reboot'], { stdio: 'ignore', detached: true }).unref(), 2000)
  },
}

function hostLog(message, status) {
  try {
    const d = new Date()
    const ts = d.toISOString().replace('T', ' ').slice(0, 19)
    fs.appendFileSync(path.join(ROOT, 'host.log'), `${ts} agent: ${message} ${status}\n`)
  } catch {
    /* journal facultatif */
  }
}

/** Modules actifs (#62) : `polenta-host status --json` ; échec = aucun module optionnel. */
async function modules(exec) {
  const r = await exec.kitJson(['status'], { timeoutMs: ACTIONS['host.status'].timeoutMs })
  const out = {}
  // `status --json` : modules sous `hardening.modules` (#62).
  const list = (r.result && r.result.hardening && r.result.hardening.modules) || []
  for (const m of list) out[m.name] = { enabled: !!m.enabled, active: !!m.active }
  return { status: r.result, modules: out }
}

/** Exécute une requête validée. `send` envoie une ligne au client. */
async function handle(v, send, exec = realExec) {
  const env = { POLENTA_ORIGIN: 'ui', POLENTA_ACTOR: v.actor }
  const log = (m) => send({ id: v.id, log: m })
  const fail = (error, code) => ({ id: v.id, ok: false, error, code })

  if (v.def.module || v.action === 'host.setup') {
    const { modules: mods } = await modules(exec)
    if (v.def.module && !(mods[v.def.module] && mods[v.def.module].active)) {
      return fail(`module-absent:${v.def.module}`, 6)
    }
    if (v.action === 'host.setup' && mods['ssh-hardening'] && mods['ssh-hardening'].enabled && v.params.sshHardeningConfirmed !== true) {
      return fail('ssh-hardening-confirmation-required', 3)
    }
  }

  switch (v.action) {
    case 'host.status': {
      const { status, modules: mods } = await modules(exec)
      if (!status) return fail('status-unavailable', 1)
      return { id: v.id, ok: true, result: { ...status, agentModules: mods } }
    }
    case 'host.setup': {
      const r = await exec.kitJson(['setup'], { timeoutMs: v.def.timeoutMs, onLine: log, env })
      return r.code === 0 ? { id: v.id, ok: true, result: r.result || {} } : fail('setup-failed', r.code)
    }
    case 'host.reboot': {
      exec.reboot()
      return { id: v.id, ok: true, result: { rebooting: true } }
    }
    case 'fail2ban.status': {
      const jails = {}
      for (const jail of JAILS) {
        const r = await exec.run(['fail2ban-client', 'status', jail], { timeoutMs: v.def.timeoutMs })
        const banned = /Banned IP list:\s*(.*)$/m.exec(r.stdout)
        jails[jail] = r.code === 0 ? { banned: banned ? banned[1].split(/\s+/).filter(Boolean) : [] } : { absent: true }
      }
      return { id: v.id, ok: true, result: { jails } }
    }
    case 'fail2ban.unban': {
      const done = []
      for (const jail of JAILS) {
        // Verrou de l'hôte (SSH compris) : sortie 5 si une opération est en cours.
        const r = await exec.run(['flock', '-n', '-E', '5', path.join(ROOT, '.lock'), 'fail2ban-client', 'set', jail, 'unbanip', v.params.ip], {
          timeoutMs: v.def.timeoutMs,
          onLine: log,
        })
        if (r.code === 5) return fail('locked', 5)
        done.push({ jail, ok: r.code === 0 })
      }
      return { id: v.id, ok: true, result: { ip: v.params.ip, jails: done } }
    }
    case 'firewall.status': {
      const r = await exec.run(['ufw', 'status', 'verbose'], { timeoutMs: v.def.timeoutMs })
      return r.code === 0 ? { id: v.id, ok: true, result: { text: r.stdout } } : fail('ufw-failed', r.code)
    }
  }
  return fail('invalid')
}

function serve(socketPath = SOCKET, exec = realExec) {
  const isPipe = socketPath.startsWith('\\\\') // tube nommé Windows (tests seulement)
  if (!isPipe) {
    fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o750 })
    try {
      fs.unlinkSync(socketPath)
    } catch {
      /* absent */
    }
  }
  const server = net.createServer((conn) => {
    let buf = ''
    conn.setEncoding('utf8')
    const send = (obj) => conn.writable && conn.write(JSON.stringify(obj) + '\n')
    conn.on('data', async (chunk) => {
      buf += chunk
      if (buf.length > MAX_LINE && !buf.includes('\n')) {
        send({ id: null, ok: false, error: 'invalid' })
        conn.destroy()
        return
      }
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const raw = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        let req = null
        try {
          req = raw.length <= MAX_LINE ? JSON.parse(raw) : null
        } catch {
          req = null
        }
        const v = validate(req)
        if (!v) {
          hostLog(`requête refusée (${raw.length} octets)`, 'REFUS')
          send({ id: req && typeof req.id === 'string' ? req.id.slice(0, 64) : null, ok: false, error: 'invalid' })
          continue
        }
        hostLog(`${v.action} par ${v.actor}`, 'DÉBUT')
        let res
        try {
          res = await handle(v, send, exec)
        } catch (err) {
          res = { id: v.id, ok: false, error: 'internal', code: 1 }
        }
        hostLog(`${v.action} par ${v.actor}`, res.ok ? 'OK' : `ERREUR ${res.error}`)
        send(res)
      }
    })
    conn.on('error', () => conn.destroy())
  })
  server.listen(socketPath, () => {
    if (isPipe) return
    fs.chmodSync(socketPath, 0o660)
    try {
      const gid = Number(require('node:child_process').execFileSync('getent', ['group', SOCKET_GROUP]).toString().split(':')[2])
      if (Number.isInteger(gid)) fs.chownSync(socketPath, 0, gid)
    } catch {
      /* groupe absent : socket root seul */
    }
    console.log(`polenta-host-agent : à l'écoute sur ${socketPath}`)
  })
  return server
}

module.exports = { ACTIONS, validate, handle, serve, JAILS }

if (require.main === module) {
  const server = serve()
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)))
}
