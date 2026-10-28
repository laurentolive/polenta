/**
 * GH63 — politique du proxy Docker `polenta-docker-proxy` (design D2, §6.2). Liste fermée
 * méthode + chemin, défaut = refus. Les conteneurs, réseaux et volumes visés doivent appartenir au
 * kit (noms `polenta-*`, `forgejo-*`, `caddy`, ou projet compose `polenta-*`) ; le corps des
 * créations est inspecté (pas de privilège, de capacité ajoutée, d'espace de noms de l'hôte, ni de
 * montage hors /opt/polenta).
 */

export type Decision = { allow: true } | { allow: false; reason: string }

/** Résout un identifiant (nom ou id) en nom + projet compose, via le démon (lecture seule). */
export interface Resolver {
  container(idOrName: string): Promise<{ name: string; project?: string } | null>
  network(idOrName: string): Promise<{ name: string } | null>
}

export interface PolicyOptions {
  /** Réseau de bord GH61 (CADDY_MODE=external), autorisé en plus de polenta-*. */
  edgeNetwork?: string
  /** Préfixes de source autorisés pour les montages (bind). */
  bindPrefixes?: string[]
}

const DEFAULT_BIND_PREFIXES = ['/opt/polenta/']
// Montages en lecture seule utilisés par les compose du kit.
const READONLY_BINDS = new Set(['/etc/localtime'])
const FORBIDDEN_SOURCES = ['/', '/etc', '/root', '/var/run/docker.sock', '/run/docker.sock', '/proc', '/sys', '/dev', '/boot']

const KIT_CONTAINER_RE = /^\/?(polenta-[a-z0-9][a-z0-9_.-]*|forgejo-[a-z0-9][a-z0-9-]*|caddy)$/
// Renommage temporaire de compose lors d'une recréation : <id court>_<nom>.
const RECREATE_NAME_RE = /^[0-9a-f]{12}_(polenta-[a-z0-9][a-z0-9_.-]*|forgejo-[a-z0-9][a-z0-9-]*|caddy)$/
const KIT_PROJECT_RE = /^polenta-[a-z0-9][a-z0-9-]*$/

export function isKitContainer(c: { name: string; project?: string } | null): boolean {
  if (!c) return false
  return KIT_CONTAINER_RE.test(c.name) || (!!c.project && KIT_PROJECT_RE.test(c.project))
}

/** Réseau du proxy lui-même (deploy/admin/docker-compose.yml) : aucun conteneur ne peut y être rattaché. */
export const PROXY_NETWORK = 'polenta-docker-proxy-net'

export function isKitNetwork(name: string, opts: PolicyOptions): boolean {
  if (name === PROXY_NETWORK) return false
  return /^polenta-[A-Za-z0-9_.-]+$/.test(name) || (!!opts.edgeNetwork && name === opts.edgeNetwork)
}

const deny = (reason: string): Decision => ({ allow: false, reason })
const ALLOW: Decision = { allow: true }

/** Chemin sans préfixe de version d'API (`/v1.47/containers/json` → `/containers/json`). */
export function stripVersion(pathname: string): string {
  return pathname.replace(/^\/v[0-9]+\.[0-9]+(?=\/)/, '')
}

function sourceAllowed(src: string, opts: PolicyOptions, readOnly: boolean): string | null {
  const norm = src.replace(/\/+$/, '') || '/'
  if (norm.includes('/../') || norm.endsWith('/..')) return `montage ${src} : chemin relatif refusé`
  if (READONLY_BINDS.has(norm)) return readOnly ? null : `montage ${src} en écriture refusé`
  if (FORBIDDEN_SOURCES.includes(norm)) return `montage ${src} refusé`
  const prefixes = opts.bindPrefixes ?? DEFAULT_BIND_PREFIXES
  if (!prefixes.some((p) => norm.startsWith(p))) return `montage ${src} hors des dossiers du kit`
  return null
}

type Json = Record<string, unknown>

