/**
 * GH63 — client HTTP de l'API interne du service `polenta-admin` (réseau polenta-admin-net). Délai
 * borné ; aucune fuite d'en-tête (jeton de service, jeton utilisateur) dans les erreurs renvoyées.
 */
import type { AdminConfig } from '../config'

export interface ForwardArgs {
  method: 'GET' | 'POST'
  path: string
  body?: unknown
  userToken: string
  actor: string
  clientIp?: string
}

export interface ForwardResult {
  status: number
  contentType: string
  disposition?: string
  body: Buffer | string
}

export class AdminClient {
  constructor(
    private readonly config: AdminConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 30_000,
  ) {}

  async forward(args: ForwardArgs): Promise<ForwardResult> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.serviceToken}`,
      'X-Polenta-Forge-Token': args.userToken,
      'X-Polenta-Actor': args.actor,
      Accept: 'application/json, text/csv',
    }
    if (args.clientIp) headers['X-Polenta-Client-Ip'] = args.clientIp
    let payload: string | undefined
    if (args.method === 'POST') {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(args.body ?? {})
    }
    try {
      const res = await this.fetchImpl(this.config.url + args.path, {
        method: args.method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      const contentType = res.headers.get('content-type') ?? 'application/json'
      const disposition = res.headers.get('content-disposition') ?? undefined
      return { status: res.status, contentType, disposition, body: Buffer.from(await res.arrayBuffer()) }
    } catch {
      return {
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: { code: 'admin-unreachable', message: "Service d'administration injoignable." } }),
      }
    }
  }
}
