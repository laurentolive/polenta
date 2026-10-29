import type { SchemaField } from './schema'

// GH195 — champ `link` {libellé | URL} (specs/GH195.md §1). Logique pure partagée par le main
// (normalisation à l'écriture, exports), le serveur MCP et le renderer (affichage, saisie).

export interface LinkValue {
  label?: string
  url: string
}

const HTTP_URL = /^https?:\/\/\S+$/i
const FILE_URL = /^file:\/\/\S+$/i
// Chemin réseau `\\serveur\partage\…` : espaces admis dans le chemin, pas dans le nom du serveur.
const UNC_PATH = /^\\\\[^\\/\s]+\\.+$/

/** Schémas acceptés (spec §1.3) : `http(s)://`, `file://`, chemin réseau UNC. */
export function isAcceptedLinkUrl(url: string): boolean {
  const u = url.trim()
  return HTTP_URL.test(u) || FILE_URL.test(u) || UNC_PATH.test(u)
}

/** Lien ouvrable sans confirmation, et seul cliquable dans le client web. */
export function isHttpLinkUrl(url: string): boolean {
  return HTTP_URL.test(url.trim())
}

export function isLinkValue(v: unknown): v is LinkValue {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { url?: unknown }).url === 'string'
}

/** Une ligne de la forme texte (§1.6) : `libellé | URL` (dernier `|`) ou `URL` seule. Vide → null. */
export function parseLinkLine(line: string): LinkValue | null {
  const text = line.trim()
  if (!text) return null
  const bar = text.lastIndexOf('|')
  if (bar < 0) return { url: text }
  const label = text.slice(0, bar).trim()
  const url = text.slice(bar + 1).trim()
  if (!url) return label ? { url: label } : null
  return label ? { label, url } : { url }
}

/** Forme texte multi-lignes : un lien par ligne non vide. */
export function parseLinksText(text: string): LinkValue[] {
  return text.split(/\r?\n/).map(parseLinkLine).filter((l): l is LinkValue => l !== null)
}

export function formatLinkText(link: LinkValue): string {
  return link.label ? `${link.label} | ${link.url}` : link.url
}

export function formatLinksText(links: LinkValue[]): string {
  return links.map(formatLinkText).join('\n')
}

/** Libellé affiché : le libellé, ou l'URL quand il est vide. */
export function linkDisplayText(link: LinkValue): string {
  return link.label || link.url
}

/**
 * Valeur stockée, quelle que soit sa forme (§1.2) : chaîne (forme texte), objet `{label?, url}`,
 * liste de l'un ou l'autre. Les éléments sans URL sont ignorés.
 */
export function readLinkValues(raw: unknown): LinkValue[] {
  if (raw === undefined || raw === null) return []
  if (typeof raw === 'string') return parseLinksText(raw)
  if (Array.isArray(raw)) return raw.flatMap(readLinkValues)
  if (isLinkValue(raw)) {
    const url = raw.url.trim()
    if (!url) return []
    const label = typeof raw.label === 'string' ? raw.label.trim() : ''
    return [label ? { label, url } : { url }]
  }
  return []
}

export type LinkNormalization =
  | { ok: true; value: LinkValue | LinkValue[] | undefined }
  | { ok: false; reason: string }

/**
 * Valeur à écrire pour un champ `link` modifié : objet (simple) ou liste (`multiple`), `undefined`
 * si vide. Refuse une URL hors §1.3, un libellé avec `|` ou saut de ligne, plusieurs liens sur un
 * champ simple.
 */
export function normalizeLinkField(field: Pick<SchemaField, 'name' | 'multiple'>, raw: unknown): LinkNormalization {
  const links = readLinkValues(raw)
  for (const l of links) {
    if (!isAcceptedLinkUrl(l.url)) {
      return { ok: false, reason: `URL refusée pour '${field.name}' : "${l.url}" (schémas acceptés : http(s)://, file://, \\\\serveur\\partage)` }
    }
    if (l.label && /[|\r\n]/.test(l.label)) {
      return { ok: false, reason: `libellé refusé pour '${field.name}' : "${l.label}" (pas de « | » ni de saut de ligne)` }
    }
  }
  if (links.length === 0) return { ok: true, value: undefined }
  if (field.multiple) return { ok: true, value: links }
  if (links.length > 1) return { ok: false, reason: `un seul lien attendu pour '${field.name}' (${links.length} saisis)` }
  return { ok: true, value: links[0] }
}

/** `String(v)` pour l'édition en texte, les liens en forme texte (§1.6). */
export function fieldValueToText(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (isLinkValue(v) || (Array.isArray(v) && v.length > 0 && v.every(isLinkValue))) return formatLinksText(readLinkValues(v))
  return String(v)
}
