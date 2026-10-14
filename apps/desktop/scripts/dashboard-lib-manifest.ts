/**
 * GH74 — manifeste de la bibliothèque de départ (`resources/dashboard-lib/manifest.json`) : toutes
 * les versions livrées de chaque fichier, avec leur empreinte. Un projet dont le fichier a
 * l'empreinte d'une version antérieure se voit proposer la mise à jour (specs/GH74.md §6.3).
 *
 * Après modification d'un fichier livré :
 *   tsx scripts/dashboard-lib-manifest.ts --bump <fichier> "<résumé fr>" "<résumé en>"
 * ajoute une version (n + 1) avec l'empreinte du contenu actuel. Les versions passées ne sont
 * jamais retirées. `--check` (et `src/main/services/dashboard-lib.test.ts`, L11) vérifie que la dernière empreinte de
 * chaque fichier est celle du contenu livré.
 */
import * as fs from 'fs'
import * as path from 'path'
import { contentHash } from '../src/main/services/dashboard-library.service'
import type { ShippedManifest } from '../src/main/services/dashboard-library.service'

export const SHIPPED_DIR = path.resolve(__dirname, '../resources/dashboard-lib')
const MANIFEST = path.join(SHIPPED_DIR, 'manifest.json')

/** Fichiers livrés et leur emplacement dans le repo du projet. */
export const SHIPPED_FILES: { path: string; repoPath: string; id: string }[] = [
  { path: 'time.js', repoPath: 'dashboards/lib/time.js', id: 'time' },
  { path: 'status.js', repoPath: 'dashboards/lib/status.js', id: 'status' },
  { path: 'history.js', repoPath: 'dashboards/lib/history.js', id: 'history' },
  { path: 'campaign.js', repoPath: 'dashboards/lib/campaign.js', id: 'campaign' },
  { path: 'maturity.js', repoPath: 'dashboards/lib/maturity.js', id: 'maturity' },
  { path: 'polenta.d.ts', repoPath: 'dashboards/lib/polenta.d.ts', id: 'polenta-types' },
  { path: 'jsconfig.json', repoPath: 'dashboards/jsconfig.json', id: 'jsconfig' },
]

export function readManifest(): ShippedManifest {
  return fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as ShippedManifest : { files: [] }
}

/** Fichiers dont la dernière version du manifeste ne correspond pas au contenu livré. */
export function staleFiles(manifest: ShippedManifest = readManifest()): string[] {
  return SHIPPED_FILES.filter((f) => {
    const entry = manifest.files.find((m) => m.path === f.path)
    const last = entry?.versions[entry.versions.length - 1]
    return !last || last.hash !== contentHash(fs.readFileSync(path.join(SHIPPED_DIR, f.path), 'utf8'))
  }).map((f) => f.path)
}

function write(manifest: ShippedManifest): void {
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const manifest = readManifest()
  if (args[0] === '--check') {
    const stale = staleFiles(manifest)
    if (stale.length) {
      console.error(`Manifeste à mettre à jour (--bump) : ${stale.join(', ')}`)
      process.exit(1)
    }
  } else if (args[0] === '--bump') {
    const [, file, fr, en] = args
    const def = SHIPPED_FILES.find((f) => f.path === file)
    if (!def || !fr || !en) throw new Error('Usage : --bump <fichier> "<résumé fr>" "<résumé en>"')
    let entry = manifest.files.find((m) => m.path === file)
    if (!entry) {
      entry = { ...def, versions: [] }
      manifest.files.push(entry)
    }
    const version = (entry.versions[entry.versions.length - 1]?.version ?? 0) + 1
    entry.versions.push({ version, hash: contentHash(fs.readFileSync(path.join(SHIPPED_DIR, file), 'utf8')), summary: { fr, en } })
    write(manifest)
    console.log(`${file} : version ${version}`)
  } else {
    throw new Error('Usage : --check | --bump <fichier> "<résumé fr>" "<résumé en>"')
  }
}
