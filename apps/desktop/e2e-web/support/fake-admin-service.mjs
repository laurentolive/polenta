// GH63 — faux service d'administration pour les e2e web (S4). Même API que apps/admin-service
// (sous-ensemble), état en mémoire. Rôle de l'utilisateur piloté par le test : POST /__role
// {"level":"instance"|"host"|null}. Vérifie le jeton de service comme le vrai service.
import http from 'node:http'

const port = Number(process.env.POLENTA_E2E_ADMIN_PORT ?? 8799)
const SERVICE_TOKEN = process.env.POLENTA_E2E_ADMIN_TOKEN ?? 'e2e-admin-service-token-0123456789abcdef'

let level = 'instance'
let durationMs = 1500
const audit = []
const jobs = new Map()
let seq = 0

const instances = () => [
  { name: 'acme', domain: 'acme.forge.test', org: 'acme', forgeVersion: '11.0.3', state: 'ok', complete: true, disk: '120M', lastBackup: '2026-10-28 03:00', webDomain: 'polenta.acme.test' },
  { name: 'globex', domain: 'globex.forge.test', org: 'globex', forgeVersion: '11.0.3', state: 'ok', complete: true, disk: '80M', lastBackup: null, webDomain: null },
  { name: 'ops', domain: 'ops.forge.test', org: 'ops', forgeVersion: '11.0.3', state: 'ok', complete: true, disk: '60M', lastBackup: null, webDomain: 'polenta.ops.test' },
]

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}
const err = (res, status, code, message, extra = {}) => send(res, status, { ok: false, error: { code, message, ...extra } })

function running() {
  return [...jobs.values()].find(j => j.state === 'running')
}

function createJob(body, actor) {
  const id = `JOB${String(++seq).padStart(23, '0')}`
  const instance = body.instance ?? (['host.setup', 'host.reboot', 'fail2ban.status', 'fail2ban.unban', 'firewall.status', 'dns.check'].includes(body.operation) ? null : 'acme')
  const job = {
    id, operation: body.operation, instance, actor: { login: actor, instance: 'acme' }, origin: 'ui', state: 'running',
    createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), steps: [], cancellable: body.operation === 'backup.run',
    logSize: 0, lines: [`Début : ${body.operation}${instance ? ` ${instance}` : ''}`],
  }
  jobs.set(id, job)
  audit.push({ ts: new Date().toISOString(), actor, actorInstance: 'acme', origin: 'ui', operation: body.operation, target: instance ?? '', params: {}, jobId: id, result: 'accepted' })
  // Durée simulée : 1,5 s, deux lignes de journal.
  setTimeout(() => job.lines.push('… en cours'), Math.min(500, durationMs / 2))
  setTimeout(() => {
    if (job.state !== 'running') return
    job.lines.push('Terminé.')
    job.state = 'succeeded'
    job.endedAt = new Date().toISOString()
    job.result = resultFor(body, instance, id)
    audit.push({ ts: new Date().toISOString(), actor, actorInstance: 'acme', origin: 'ui', operation: body.operation, target: instance ?? '', params: {}, jobId: id, result: 'succeeded' })
  }, durationMs)
  return id
}

// GH63 S5 — valeurs à usage unique (clé restic, mots de passe d'import), rendues une seule fois.
const secrets = new Map()
function resultFor(body, instance, id) {
  if (body.operation === 'backup.run') return { instance, snapshot: 'abc123' }
  if (body.operation === 'backup.keys') {
    secrets.set(id, { resticPassword: 'e2e-restic-cle-0123456789' })
    return { instance, resticPassword: null, oneTime: true }
  }
  if (body.operation === 'users.import') {
    secrets.set(id, { 'created.0.temporaryPassword': 'Tmp-zoe-12345', 'created.1.temporaryPassword': 'Tmp-yann-67890' })
    return { created: [{ login: 'zoe', temporaryPassword: null }, { login: 'yann', temporaryPassword: null }], errors: [], oneTime: true }
  }
  return {}
}

const view = ({ lines, ...j }) => ({ ...j, logSize: lines.length })

