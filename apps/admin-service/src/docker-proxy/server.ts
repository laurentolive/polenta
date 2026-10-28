/**
 * GH63 — `polenta-docker-proxy` : seul conteneur qui monte /var/run/docker.sock (lecture seule).
 * Reçoit l'API Docker en HTTP sur le réseau interne docker-proxy-net (DOCKER_HOST du service), applique
 * `decide` (policy.ts), relaie au démon ou répond 403 avec le motif. Les connexions « hijackées »
 * (`docker exec`, Upgrade: tcp) sont relayées octet à octet après décision.
 */
import http from 'node:http'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import { decide, needsBody, type PolicyOptions, type Resolver } from './policy'

export interface ProxyOptions extends PolicyOptions {
  socketPath: string
  log?: (line: string) => void
}

const MAX_BODY = 2 * 1024 * 1024

function daemonGet(socketPath: string, path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve) => {
    const req = http.request({ socketPath, path, method: 'GET', timeout: 10_000 }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        let body: unknown = null
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          body = null
        }
        resolve({ status: res.statusCode ?? 500, body })
      })
    })
    req.on('error', () => resolve({ status: 502, body: null }))
    req.on('timeout', () => req.destroy())
    req.end()
  })
}

export function daemonResolver(socketPath: string): Resolver {
  return {
    async container(id) {
      const r = await daemonGet(socketPath, `/containers/${encodeURIComponent(id)}/json`)
      if (r.status !== 200 || !r.body) return null
      const b = r.body as { Name?: string; Config?: { Labels?: Record<string, string> } }
      return { name: String(b.Name ?? '').replace(/^\//, ''), project: b.Config?.Labels?.['com.docker.compose.project'] }
    },
    async network(id) {
      const r = await daemonGet(socketPath, `/networks/${encodeURIComponent(id)}`)
      if (r.status !== 200 || !r.body) return null
      return { name: String((r.body as { Name?: string }).Name ?? '') }
    },
  }
}

function readBody(req: http.IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        resolve(null)
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', () => resolve(null))
  })
}

function parseJson(buf: Buffer | null): Record<string, unknown> | null {
  if (!buf || !buf.length) return {}
  try {
    const v = JSON.parse(buf.toString('utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

export function createProxy(opts: ProxyOptions, resolver: Resolver = daemonResolver(opts.socketPath)): http.Server {
  const log = opts.log ?? ((l: string) => console.log(l))

  const evaluate = async (req: http.IncomingMessage, body: Record<string, unknown> | null) => {
    const url = new URL(req.url ?? '/', 'http://docker')
    const decision = await decide({ method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, body }, resolver, opts)
    if (!decision.allow) log(JSON.stringify({ ts: new Date().toISOString(), refused: true, method: req.method, path: url.pathname, reason: decision.reason }))
    return decision
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://docker')
    let raw: Buffer | null = null
    let body: Record<string, unknown> | null = null
    const inspect = needsBody(req.method ?? 'GET', url.pathname)
    if (inspect) {
      raw = await readBody(req)
      body = parseJson(raw)
    }
    const decision = await evaluate(req, inspect ? body : null)
    if (!decision.allow) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: `polenta-docker-proxy : refusé — ${decision.reason}` }))
      return
    }
    const headers = { ...req.headers }
    delete headers.host
    if (raw) headers['content-length'] = String(raw.length)
    const upstream = http.request({ socketPath: opts.socketPath, method: req.method, path: req.url, headers }, (ures) => {
      res.writeHead(ures.statusCode ?? 502, ures.headers)
      ures.pipe(res)
    })
    upstream.on('error', (err) => {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: `polenta-docker-proxy : démon injoignable (${err.message})` }))
    })
    res.on('close', () => upstream.destroy())
    if (raw) upstream.end(raw)
    else req.pipe(upstream)
  })

  // `docker exec -it`, attach : la connexion devient un flux brut après l'en-tête HTTP.
  server.on('upgrade', async (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    const decision = await evaluate(req, {})
    if (!decision.allow) {
      socket.end(`HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n${JSON.stringify({ message: `polenta-docker-proxy : refusé — ${decision.reason}` })}`)
      return
    }
    const upstream = net.connect(opts.socketPath, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`]
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`)
      upstream.write(lines.join('\r\n') + '\r\n\r\n')
      if (head.length) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    const close = () => {
      upstream.destroy()
      socket.destroy()
    }
    upstream.on('error', close)
    socket.on('error', close)
  })

  return server
}
