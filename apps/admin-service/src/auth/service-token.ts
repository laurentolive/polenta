/**
 * GH63 — jetons de service par instance (design D5, §5.2). Le kit n'écrit que leur empreinte
 * SHA-256 dans `/opt/polenta/admin/service-tokens.json` (divergence S1 n°1 : aléa de 256 bits, pas de
 * mot de passe humain). Comparaison à temps constant contre **toutes** les empreintes, sans sortie
 * anticipée : la durée ne dit pas laquelle a (presque) correspondu.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

interface Entry {
  sha256: string
  createdAt?: string
}

export class ServiceTokens {
  private cache: { mtimeMs: number; entries: [string, Buffer][] } | null = null

  constructor(private readonly root: string) {}

  private get file(): string {
    return path.join(this.root, 'admin', 'service-tokens.json')
  }

  private entries(): [string, Buffer][] {
    let stat: fs.Stats
    try {
      stat = fs.statSync(this.file)
    } catch {
      return []
    }
    if (this.cache && this.cache.mtimeMs === stat.mtimeMs) return this.cache.entries
    let parsed: Record<string, Entry> = {}
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {
      parsed = {}
    }
    const entries: [string, Buffer][] = []
    for (const [name, e] of Object.entries(parsed)) {
      if (e && typeof e.sha256 === 'string' && /^[0-9a-f]{64}$/.test(e.sha256)) {
        entries.push([name, Buffer.from(e.sha256, 'hex')])
      }
    }
    this.cache = { mtimeMs: stat.mtimeMs, entries }
    return entries
  }

  /** Instance dont `token` est le jeton de service, ou `null`. */
  identify(token: string | undefined): string | null {
    if (!token) return null
    const digest = crypto.createHash('sha256').update(token, 'utf8').digest()
    let found: string | null = null
    for (const [name, hash] of this.entries()) {
      if (crypto.timingSafeEqual(digest, hash) && found === null) found = name
    }
    return found
  }
}

/** Empreinte courte d'un secret, pour les clés de cache et du limiteur (jamais la valeur). */
export function fingerprint(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex').slice(0, 16)
}
