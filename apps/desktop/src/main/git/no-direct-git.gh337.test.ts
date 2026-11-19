import * as fs from 'fs'
import * as path from 'path'
import { describe, expect, it } from 'vitest'

/**
 * GH337 — règle anti-import (design §1, spec §4.1 et §5.2) : hors de `GitBackend` (`src/main/git/`),
 * aucun fichier de production ni script ne lance `git` (`spawn` / `execFile` avec `'git'`) ni
 * n'importe `isomorphic-git` ou `async-lock`. Tests et e2e mis à part (fixtures : `test-repo.test-util.ts`).
 *
 * Pas d'ESLint dans le dépôt : ce test est la vérification.
 */

const DESKTOP = path.resolve(__dirname, '..', '..', '..')
const SCANNED = ['src', 'scripts']

/** Exceptions documentées : code de build exécuté hors de l'application (voir le fichier). */
const ALLOWED_GIT_SPAWN = new Set([
  // Script de build, hors de l'application livrée : `git describe` lit la version dans les tags du
  // dépôt (GH158) sur le poste de build, avant que `vendor/git` existe. Il ne tourne jamais dans
  // Polenta à l'exécution, donc il ne passe pas par GitBackend. Exception gardée par décision de
  // l'humain (2026-11-19, specs/GH337-sprint4.md point 1) : ne pas l'étendre à un autre fichier.
  'scripts/app-version.ts',
])

const ENGINE_IMPORT = /(?:from|import|require)\s*\(?\s*['"](?:isomorphic-git|async-lock)(?:\/[^'"]*)?['"]/
const GIT_SPAWN = /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)\w*\s*\(\s*['"`]git(?:['"`]|\s)/

function listSources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'out') continue
      // `src/main/git/` : la couche GitBackend elle-même, où le git est lancé et les moteurs lus.
      if (path.relative(DESKTOP, abs).replace(/\\/g, '/') === 'src/main/git') continue
      listSources(abs, out)
    } else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name) && !/\.(test|spec)(-util)?\.[a-z]+$/.test(entry.name)) {
      out.push(abs)
    }
  }
  return out
}

describe('GH337 — aucun git hors de GitBackend', () => {
  const files = SCANNED.flatMap(d => listSources(path.join(DESKTOP, d)))

  it('la liste scannée contient les services (garde-fou contre un chemin mal résolu)', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(files.some(f => f.endsWith(path.join('services', 'sync.service.ts')))).toBe(true)
  })

  it('aucun import d\'isomorphic-git ni d\'async-lock', () => {
    const offenders = files.filter(f => ENGINE_IMPORT.test(fs.readFileSync(f, 'utf8')))
      .map(f => path.relative(DESKTOP, f).replace(/\\/g, '/'))
    expect(offenders).toEqual([])
  })

  it('aucun lancement de git (spawn / execFile avec \'git\') hors de src/main/git', () => {
    const offenders = files.filter(f => GIT_SPAWN.test(fs.readFileSync(f, 'utf8')))
      .map(f => path.relative(DESKTOP, f).replace(/\\/g, '/'))
      .filter(rel => !ALLOWED_GIT_SPAWN.has(rel))
    expect(offenders).toEqual([])
  })

  it('les exceptions listées lancent bien git (sinon elles doivent être retirées)', () => {
    for (const rel of ALLOWED_GIT_SPAWN) {
      expect(GIT_SPAWN.test(fs.readFileSync(path.join(DESKTOP, rel), 'utf8')), rel).toBe(true)
    }
  })
})