/** Inspection du corps de `POST /containers/create`. */
export function checkCreateBody(body: Json, opts: PolicyOptions): Decision {
  const hc = (body.HostConfig ?? {}) as Json
  if (hc.Privileged === true) return deny('Privileged refusé')
  if (Array.isArray(hc.CapAdd) && hc.CapAdd.length) return deny(`CapAdd refusé (${hc.CapAdd.join(',')})`)
  for (const k of ['PidMode', 'IpcMode', 'UsernsMode', 'UTSMode', 'CgroupnsMode'] as const) {
    if (typeof hc[k] === 'string' && (hc[k] === 'host' || String(hc[k]).startsWith('container:'))) return deny(`${k}=${hc[k]} refusé`)
  }
  if (hc.NetworkMode === 'host' || String(hc.NetworkMode ?? '').startsWith('container:')) return deny(`NetworkMode=${hc.NetworkMode} refusé`)
  const nets = [
    ...(typeof hc.NetworkMode === 'string' && !['', 'default', 'bridge', 'none'].includes(hc.NetworkMode) ? [hc.NetworkMode] : []),
    ...Object.keys(((body.NetworkingConfig as Json | undefined)?.EndpointsConfig ?? {}) as Json),
  ]
  for (const n of nets) if (!isKitNetwork(n, opts)) return deny(`réseau ${n} refusé`)
  if (Array.isArray(hc.Devices) && hc.Devices.length) return deny('Devices refusé')
  if (Array.isArray(hc.DeviceRequests) && hc.DeviceRequests.length) return deny('DeviceRequests refusé')
  if (Array.isArray(hc.DeviceCgroupRules) && hc.DeviceCgroupRules.length) return deny('DeviceCgroupRules refusé')
  if (Array.isArray(hc.SecurityOpt)) {
    for (const opt of hc.SecurityOpt as unknown[]) {
      const s = String(opt).replace(/\s/g, '')
      if (/unconfined|no-new-privileges[:=]false|label[:=]disable|systempaths=unconfined/i.test(s)) return deny(`SecurityOpt ${s} refusé`)
    }
  }
  if (hc.Sysctls && typeof hc.Sysctls === 'object' && Object.keys(hc.Sysctls as Json).length) return deny('Sysctls refusé')
  if (hc.VolumeDriver) return deny('VolumeDriver refusé')
  if (Array.isArray(hc.VolumesFrom) && hc.VolumesFrom.length) return deny('VolumesFrom refusé')
  for (const b of (hc.Binds ?? []) as unknown[]) {
    const parts = String(b).split(':')
    const src = parts[0]
    const mode = parts.slice(2).join(':')
    if (!src.startsWith('/')) {
      if (!/^polenta-[A-Za-z0-9_.-]+$/.test(src)) return deny(`volume ${src} hors polenta-*`)
      continue
    }
    const why = sourceAllowed(src, opts, /\bro\b/.test(mode))
    if (why) return deny(why)
  }
  for (const m of (hc.Mounts ?? []) as Json[]) {
    const type = String(m.Type ?? 'volume')
    const src = String(m.Source ?? '')
    if (type === 'bind') {
      const why = sourceAllowed(src, opts, m.ReadOnly === true)
      if (why) return deny(why)
    } else if (type === 'volume') {
      if (src && !/^polenta-[A-Za-z0-9_.-]+$/.test(src)) return deny(`volume ${src} hors polenta-*`)
      if ((m.VolumeOptions as Json | undefined)?.DriverConfig) return deny('pilote de volume refusé')
    } else if (type !== 'tmpfs') {
      return deny(`montage de type ${type} refusé`)
    }
  }
  return ALLOW
}

/** Corps de `POST /containers/{id}/exec`. */
export function checkExecBody(body: Json): Decision {
  if (body.Privileged === true) return deny('exec Privileged refusé')
  return ALLOW
}

export interface RequestInfo {
  method: string
  /** Chemin sans la chaîne de requête. */
  path: string
  query: URLSearchParams
  body?: Json | null
}

/** Décision pour une requête ; `needsBody` : le proxy doit lire le corps JSON avant de décider. */
export function needsBody(method: string, path: string): boolean {
  const p = stripVersion(path)
  return method === 'POST' && (/^\/containers\/create$/.test(p) || /^\/containers\/[^/]+\/exec$/.test(p) || /^\/networks\/(create|[^/]+\/(connect|disconnect))$/.test(p) || p === '/volumes/create')
}

