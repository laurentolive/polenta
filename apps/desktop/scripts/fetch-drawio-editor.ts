/**
 * GH46 — `pnpm drawio:fetch` : installe l'éditeur draw.io embarqué (webapp officielle, `draw.war`)
 * dans `vendor/drawio-editor/`, sans le copier dans git. Version, URL et SHA-256 fixés dans
 * `scripts/drawio-editor.json` ; entrées élaguées selon `scripts/drawio-prune.txt`. Idempotent
 * (marqueur `vendor/drawio-editor/.polenta-drawio-version`), `--force` pour réinstaller.
 *
 * Utilisé par `build:web` (et donc par le Dockerfile de `polenta-web`), jamais par le desktop.
 *   tsx scripts/fetch-drawio-editor.ts [--force]
 */
import * as fs from 'fs'
import * as path from 'path'
import PizZip from 'pizzip'
import { isPruned, isSafeEntryName, parsePruneRules, sha256Matches } from './drawio-editor-lib'

const root = path.resolve(__dirname, '..')
const dest = path.join(root, 'vendor', 'drawio-editor')
const marker = path.join(dest, '.polenta-drawio-version')
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'drawio-editor.json'), 'utf8')) as {
  version: string; url: string; sha256: string
}
const rules = parsePruneRules(fs.readFileSync(path.join(__dirname, 'drawio-prune.txt'), 'utf8'))
const force = process.argv.includes('--force')

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

async function main(): Promise<void> {
  if (!force && fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === spec.version) {
    console.log(`[drawio:fetch] éditeur ${spec.version} déjà installé (${dest})`)
    return
  }

  console.log(`[drawio:fetch] téléchargement de ${spec.url}`)
  const res = await fetch(spec.url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`Téléchargement ${spec.url} : HTTP ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())

  // Rien n'est extrait avant la vérification : un fichier altéré ou tronqué n'entre jamais dans le build.
  if (!sha256Matches(bytes, spec.sha256)) {
    throw new Error(`SHA-256 de draw.war inattendu (épinglé : ${spec.sha256}) : téléchargement rejeté`)
  }

  const zip = new PizZip(Buffer.from(bytes))
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })

  let files = 0
  let written = 0
  let pruned = 0
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    if (!isSafeEntryName(name)) throw new Error(`Entrée refusée dans draw.war : ${name}`)
    if (isPruned(name, rules)) {
      pruned += 1
      continue
    }
    const target = path.join(dest, ...name.split('/'))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const content = entry.asNodeBuffer()
    fs.writeFileSync(target, content)
    files += 1
    written += content.length
  }

  fs.writeFileSync(marker, spec.version + '\n')
  console.log(`[drawio:fetch] éditeur ${spec.version} : ${files} fichiers, ${mb(written)} Mo après élagage (${pruned} entrées élaguées) → ${dest}`)
}

main().catch(err => {
  console.error(`[drawio:fetch] échec : ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
