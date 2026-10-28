import { session } from 'electron'
import { Agent, ProxyAgent, type Dispatcher } from 'undici'
import { CONNECT_TIMEOUT_BASE_MS, getNetworkTimeoutSeconds, isNetworkTimeoutAdjustable, scaledTimeout } from './net-timeouts'

// Les réseaux d'entreprise exposent rarement HTTP_PROXY/HTTPS_PROXY comme variables
// d'environnement — le proxy y est en général configuré au niveau du système (WPAD/PAC ou
// poste par poste) et seule la pile réseau de Chromium (donc `session` côté Electron) le
// connaît. Le fetch global de Node (utilisé par le reste du service) ignore ces réglages
// système par défaut, d'où les échecs "fetch failed" sur les postes derrière un tel proxy.
// GH15 — le délai de connexion (TCP + TLS) est toujours explicite, réglable : en connexion directe
// comme via proxy, où c'est la négociation TLS avec la cible à travers le tunnel (`requestTls`)
// qui expire sur un lien filtré. Cache par (proxy, délai) : un changement de réglage vaut pour
// la requête suivante, les agents précédents servent encore les requêtes en cours.
const dispatcherCache = new Map<string, Dispatcher>()

export async function resolveProxyDispatcher(targetUrl: string): Promise<Dispatcher> {
  const envProxy =
    process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
  let proxyUrl = envProxy ? normalizeProxyUrl(envProxy) : undefined

  if (!proxyUrl) {
    try {
      const proxyString = await session.defaultSession.resolveProxy(targetUrl)
      proxyUrl = parseChromiumProxyString(proxyString)
    } catch {
      // resolveProxy est best-effort — en cas d'échec on retombe sur une connexion directe
    }
  }

  const timeout = scaledTimeout(CONNECT_TIMEOUT_BASE_MS)
  const key = `${proxyUrl ?? 'DIRECT'}|${timeout}`
  let agent = dispatcherCache.get(key)
  if (!agent) {
    agent = proxyUrl
      ? new ProxyAgent({ uri: proxyUrl, proxyTls: { timeout }, requestTls: { timeout } })
      : new Agent({ connect: { timeout } })
    dispatcherCache.set(key, agent)
  }
  return agent
}

function normalizeProxyUrl(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
}

// Chromium renvoie des chaînes du type "PROXY host:port; DIRECT" ou "DIRECT"
function parseChromiumProxyString(proxyString: string): string | undefined {
  const first = proxyString.split(';')[0]?.trim()
  if (!first || first === 'DIRECT') return undefined
  const match = first.match(/^PROXY\s+(.+)$/i)
  if (!match) return undefined
  return `http://${match[1].trim()}`
}

const UNREACHABLE_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
])
// Message stderr de `git fetch` en CLI (remotes SSH) quand le serveur est injoignable.
const UNREACHABLE_GIT_STDERR = /could not resolve host|network is unreachable|connection timed out|connection refused|operation timed out/i

// GH43 : le serveur git est injoignable (poste hors ligne, DNS, coupure) — à distinguer d'une
// erreur d'authentification ou d'un push refusé, qui elles méritent d'être remontées.
export function isNetworkUnreachable(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const code = (err as { code?: unknown }).code
  const causeCode = (err.cause as { code?: unknown } | undefined)?.code
  if (UNREACHABLE_CODES.has(String(code)) || UNREACHABLE_CODES.has(String(causeCode))) return true
  return UNREACHABLE_GIT_STDERR.test(err.message)
}

const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'])

// `undici.request` porte le code sur l'erreur elle-même, `fetch` sur sa cause.
function errorCode(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined
  const code = (err as { code?: unknown }).code ?? (err.cause as { code?: unknown } | undefined)?.code
  return typeof code === 'string' ? code : undefined
}

/** GH15 — délai d'attente dépassé (connexion, en-têtes ou corps). */
export function isTimeoutError(err: unknown): boolean {
  const code = errorCode(err)
  return code !== undefined && TIMEOUT_CODES.has(code)
}

/** GH15 — message d'un délai dépassé, qui cite le réglage à modifier quand il est proposé (desktop). */
export function describeTimeout(detail: string): string {
  if (!isNetworkTimeoutAdjustable()) {
    return `Délai d'attente dépassé — vérifiez le proxy/pare-feu de l'entreprise. (${detail})`
  }
  return `Délai d'attente dépassé (délai de connexion réseau : ${getNetworkTimeoutSeconds()} s) — augmentez-le dans Compte → Délai de connexion réseau si le réseau est lent ou filtré, ou vérifiez le proxy/pare-feu de l'entreprise. (${detail})`
}

// Traduit les erreurs réseau bas niveau (fetch/undici) en message compréhensible pour
// l'utilisateur final, avec la piste la plus probable (proxy/pare-feu/certificat).
export function describeFetchError(err: unknown): string {
  const isError = err instanceof Error
  const cause = isError ? (err.cause as { code?: string; message?: string } | undefined) : undefined
  const code = errorCode(err)
  const detail = cause?.message ?? (isError ? err.message : String(err))

  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `Résolution DNS impossible — vérifiez la connexion internet du poste. (${detail})`
    case 'ECONNREFUSED':
      return `Connexion refusée — un pare-feu ou un proxy d'entreprise bloque probablement la requête. (${detail})`
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
    case 'UND_ERR_HEADERS_TIMEOUT':
    case 'UND_ERR_BODY_TIMEOUT':
      return describeTimeout(detail)
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'CERT_HAS_EXPIRED':
      return `Certificat SSL non reconnu — probable proxy d'entreprise avec inspection SSL (certificat racine de l'entreprise à installer sur ce poste). (${detail})`
    default:
      if (isError && err.message === 'fetch failed') {
        return `Échec de connexion réseau — vérifiez le proxy/pare-feu de l'entreprise sur ce poste. (${detail})`
      }
      return isError ? err.message : String(err)
  }
}
