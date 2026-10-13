import type { GraphDrillValue, GraphRow, PolentaHost } from './graph'

// GH74 — exécution des scripts de données et des transformations de widget (specs/GH74-design.md
// §1.2). Logique pure partagée par le main (moteur), le serveur MCP et le renderer.

export type ScriptErrorKind =
  | 'syntax' | 'import' | 'runtime' | 'timeout' | 'memory' | 'stack'
  | 'rows' | 'contract' | 'async' | 'export' | 'legacy-sql' | 'format' | 'spec'

export interface ScriptError {
  kind: ScriptErrorKind
  message: string
  /** `script.js`, `<widgetId>.js` (transformation), `lib/x.js`, `<composant>::lib/x.js`, ou `null`. */
  file: string | null
  line: number | null
  column: number | null
}

export interface ScriptColumn {
  name: string
  type: 'string' | 'number' | 'date' | 'boolean'
}

export type ScriptRunResult =
  | { ok: true; columns: ScriptColumn[]; rows: GraphRow[]; total: number; truncated: boolean; ms: number }
  | { ok: false; error: ScriptError }

/** Informations du client transmises à chaque exécution (le serveur web n'a ni la langue ni le
 *  fuseau de l'utilisateur). */
export interface ScriptClientInfo {
  locale: string
  timezone: string
}

export interface ScriptRunRequest {
  /** Requête enregistrée, OU script fourni (vue Requêtes non enregistrée, `test_script`). */
  queryId?: string
  script?: string
  /** Transformation fournie (aperçu, `test_script`). La transformation d'un widget enregistré est
   *  lue par le moteur à partir de `dashboardId` + `widgetId` (sprint 2). */
  transform?: string
  /** Nom de fichier rapporté dans les erreurs de la transformation (`<widgetId>.js`). */
  transformFile?: string
  drill?: Record<string, GraphDrillValue> | null
  /** Nombre maximal de lignes renvoyées (`total` donne le nombre réel). */
  limit?: number
}

/** Version de contrat déclarée par un script : `// @polenta contract <N>` en tête, défaut 1. */
export function parseContractHeader(script: string): number {
  const m = /^\s*\/\/\s*@polenta\s+contract\s+(\d+)\b/m.exec(script.slice(0, 2000))
  return m ? Number(m[1]) : 1
}

function describe(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'tableau'
  return typeof v
}

/** Contrôle de la sortie d'un script : tableau d'objets plats, valeurs scalaires, `_ids` (facultatif)
 *  tableau de chaînes. Renvoie le message d'erreur, ou `null`. */
export function validateRows(rows: unknown): string | null {
  if (!Array.isArray(rows)) return `Le script doit renvoyer un tableau de lignes (reçu : ${describe(rows)}).`
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r || typeof r !== 'object' || Array.isArray(r)) return `Ligne ${i} : objet attendu (reçu : ${describe(r)}).`
    for (const [k, v] of Object.entries(r)) {
      if (k === '_ids') {
        if (v !== undefined && (!Array.isArray(v) || v.some((x) => typeof x !== 'string'))) {
          return `Ligne ${i} : "_ids" doit être un tableau d'identifiants.`
        }
        continue
      }
      if (v !== null && v !== undefined && typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') {
        return `Ligne ${i}, colonne "${k}" : valeur non scalaire (${describe(v)}).`
      }
    }
  }
  return null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

/** Colonnes d'un résultat : union des clés dans l'ordre de première apparition (`_ids` exclu), type
 *  déduit de la première valeur non nulle. */
export function inferColumns(rows: readonly GraphRow[]): ScriptColumn[] {
  const types = new Map<string, ScriptColumn['type'] | null>()
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      if (k === '_ids') continue
      const known = types.get(k)
      if (known) continue
      let t: ScriptColumn['type'] | null = null
      if (typeof v === 'number') t = 'number'
      else if (typeof v === 'boolean') t = 'boolean'
      else if (typeof v === 'string') t = ISO_DATE.test(v) ? 'date' : 'string'
      types.set(k, t)
    }
  }
  return [...types].map(([name, t]) => ({ name, type: t ?? 'string' }))
}

/** Date `AAAA-MM-JJ` d'un instant dans un fuseau IANA (repli UTC si le fuseau est inconnu). */
export function dayInTimezone(instant: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant)
  } catch {
    return instant.toISOString().slice(0, 10)
  }
}

/** Décalage (minutes, local − UTC) d'un fuseau à un instant, via `Intl`. */
const offsetFormatters = new Map<string, Intl.DateTimeFormat>()

export function timezoneOffsetAt(instantMs: number, timezone: string): number {
  let fmt = offsetFormatters.get(timezone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    offsetFormatters.set(timezone, fmt)
  }
  const parts = fmt.formatToParts(new Date(instantMs))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((local - Math.floor(instantMs / 1000) * 1000) / 60000)
}

const offsetTables = new Map<string, { from: string; offsetMinutes: number }[]>()

/**
 * Changements de décalage d'un fuseau entre `fromYear` et `toYear` (inclus), à la minute près :
 * balayage par jour, puis dichotomie sur le jour du changement. Mis en cache par fuseau et période.
 */
export function timezoneOffsets(timezone: string, fromYear: number, toYear: number): { from: string; offsetMinutes: number }[] {
  const key = `${timezone}\u0000${fromYear}\u0000${toYear}`
  const known = offsetTables.get(key)
  if (known) return known
  const DAY = 86_400_000
  const start = Date.UTC(fromYear, 0, 1)
  const end = Date.UTC(toYear + 1, 0, 1)
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
  let current = timezoneOffsetAt(start, timezone)
  const out = [{ from: iso(start), offsetMinutes: current }]
  for (let t = start + DAY; t <= end; t += DAY) {
    const off = timezoneOffsetAt(t, timezone)
    if (off === current) continue
    let lo = t - DAY
    let hi = t
    while (hi - lo > 60_000) {
      const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000
      if (timezoneOffsetAt(mid, timezone) === current) lo = mid
      else hi = mid
    }
    out.push({ from: iso(hi), offsetMinutes: off })
    current = off
  }
  offsetTables.set(key, out)
  return out
}

/** `PolentaHost` d'une exécution. */
export function buildHost(
  client: ScriptClientInfo,
  contractVersion: number,
  now: Date,
  drill: Record<string, GraphDrillValue> | null = null,
): PolentaHost {
  const locale = client.locale.toLowerCase().startsWith('en') ? 'en' : 'fr'
  let timezone = client.timezone || 'UTC'
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone })
  } catch {
    timezone = 'UTC'
  }
  const year = now.getUTCFullYear()
  return {
    contractVersion,
    locale,
    timezone,
    timezoneOffsets: timezoneOffsets(timezone, year - 10, year + 2),
    today: dayInTimezone(now, timezone),
    now: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    drill,
  }
}