export async function decide(req: RequestInfo, resolver: Resolver, opts: PolicyOptions = {}): Promise<Decision> {
  const method = req.method.toUpperCase()
  const p = stripVersion(req.path)
  const read = method === 'GET' || method === 'HEAD'
  let m: RegExpExecArray | null

  // Démon : lectures sans effet.
  if (read && /^\/(_ping|version|info|events)$/.test(p)) return ALLOW
  if (method === 'HEAD' && p === '/_ping') return ALLOW

  // Conteneurs.
  if (read && p === '/containers/json') return ALLOW
  if (method === 'POST' && p === '/containers/create') {
    const name = req.query.get('name') ?? ''
    // compose recrée un conteneur sous un nom temporaire <id court>_<nom> avant de le renommer.
    if (!KIT_CONTAINER_RE.test(name) && !RECREATE_NAME_RE.test(name)) return deny(`création d'un conteneur hors kit (« ${name} »)`)
    if (!req.body) return deny('corps de création illisible')
    return checkCreateBody(req.body, opts)
  }
  if ((m = /^\/containers\/([^/]+)(\/[a-z]+)?$/.exec(p))) {
    const id = decodeURIComponent(m[1])
    const action = m[2] ?? ''
    const allowed =
      (read && ['/json', '/logs', '/top'].includes(action)) ||
      (method === 'POST' && ['/start', '/stop', '/restart', '/kill', '/wait', '/exec', '/rename'].includes(action)) ||
      (method === 'DELETE' && action === '')
    if (!allowed) return deny(`${method} /containers/{id}${action} hors liste`)
    const target = await resolver.container(id)
    if (!isKitContainer(target)) return deny(`conteneur étranger au kit (${id})`)
    if (action === '/rename') {
      const to = req.query.get('name') ?? ''
      if (!KIT_CONTAINER_RE.test(to) && !RECREATE_NAME_RE.test(to)) return deny(`renommage hors kit (« ${to} »)`)
    }
    if (action === '/exec') return checkExecBody(req.body ?? {})
    return ALLOW
  }
  if ((m = /^\/exec\/([^/]+)\/(start|json|resize)$/.exec(p))) {
    if (m[2] === 'json' ? read : method === 'POST') return ALLOW
    return deny(`${method} /exec/{id}/${m[2]} hors liste`)
  }

  // Réseaux.
  if (read && p === '/networks') return ALLOW
  if (method === 'POST' && p === '/networks/create') {
    const name = String(req.body?.Name ?? '')
    if (!isKitNetwork(name, opts)) return deny(`réseau hors kit (« ${name} »)`)
    if (req.body?.Driver && req.body.Driver !== 'bridge') return deny(`pilote réseau ${req.body.Driver} refusé`)
    return ALLOW
  }
  if ((m = /^\/networks\/([^/]+)(\/(connect|disconnect))?$/.exec(p))) {
    const allowed = (read && !m[2]) || (method === 'POST' && !!m[2]) || (method === 'DELETE' && !m[2])
    if (!allowed) return deny(`${method} /networks/{id}${m[2] ?? ''} hors liste`)
    if (read) return ALLOW
    const net = await resolver.network(decodeURIComponent(m[1]))
    if (!net || !isKitNetwork(net.name, opts)) return deny(`réseau étranger au kit (${m[1]})`)
    if (m[2]) {
      const c = String(req.body?.Container ?? '')
      const target = c ? await resolver.container(c) : null
      if (!isKitContainer(target)) return deny(`rattachement d'un conteneur étranger au kit (${c})`)
    }
    return ALLOW
  }

  // Images : tirage et lecture seulement (ni build, ni push, ni suppression).
  if (method === 'POST' && p === '/images/create') {
    if (req.query.get('fromSrc')) return deny('import d\'image refusé')
    return req.query.get('fromImage') ? ALLOW : deny('tirage sans image')
  }
  if (read && (p === '/images/json' || /^\/images\/.+\/json$/.test(p) || /^\/distribution\/.+\/json$/.test(p))) return ALLOW

  // Volumes : lecture, et volumes nommés polenta-* seulement.
  if (read && p === '/volumes') return ALLOW
  if ((m = /^\/volumes\/([^/]+)$/.exec(p)) && (read || method === 'DELETE')) {
    return /^polenta-[A-Za-z0-9_.-]+$/.test(decodeURIComponent(m[1])) ? ALLOW : deny(`volume hors polenta-* (${m[1]})`)
  }
  if (method === 'POST' && p === '/volumes/create') {
    const name = String(req.body?.Name ?? '')
    return /^polenta-[A-Za-z0-9_.-]+$/.test(name) && !req.body?.Driver ? ALLOW : deny(`volume hors polenta-* (« ${name} »)`)
  }

  return deny(`${method} ${p} hors liste`)
}
