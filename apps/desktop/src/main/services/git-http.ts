import * as http from 'http'
import { Readable } from 'stream'
import { request as undiciRequest, type Dispatcher } from 'undici'
import type { HttpClient, GitHttpRequest, GitHttpResponse } from 'isomorphic-git/http/node'

import { describeTimeout, isTimeoutError, resolveProxyDispatcher } from './net-proxy'
import { GIT_IO_TIMEOUT_BASE_MS, scaledTimeout } from './net-timeouts'
import { checkRemote } from './forge/remote-guard'

/**
 * isomorphic-git's own `isomorphic-git/http/node` transport goes through Node's
 * `http`/`https` modules directly and has no notion of a proxy — on a corporate network
 * (proxy configured system-wide, no HTTP_PROXY env var) it attempts a direct connection
 * to the remote, which the firewall resets (`ECONNRESET`), even though the rest of the
 * app (GitHub login, `auth.service.ts`) already resolves the proxy correctly via
 * `resolveProxyDispatcher`. This client reimplements the same `HttpClient` contract on
 * top of `undici.request`, reusing that same proxy resolution for every git operation
 * (clone/fetch/push/pull).
 */
/** GH44 — alias conservé : le garde (forge/remote-guard.ts) couvre désormais aussi l'API de forge (GH45). */
export { setRemoteGuard as setGitRemoteGuard } from './forge/remote-guard'

/**
 * GH15 — un délai dépassé devient une erreur dont le message cite le réglage ; le code d'origine
 * est conservé pour que `isNetworkUnreachable` (auto-pull, Publier) la classe comme avant.
 */
function translateTimeout(err: unknown): unknown {
  if (!isTimeoutError(err)) return err
  const translated = new Error(describeTimeout((err as Error).message), { cause: err })
  return Object.assign(translated, { code: (err as { code?: unknown }).code })
}

// Le délai de corps peut expirer pendant la lecture du flux par isomorphic-git, après `request`.
async function* translateTimeouts(body: AsyncIterable<Uint8Array>): AsyncIterableIterator<Uint8Array> {
  try {
    yield* body
  } catch (err) {
    throw translateTimeout(err)
  }
}

async function request({
  url,
  method = 'GET',
  headers = {},
  body,
}: GitHttpRequest): Promise<GitHttpResponse> {
  checkRemote(url)
  const dispatcher = await resolveProxyDispatcher(url)
  const reqBody = body ? (Array.isArray(body) ? Buffer.concat(body.map(chunk => Buffer.from(chunk))) : Readable.from(body)) : undefined

  const timeout = scaledTimeout(GIT_IO_TIMEOUT_BASE_MS)
  let res: Dispatcher.ResponseData
  try {
    res = await undiciRequest(url, {
      dispatcher,
      method: method as Dispatcher.HttpMethod,
      headers,
      body: reqBody,
      headersTimeout: timeout,
      bodyTimeout: timeout,
    })
  } catch (err) {
    throw translateTimeout(err)
  }

  const flatHeaders: Record<string, string> = {}
  for (const [key, value] of Object.entries(res.headers)) {
    if (value === undefined) continue
    flatHeaders[key] = Array.isArray(value) ? value.join(', ') : value
  }

  return {
    url,
    method,
    statusCode: res.statusCode,
    statusMessage: http.STATUS_CODES[res.statusCode] ?? '',
    headers: flatHeaders,
    body: translateTimeouts(res.body),
  }
}

const client: HttpClient = { request }
export default client
