// GH63 — doublures de test : forge Forgejo simulée (fetch), kit simulé (scripts bash), racine d'état.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function fakeForge(tokens: Record<string, string>, owners: Record<string, string[]>) {
  const state = { owners, calls: 0 }
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    state.calls++
    const url = new URL(String(input))
    const auth = new Headers(init?.headers).get('authorization') ?? ''
    const login = tokens[auth.replace(/^token\s+/, '')]
    if (!login) return json(401, { message: 'unauthorized' })
    if (url.pathname === '/api/v1/user') return json(200, { login })
    const m = /^\/api\/v1\/users\/([^/]+)\/orgs\/([^/]+)\/permissions$/.exec(url.pathname)
    if (m) {
      const org = decodeURIComponent(m[2])
      if (decodeURIComponent(m[1]) !== login) return json(403, {})
      return json(200, { is_owner: (state.owners[org] ?? []).includes(login), can_create_repository: true })
    }
    return json(404, {})
  }) as typeof fetch
  return { fetch: fetchImpl, get owners() { return state.owners }, set owners(o) { state.owners = o }, state }
}

// Kit simulé (fixtures/fake-kit.sh) : mêmes conventions que le vrai (POLENTA_RESULT_FILE, codes de
// sortie, SIGTERM → 10). FAKE_* lus dans <root>/fake.env pour piloter un scénario.
const FAKE_HOST = fs.readFileSync(path.join(__dirname, 'fixtures', 'fake-kit.sh'), 'utf8')

export function sha(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}

export function setupRoot(opts: { adminInstance?: string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gh63-root-'))
  const kit = path.join(root, 'kit')
  fs.mkdirSync(kit)
  fs.writeFileSync(path.join(kit, 'polenta-host.sh'), FAKE_HOST.replace(/\r\n/g, '\n'), { mode: 0o755 })
  fs.writeFileSync(path.join(kit, 'polenta-admin.sh'), FAKE_HOST.replace(/\r\n/g, '\n'), { mode: 0o755 })
  fs.writeFileSync(path.join(root, 'host.env'), `ADMIN_UI=on\nADMIN_INSTANCE=${opts.adminInstance ?? 'ops'}\nHARDEN_HOST=basic\n`)
  for (const name of ['acme', 'globex', 'ops']) {
    const dir = path.join(root, 'instances', name)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'instance.env'), `INSTANCE_NAME=${name}\nORG=${name}\n`)
    fs.writeFileSync(path.join(dir, '.add-complete'), '')
  }
  fs.mkdirSync(path.join(root, 'admin'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'admin', 'service-tokens.json'),
    JSON.stringify({ acme: { sha256: sha('svc-acme') }, globex: { sha256: sha('svc-globex') }, ops: { sha256: sha('svc-ops') } }),
  )
  return { root, kit, fake: (env: string) => fs.writeFileSync(path.join(root, 'fake.env'), env) }
}

export async function until(cond: () => boolean | Promise<boolean>, timeoutMs = 8000): Promise<void> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (await cond()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('condition non atteinte')
}