http.createServer((req, res) => {
  let raw = ''
  req.on('data', c => (raw += c))
  req.on('end', () => {
    const url = new URL(req.url, 'http://fake')
    const path = url.pathname
    if (path === '/__role' && req.method === 'POST') {
      const ctl = JSON.parse(raw || '{}')
      level = ctl.level ?? null
      durationMs = ctl.durationMs ?? 1500
      return send(res, 200, { level })
    }
    if (path === '/healthz') return send(res, 200, { ok: true })
    if (req.headers.authorization !== `Bearer ${SERVICE_TOKEN}`) return err(res, 401, 'unauthenticated', 'jeton de service invalide')
    if (!req.headers['x-polenta-forge-token']) return err(res, 401, 'unauthenticated', 'jeton utilisateur absent')
    if (!level) return err(res, 403, 'forbidden', 'droit propriétaire non confirmé par la forge')
    const actor = String(req.headers['x-polenta-actor'] ?? 'inconnu')
    const body = raw ? JSON.parse(raw) : {}
    let m
    if (path === '/me') {
      return send(res, 200, {
        level, instance: level === 'host' ? 'ops' : 'acme', hostName: 'hote-e2e', agent: 'up', caddyMode: 'managed',
        modules: { docker: true, firewall: true, fail2ban: true, unattended: true, 'ssh-hardening': false, 'backup-cron': true, 'fail2ban-forge': true },
      })
    }
    if (path === '/instances') return send(res, 200, { instances: level === 'host' ? instances() : instances().filter(i => i.name === 'acme') })
    if ((m = /^\/backups\/([a-z0-9-]+)$/.exec(path))) return send(res, 200, { instance: m[1], snapshots: [{ id: 'abc123def456', time: '2026-10-28T03:00:00Z', tags: ['nightly'] }] })
    if (path === '/dns') {
      const domain = url.searchParams.get('domain')
      const ok = domain?.endsWith('.forge.test')
      return send(res, 200, { domain, verdict: ok ? 'ok' : 'no-resolve', message: ok ? `${domain} pointe vers cet hôte.` : `${domain} ne résout pas.`, expected: [{ type: 'A', name: domain, value: '203.0.113.10' }] })
    }
    if (path === '/audit') return send(res, 200, { lines: audit })
    if (path === '/audit.csv') {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="audit.csv"' })
      return res.end('ts,actor,operation\n' + audit.map(a => `${a.ts},${a.actor},${a.operation}`).join('\n') + '\n')
    }
    if (path === '/jobs' && req.method === 'GET') {
      const state = url.searchParams.get('state')
      return send(res, 200, { jobs: [...jobs.values()].filter(j => !state || j.state === state).reverse().map(view) })
    }
    if (path === '/jobs' && req.method === 'POST') {
      if (body.operation === 'instance.remove' && body.confirm !== body.instance) return err(res, 400, 'confirmation-required', `confirmation requise : saisissez « ${body.instance} »`)
      const r = running()
      if (r) return err(res, 409, 'locked', 'une autre opération est en cours', { runningJob: { id: r.id, operation: r.operation, actor: r.actor.login, since: r.startedAt } })
      return send(res, 202, { jobId: createJob(body, actor) })
    }
    if ((m = /^\/jobs\/([A-Z0-9]+)\/secret$/.exec(path))) {
      const s = secrets.get(m[1])
      secrets.delete(m[1])
      return s ? send(res, 200, { secret: s }) : err(res, 404, 'secret-gone', 'valeur déjà consultée ou expirée')
    }
    if (path === '/exports') return send(res, 200, { exports: [{ file: 'acme-20261028-101500.tar.gz', instance: 'acme', sizeBytes: 7340032, sha256: 'ab12cd34ef56ab12cd34' }] })
    if ((m = /^\/exports\/([a-z0-9-]+-\d{8}-\d{6}\.tar\.gz)\/download$/.exec(path))) {
      res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${m[1]}"` })
      return res.end('ARCHIVE-E2E')
    }
    if (path === '/host/s3') return send(res, 200, { s3: { endpoint: 'https://s3.e2e.test', bucket: 'polenta-e2e', accessKeyHint: '…7XYZ', rotatedAt: null } })
    if (path === '/s3/purge-preview') {
      return send(res, 200, { instance: url.searchParams.get('name'), snapshots: 4, objects: 12, bytes: 3145728, oldest: '2026-09-01', newest: '2026-10-20', preview: true })
    }
    if (path === '/users/import/preview') {
      return send(res, 200, {
        uploadId: 'f'.repeat(32), instance: body.instance ?? 'acme', preview: true,
        rows: [{ line: 2, login: 'zoe' }, { line: 3, login: 'yann' }], rejected: [{ line: 4, login: 'zoe', cause: 'login en double' }], unknownTeams: ['inconnue'],
      })
    }
    if (path === '/users/access-report') {
      return send(res, 200, { org: 'acme', rows: [{ user: 'alice', repo: 'produit', permission: 'admin' }, { user: 'zoe', repo: 'produit', permission: 'write' }, { user: 'zoe', repo: 'comp-moteur', permission: 'read' }] })
    }
    if (path === '/users/invite') {
      const login = url.searchParams.get('login')
      const link = `polenta://connect?server=https://acme.forge.test&login=${login}`
      return send(res, 200, { login, inviteLink: link, message: `Bonjour ${login}, connectez-vous : ${link}` })
    }
    if ((m = /^\/jobs\/([A-Z0-9]+)(\/log|\/cancel)?$/.exec(path))) {
      const job = jobs.get(m[1])
      if (!job) return err(res, 404, 'job-not-found', 'travail introuvable')
      if (m[2] === '/log') {
        const offset = Number(url.searchParams.get('offset') ?? 0)
        return send(res, 200, { offset: job.lines.length, lines: job.lines.slice(offset), eof: job.state !== 'running' })
      }
      if (m[2] === '/cancel') {
        job.state = 'cancelled'
        job.lines.push('annulé')
        return send(res, 200, { ok: true })
      }
      return send(res, 200, view(job))
    }
    return err(res, 404, 'not-found', 'introuvable')
  })
}).listen(port, '127.0.0.1', () => console.log(`faux service d'administration sur ${port}`))
