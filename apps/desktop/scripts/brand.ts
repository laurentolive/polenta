/**
 * GH49 — chargement et validation d'une marque (`apps/desktop/brands/<id>/`), au build
 * uniquement : electron.vite.config.ts, scripts/package.ts, scripts/build-mcp-server.ts,
 * scripts/register-brand.ts. Le code applicatif lit la marque via `src/shared/brand.ts`.
 *
 * La marque est désignée par POLENTA_BRAND (défaut `polenta`). Toute anomalie lève une
 * BrandError qui fait échouer le build — jamais de repli silencieux sur Polenta (spec §3.2).
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { themeTokens } from '../src/renderer/theme.config'
import type { BrandInfo, BrandTheme, BrandUpdate } from '../src/shared/brand-types'

export const DEFAULT_BRAND_ID = 'polenta'
export const BRANDS_ROOT = path.resolve(__dirname, '../brands')

const ID_RE = /^[a-z0-9-]+$/
const RGB_RE = /^(\d{1,3}) (\d{1,3}) (\d{1,3})$/
// productName nomme le dossier userData, le raccourci et l'exécutable : caractères interdits dans un
// nom de fichier Windows exclus, ainsi qu'un point ou une espace finale.
const FILE_NAME_FORBIDDEN_RE = /[<>:"/\\|?*\u0000-\u001f]|[. ]$/
const ICON_FILES = { ico: 'icon.ico', png: 'icon.png', png256: 'icon-256.png', svg: 'icon.svg' } as const

export class BrandError extends Error {
  constructor(id: string, problem: string) {
    super(`[brand ${id}] ${problem}`)
    this.name = 'BrandError'
  }
}

export interface LoadedBrand {
  info: BrandInfo
  theme: BrandTheme
  dir: string
  icons: Record<keyof typeof ICON_FILES, string>
  /** Icône de l'onglet du renderer : `favicon.svg` si fourni, sinon `icon.svg`. */
  faviconPath: string
  logoPath?: string
}

export function resolveBrandId(env: NodeJS.ProcessEnv = process.env): string {
  return env['POLENTA_BRAND']?.trim() || DEFAULT_BRAND_ID
}

function requiredString(id: string, raw: Record<string, unknown>, key: string, where = ''): string {
  const v = raw[key]
  if (typeof v !== 'string' || !v.trim()) throw new BrandError(id, `clé obligatoire « ${where}${key} » absente ou vide dans brand.yaml`)
  return v.trim()
}

function optionalString(id: string, raw: Record<string, unknown>, key: string, where = ''): string | undefined {
  const v = raw[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string' || !v.trim()) throw new BrandError(id, `« ${where}${key} » doit être une chaîne non vide`)
  return v.trim()
}

function parseUpdate(id: string, raw: unknown): BrandUpdate | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new BrandError(id, '« update » doit être un objet')
  const u = raw as Record<string, unknown>
  const provider = u['provider']
  if (provider === 'github') {
    return { provider, owner: requiredString(id, u, 'owner', 'update.'), repo: requiredString(id, u, 'repo', 'update.') }
  }
  if (provider === 'generic') {
    const releasesUrl = optionalString(id, u, 'releasesUrl', 'update.')
    return { provider, url: requiredString(id, u, 'url', 'update.'), ...(releasesUrl ? { releasesUrl } : {}) }
  }
  throw new BrandError(id, `« update.provider » inconnu : ${JSON.stringify(provider)} (attendu : github | generic)`)
}

function parseRgb(id: string, token: string, variant: string, value: unknown): string {
  const m = typeof value === 'string' ? RGB_RE.exec(value.trim()) : null
  if (!m || m.slice(1).some(c => Number(c) > 255)) {
    throw new BrandError(id, `theme.${token}.${variant} : triplet RGB invalide ${JSON.stringify(value)} (attendu "R G B", 0–255)`)
  }
  return value as string
}

