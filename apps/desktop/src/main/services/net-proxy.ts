import { session } from 'electron'
import { ProxyAgent, type Dispatcher } from 'undici'

// Les réseaux d'entreprise exposent rarement HTTP_PROXY/HTTPS_PROXY comme variables
// d'environnement — le proxy y est en général configuré au niveau du système (WPAD/PAC ou
// poste par poste) et seule la pile réseau de Chromium (donc `session` côté Electron) le
// connaît. Le fetch global de Node (utilisé par le reste du service) ignore ces réglages
// système par défaut, d'où les échecs "fetch failed" sur les postes derrière un tel proxy.
const dispatcherCache = new Map<string, ProxyAgent>()

export async function resolveProxyDispatcher(targetUrl: string): Promise<Dispatcher | undefined> {
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

  if (!proxyUrl) return undefined

  let agent = dispatcherCache.get(proxyUrl)
  if (!agent) {
    agent = new ProxyAgent(proxyUrl)
    dispatcherCache.set(proxyUrl, agent)
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

// Traduit les erreurs réseau bas niveau (fetch/undici) en message compréhensible pour
// l'utilisateur final, avec la piste la plus probable (proxy/pare-feu/certificat).
export function describeFetchError(err: unknown): string {
  const isError = err instanceof Error
  const cause = isError ? (err.cause as { code?: string; message?: string } | undefined) : undefined
  const code = cause?.code
  const detail = cause?.message ?? (isError ? err.message : String(err))

  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return `Résolution DNS impossible — vérifiez la connexion internet du poste. (${detail})`
    case 'ECONNREFUSED':
      return `Connexion refusée — un pare-feu ou un proxy d'entreprise bloque probablement la requête. (${detail})`
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return `Délai de connexion dépassé — vérifiez le proxy/pare-feu de l'entreprise. (${detail})`
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
