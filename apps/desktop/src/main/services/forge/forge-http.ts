import { request as undiciRequest, type Dispatcher } from 'undici'

import { resolveProxyDispatcher } from '../net-proxy'
import { FORGE_TIMEOUT_BASE_MS, scaledTimeout } from '../net-timeouts'
import { checkRemote } from './remote-guard'
import { BRAND } from '../../../shared/brand'

/**
 * GH45 — appels HTTP vers l'API d'une forge (GitHub, Forgejo/Gitea) : même garde d'URL que git
 * (anti-SSRF côté web), même proxy d'entreprise que le reste de l'app, délais bornés.
 *
 * Sécurité : ni les en-têtes (jeton, mot de passe en Basic Auth, code OTP) ni le corps de la requête
 * n'apparaissent jamais dans une erreur levée ici — seulement la méthode, l'URL, le statut et le
 * message renvoyé par la forge.
 */

export interface ForgeRequestOptions {
  method?: Dispatcher.HttpMethod
  /** Jeton d'accès (`Authorization: token …`). */
  token?: string
  /** Identifiant + mot de passe (Basic Auth) — uniquement pour créer un jeton. */
  basic?: { login: string; password: string }
  /** Code 2FA (en-tête `X-Gitea-OTP`, accepté par Forgejo et Gitea). */
  otp?: string
  json?: unknown
  headers?: Record<string, string>
  /** Délai en-têtes / corps en ms (défaut 20 s), pour le réglage réseau par défaut — mis à l'échelle (GH15). */
  timeoutMs?: number
  /**
   * URL fixe du code (API GitHub), jamais fournie par l'utilisateur : le garde anti-SSRF du web
   * (hôtes git autorisés) ne s'applique pas — api.github.com n'est pas un hôte git.
   */
  fixedUrl?: boolean
}

export class ForgeHttpError extends Error {
  constructor(
    readonly status: number,
    /** Message renvoyé par la forge (`{"message": …}`), ou début du corps texte. */
    readonly forgeMessage: string,
    readonly url: string,
    readonly contentType: string,
    /** URL finale (après redirections). */
    readonly finalUrl: string = url,
  ) {
    super(`${url} → HTTP ${status}${forgeMessage ? ` : ${forgeMessage}` : ''}`)
    this.name = 'ForgeHttpError'
  }
}

export interface ForgeResponse<T> {
  status: number
  data: T
  headers: Record<string, string>
  /** URL finale (après redirections). */
  url: string
}

function extractMessage(text: string): string {
  try {
    const json = JSON.parse(text) as { message?: unknown }
    if (typeof json.message === 'string') return json.message
  } catch {
    // pas du JSON
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 200)
}

const MAX_REDIRECTS = 3

export async function forgeRequest<T = unknown>(url: string, opts: ForgeRequestOptions = {}): Promise<ForgeResponse<T>> {
  if (!opts.fixedUrl) checkRemote(url)
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': BRAND.productName, ...opts.headers }
  if (opts.token) headers['Authorization'] = `token ${opts.token}`
  if (opts.basic) {
    headers['Authorization'] = `Basic ${Buffer.from(`${opts.basic.login}:${opts.basic.password}`, 'utf-8').toString('base64')}`
  }
  if (opts.otp) headers['X-Gitea-OTP'] = opts.otp
  let body: string | undefined
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.json)
  }
  const timeout = scaledTimeout(opts.timeoutMs ?? FORGE_TIMEOUT_BASE_MS)
  const method = opts.method ?? 'GET'
  // undici.request ne suit pas les redirections (fetch le faisait) : suivies ici pour GET/HEAD
  // (http → https, hôte canonique), en repassant par le garde d'URL à chaque saut.
  let current = url
  let res = await undiciRequest(current, { method, headers, body, dispatcher: await resolveProxyDispatcher(current), headersTimeout: timeout, bodyTimeout: timeout })
  for (let hop = 0; hop < MAX_REDIRECTS && (method === 'GET' || method === 'HEAD') && res.statusCode >= 300 && res.statusCode < 400; hop++) {
    const location = res.headers['location']
    if (typeof location !== 'string') break
    await res.body.dump()
    const next = new URL(location, current).toString()
    if (!opts.fixedUrl) checkRemote(next)
    // Jamais de jeton ni de mot de passe vers un autre hôte que celui demandé.
    if (new URL(next).host !== new URL(url).host) delete headers['Authorization']
    current = next
    res = await undiciRequest(current, { method, headers, dispatcher: await resolveProxyDispatcher(current), headersTimeout: timeout, bodyTimeout: timeout })
  }
  const text = await res.body.text()
  const flat: Record<string, string> = {}
  for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) flat[k] = Array.isArray(v) ? v.join(', ') : v
  const contentType = flat['content-type'] ?? ''
  if (res.statusCode >= 400) {
    throw new ForgeHttpError(res.statusCode, extractMessage(text), `${method} ${current}`, contentType, current)
  }
  let data: unknown = text
  if (contentType.includes('json') && text) {
    try { data = JSON.parse(text) } catch { /* corps non JSON malgré l'en-tête */ }
  }
  return { status: res.statusCode, data: data as T, headers: flat, url: current }
}

/** scheme + hôte (+ port) sans slash final ; lève une erreur pour une URL non http(s). */
export function normalizeBaseUrl(input: string): string {
  const url = new URL(input.trim())
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`URL non http(s) : ${input}`)
  return `${url.protocol}//${url.host}`
}
