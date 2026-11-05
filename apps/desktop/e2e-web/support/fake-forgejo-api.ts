import { execFileSync } from 'child_process'
import * as fs from 'fs'
import type * as http from 'http'
import * as path from 'path'

/**
 * GH107 — API Forgejo minimale servie par la forge locale des e2e (`/api/v1/*`, à côté du git smart
 * HTTP) : propriétaires, création de repo (repo nu créé dans `projectRoot/<owner>/<nom>.git`),
 * détails, branche par défaut, collaborateurs, équipes. Les réponses reprennent les mesures de
 * specs/GH107-sprint1.md §1 (Forgejo 15.0.9).
 *
 * Organisations : `e2e-org` (création permise, équipe `devs`) et `lecture` (création refusée).
 * Les collaborateurs et équipes ajoutés sont relus par `GET /api/v1/_e2e/members/<owner>/<repo>`.
 */
export const E2E_ORG = 'e2e-org'
export const E2E_READONLY_ORG = 'lecture'

const members = new Map<string, Array<{ kind: 'user' | 'team'; name: string; level?: string }>>()

function send(res: http.ServerResponse, status: number, json?: unknown) {
  res.statusCode = status
  if (json === undefined) { res.end(); return }
  res.setHeader('Content-Type', 'application/json;charset=utf-8')
  res.end(JSON.stringify(json))
}

function bare(projectRoot: string, owner: string, repo: string): string {
  return path.join(projectRoot, owner, `${repo}.git`)
}

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8' }).trim()
}

function apiRepo(projectRoot: string, host: string, owner: string, name: string, description = '') {
  const dir = bare(projectRoot, owner, name)
  const head = git(['-C', dir, 'symbolic-ref', '--short', 'HEAD'])
  const branches = git(['-C', dir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads']).split('\n').filter(Boolean)
  const descFile = path.join(dir, 'polenta-description')
  return {
    full_name: `${owner}/${name}`, name, owner: { login: owner, username: owner },
    description: fs.existsSync(descFile) ? fs.readFileSync(descFile, 'utf-8') : description,
    private: !fs.existsSync(path.join(dir, 'polenta-public')), empty: branches.length === 0,
    clone_url: `http://${host}/${owner}/${name}.git`, default_branch: head,
    permissions: { admin: true, push: true, pull: true },
  }
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise(resolve => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({}) } })
  })
}

/** `true` si la requête a été traitée (chemin `/api/v1/*`). */
export async function handleFakeForgejoApi(req: http.IncomingMessage, res: http.ServerResponse, projectRoot: string, login: string): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  if (!url.pathname.startsWith('/api/v1/')) return false
  const host = req.headers.host ?? ''
  const parts = url.pathname.slice('/api/v1/'.length).split('/').map(decodeURIComponent)
  const method = req.method ?? 'GET'

  if (method === 'GET' && url.pathname === '/api/v1/user') return send(res, 200, { login, full_name: 'E2E Tester', email: `${login}@polenta.test` }), true
  if (method === 'GET' && url.pathname === '/api/v1/user/orgs') {
    // Liste paginée : une seule page.
    return send(res, 200, Number(url.searchParams.get('page') ?? 1) > 1 ? [] : [{ username: E2E_ORG, full_name: 'Organisation e2e' }, { username: E2E_READONLY_ORG }]), true
  }
  if (method === 'GET' && parts[0] === 'users' && parts[2] === 'orgs' && parts[4] === 'permissions') {
    const can = parts[3] === E2E_ORG
    return send(res, 200, { is_owner: can, is_admin: can, can_write: can, can_read: true, can_create_repository: can }), true
  }
  if (method === 'GET' && parts[0] === 'orgs' && parts[2] === 'teams') {
    return send(res, 200, Number(url.searchParams.get('page') ?? 1) > 1 || parts[1] !== E2E_ORG ? [] : [{ id: 6, name: 'devs', permission: 'write', includes_all_repositories: false }]), true
  }
  if (method === 'POST' && (url.pathname === '/api/v1/user/repos' || (parts[0] === 'orgs' && parts[2] === 'repos'))) {
    const owner = parts[0] === 'orgs' ? parts[1] : login
    if (owner === E2E_READONLY_ORG) return send(res, 403, { message: 'user is not allowed to create repositories in this organization' }), true
    const body = await readBody(req)
    const name = String(body['name'] ?? '')
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return send(res, 422, { message: '[Name]: AlphaDashDot' }), true
    const dir = bare(projectRoot, owner, name)
    if (fs.existsSync(dir)) return send(res, 409, { message: 'The repository with the same name already exists.' }), true
    fs.mkdirSync(path.dirname(dir), { recursive: true })
    git(['init', '--bare', '--quiet', `--initial-branch=${String(body['default_branch'] ?? 'main')}`, dir])
    // `git http-backend` refuse le push sans ce réglage hors REMOTE_USER — posé par le serveur git.
    git(['-C', dir, 'config', 'http.receivepack', 'true'])
    fs.writeFileSync(path.join(dir, 'polenta-description'), String(body['description'] ?? ''))
    if (body['private'] === false) fs.writeFileSync(path.join(dir, 'polenta-public'), '')
    return send(res, 201, apiRepo(projectRoot, host, owner, name)), true
  }
  if (parts[0] === 'repos' && parts.length >= 3) {
    const [, owner, name, sub, who, extra] = parts
    const dir = bare(projectRoot, owner, name)
    if (!fs.existsSync(dir)) return send(res, 404, { message: "The target couldn't be found.", errors: [] }), true
    const key = `${owner}/${name}`
    const list = members.get(key) ?? []
    members.set(key, list)
    if (!sub && method === 'GET') return send(res, 200, apiRepo(projectRoot, host, owner, name)), true
    if (!sub && method === 'PATCH') {
      const body = await readBody(req)
      if (typeof body['default_branch'] === 'string') git(['-C', dir, 'symbolic-ref', 'HEAD', `refs/heads/${body['default_branch']}`])
      if (typeof body['description'] === 'string') fs.writeFileSync(path.join(dir, 'polenta-description'), body['description'])
      return send(res, 200, apiRepo(projectRoot, host, owner, name)), true
    }
    if (sub === 'collaborators' && who && !extra && method === 'PUT') {
      const body = await readBody(req)
      if (who.startsWith('inconnu')) return send(res, 422, { message: `user does not exist [uid: 0, name: ${who}]` }), true
      list.push({ kind: 'user', name: who, level: String(body['permission'] ?? '') })
      return send(res, 204), true
    }
    if (sub === 'teams' && who && method === 'PUT') {
      list.push({ kind: 'team', name: who })
      return send(res, 204), true
    }
  }
  if (method === 'GET' && parts[0] === '_e2e' && parts[1] === 'members') {
    return send(res, 200, members.get(`${parts[2]}/${parts[3]}`) ?? []), true
  }
  return send(res, 404, { message: 'Not found (fausse forge e2e)' }), true
}
