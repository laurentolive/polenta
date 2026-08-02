import * as http from 'http'
import { Readable } from 'stream'
import { request as undiciRequest, type Dispatcher } from 'undici'
import type { HttpClient, GitHttpRequest, GitHttpResponse } from 'isomorphic-git/http/node'

import { resolveProxyDispatcher } from './net-proxy'

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
async function request({
  url,
  method = 'GET',
  headers = {},
  body,
}: GitHttpRequest): Promise<GitHttpResponse> {
  const dispatcher = await resolveProxyDispatcher(url)
  const reqBody = body ? (Array.isArray(body) ? Buffer.concat(body.map(chunk => Buffer.from(chunk))) : Readable.from(body)) : undefined

  const res = await undiciRequest(url, {
    dispatcher,
    method: method as Dispatcher.HttpMethod,
    headers,
    body: reqBody,
  })

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
    body: res.body[Symbol.asyncIterator](),
  }
}

const client: HttpClient = { request }
export default client
