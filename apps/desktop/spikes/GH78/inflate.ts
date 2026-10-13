/**
 * GH78 — jeu gonflé ×N : copie le workspace de démo (repos git compris) puis duplique N−1 fois
 * chaque exigence, test, campagne (entrées comprises), run et lien, en réécrivant les IDs
 * (`SYS-0001` → `SYS-20001` pour la copie 2), et commite dans chaque repo — les index lisent
 * les dates dans `git log`. Résultat : `spikes/GH78/.data/x<N>/` (ignoré par git).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import yaml from 'js-yaml'

const OBJECT_DIRS = ['requirements', 'tests', 'campaigns']

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => (d.isDirectory() ? listFiles(path.join(dir, d.name)) : [path.join(dir, d.name)]))
}

export function inflate(srcWs: string, outWs: string, factor: number): void {
  if (fs.existsSync(path.join(outWs, '.inflated'))) return
  fs.rmSync(outWs, { recursive: true, force: true })
  fs.cpSync(srcWs, outWs, { recursive: true })
  const repos = fs.readdirSync(outWs, { withFileTypes: true }).filter(d => d.isDirectory() && fs.existsSync(path.join(outWs, d.name, '.git'))).map(d => d.name)

  // IDs connus, tous repos confondus (les liens et entrées croisent les repos).
  const ids = new Set<string>()
  for (const r of repos) for (const d of OBJECT_DIRS) for (const f of listFiles(path.join(outWs, r, d))) if (f.endsWith('.yaml')) ids.add(path.basename(f, '.yaml'))
  const idRe = new RegExp(`\\b(${[...ids].sort((a, b) => b.length - a.length).map(i => i.replace(/[-]/g, '\\-')).join('|')})\\b`, 'g')
  const rewrite = (text: string, k: number) => text.replace(idRe, (id) => {
    const m = /^(.*)-(\d+)$/.exec(id)!
    return `${m[1]}-${k * 10000 + Number(m[2])}`
  })

  for (const r of repos) {
    const repoDir = path.join(outWs, r)
    const originals = [...OBJECT_DIRS, 'test-runs'].flatMap(d => listFiles(path.join(repoDir, d))).filter(f => f.endsWith('.yaml'))
    const linksFile = path.join(repoDir, 'links/links.yaml')
    const links = fs.existsSync(linksFile) ? ((yaml.load(fs.readFileSync(linksFile, 'utf8')) as { links?: Record<string, unknown>[] })?.links ?? []) : []
    const allLinks = [...links]
    for (let k = 2; k <= factor; k++) {
      for (const f of originals) {
        const rel = path.relative(repoDir, f)
        const target = path.join(repoDir, rewrite(rel.replace(/\\/g, '/'), k))
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, rewrite(fs.readFileSync(f, 'utf8'), k))
      }
      for (const l of links) allLinks.push({ ...l, id: `${l.id}_x${k}`, sourceId: rewrite(String(l.sourceId), k), targetId: rewrite(String(l.targetId), k) })
    }
    if (links.length) fs.writeFileSync(linksFile, yaml.dump({ links: allLinks }, { lineWidth: -1 }))
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=GH78 spike', '-c', 'user.email=spike@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: repoDir, stdio: 'pipe' })
    git('add', '-A')
    try { git('commit', '-q', '-m', `GH78 spike: jeu gonflé x${factor}`) } catch { /* rien à commiter (repo sans objets) */ }
  }
  fs.writeFileSync(path.join(outWs, '.inflated'), String(factor))
}
