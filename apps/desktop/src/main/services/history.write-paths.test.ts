import * as fs from 'fs'
import * as path from 'path'
import { expect, it } from 'vitest'

// GH77 — garde-fou (scénario W12 de specs/GH77-tests.md) : un fichier d'exigence, de test ou de
// campagne n'est écrit que par la méthode d'écriture désignée de son service, qui alimente
// l'historique (`HistoryService.stamp`). Un nouvel appel `writeYaml` sur `requirements/`,
// `tests/` ou `campaigns/` ailleurs fait échouer ce test : le brancher sur la méthode désignée,
// ou, s'il ne change aucune valeur suivie par construction, l'ajouter ici en le justifiant.

const ALLOWED = new Set([
  'main/services/requirements.service.ts#persist',
  'main/services/tests.service.ts#persist',
  'main/services/campaigns.service.ts#persist',
  // Pose / levée de needsRevalidation : passe par `history.stamp` (comble un trou éventuel).
  'main/services/revalidation.service.ts#writeElement',
])

const SRC = path.resolve(__dirname, '../..')
const OBJECT_WRITE = /\.write(Yaml|Text|File)\([^\n]*(`(requirements|tests|campaigns)\/|\$\{dir\}\/)/
const METHOD = /^ {2}(?:(?:private|public|protected|static|async|readonly) )*(\w+)\s*[(<]/

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sources(full)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : []
  })
}

it('W12 — aucune écriture d\'objet hors des méthodes d\'écriture désignées', () => {
  const found = new Set<string>()
  for (const file of [...sources(path.join(SRC, 'main')), ...sources(path.join(SRC, 'mcp-server'))]) {
    const lines = fs.readFileSync(file, 'utf-8').split(/\r?\n/)
    lines.forEach((line, i) => {
      if (!OBJECT_WRITE.test(line)) return
      let method = '?'
      for (let j = i; j >= 0; j--) {
        const m = METHOD.exec(lines[j])
        if (m) { method = m[1]; break }
      }
      found.add(`${path.relative(SRC, file).split(path.sep).join('/')}#${method}`)
    })
  }
  expect([...found].sort()).toEqual([...ALLOWED].sort())
})
