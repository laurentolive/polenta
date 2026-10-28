/**
 * GH158 — version de l'application, déduite du tag git au build (plus de bump manuel de
 * package.json) : electron.vite.config.ts, scripts/package.ts, scripts/build-web-server.ts.
 *
 * - commit portant le tag `vX.Y.Z` → `X.Y.Z` ;
 * - sinon → `<dernière release>-alpha.<commits depuis ce tag>` (ex. `0.1.3-alpha.5`) ;
 * - POLENTA_VERSION l'impose (image Docker : pas de `.git` dans le contexte de build) ;
 * - ni git ni tag → `version` de package.json (`0.0.0-dev`).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const DESCRIBE_RE = /^v(\d+\.\d+\.\d+)-(\d+)-g[0-9a-f]+$/

export function appVersion(): string {
  const forced = process.env['POLENTA_VERSION']?.trim()
  if (forced) return forced.replace(/^v/, '')
  try {
    const described = execFileSync('git', ['describe', '--tags', '--long', '--match', 'v[0-9]*.[0-9]*.[0-9]*'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const m = DESCRIBE_RE.exec(described)
    if (m) return m[2] === '0' ? m[1] : `${m[1]}-alpha.${m[2]}`
  } catch {
    // pas de git, ou aucun tag de release atteignable : repli sur package.json
  }
  return (JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }).version
}