function parseTheme(id: string, raw: unknown): BrandTheme {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new BrandError(id, '« theme » doit être un objet')
  const theme: BrandTheme = {}
  for (const [token, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(token in themeTokens)) throw new BrandError(id, `theme : token inconnu « ${token} » (voir src/renderer/theme.config.ts)`)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BrandError(id, `theme.${token} doit être un objet { light, dark }`)
    const v = value as Record<string, unknown>
    const unknownKeys = Object.keys(v).filter(k => k !== 'light' && k !== 'dark')
    if (unknownKeys.length) throw new BrandError(id, `theme.${token} : clé inconnue « ${unknownKeys[0]} » (attendu : light, dark)`)
    theme[token] = {
      ...(v['light'] !== undefined ? { light: parseRgb(id, token, 'light', v['light']) } : {}),
      ...(v['dark'] !== undefined ? { dark: parseRgb(id, token, 'dark', v['dark']) } : {}),
    }
  }
  return theme
}

function deriveReleasesUrl(update: BrandUpdate | undefined): string | undefined {
  if (!update) return undefined
  if (update.provider === 'github') return `https://github.com/${update.owner}/${update.repo}/releases`
  return update.releasesUrl
}

export function loadBrand(id: string = resolveBrandId(), brandsRoot: string = BRANDS_ROOT): LoadedBrand {
  if (!ID_RE.test(id)) throw new BrandError(id, `identifiant de marque invalide (attendu ${ID_RE.source})`)
  const dir = path.join(brandsRoot, id)
  const yamlPath = path.join(dir, 'brand.yaml')
  if (!existsSync(dir)) throw new BrandError(id, `dossier ${path.relative(path.dirname(brandsRoot), dir)} introuvable`)
  if (!existsSync(yamlPath)) throw new BrandError(id, 'brand.yaml introuvable')

  let parsed: unknown
  try {
    parsed = yaml.load(readFileSync(yamlPath, 'utf8'))
  } catch (err) {
    throw new BrandError(id, `brand.yaml illisible : ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new BrandError(id, 'brand.yaml doit être un objet YAML')
  const raw = parsed as Record<string, unknown>

  const declaredId = requiredString(id, raw, 'id')
  if (declaredId !== id) throw new BrandError(id, `« id: ${declaredId} » différent du nom du dossier (${id})`)
  const productName = requiredString(id, raw, 'productName')
  if (FILE_NAME_FORBIDDEN_RE.test(productName)) {
    throw new BrandError(id, `« productName » inutilisable comme nom de fichier : ${JSON.stringify(productName)} (interdits : < > : " / \\ | ? * et point/espace final)`)
  }
  const appId = requiredString(id, raw, 'appId')
  const executableName = optionalString(id, raw, 'executableName') ?? id
  if (!ID_RE.test(executableName)) throw new BrandError(id, `« executableName » invalide (attendu ${ID_RE.source})`)
  const website = optionalString(id, raw, 'website')
  const update = parseUpdate(id, raw['update'])
  const theme = parseTheme(id, raw['theme'])

  const icons = Object.fromEntries(
    Object.entries(ICON_FILES).map(([key, file]) => {
      const p = path.join(dir, file)
      if (!existsSync(p)) throw new BrandError(id, `icône manquante : ${file}`)
      return [key, p]
    }),
  ) as LoadedBrand['icons']
  const favicon = path.join(dir, 'favicon.svg')
  const logo = path.join(dir, 'logo.svg')
  const logoPath = existsSync(logo) ? logo : undefined
  const releasesUrl = deriveReleasesUrl(update)

  const info: BrandInfo = {
    id,
    productName,
    appId,
    executableName,
    ...(website ? { website } : {}),
    ...(update ? { update } : {}),
    ...(releasesUrl ? { releasesUrl } : {}),
    hasLogo: !!logoPath,
  }
  return { info, theme, dir, icons, faviconPath: existsSync(favicon) ? favicon : icons.svg, ...(logoPath ? { logoPath } : {}) }
}
