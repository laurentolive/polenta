// GH63 — S5-28 : chaque opération du catalogue (et des routes de lecture S5) figure dans le tableau
// « opération ↔ commande SSH » du RUNBOOK (A17).
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REGISTRY } from '../src/jobs/registry'

describe('RUNBOOK A17', () => {
  it('le tableau couvre tout le catalogue', () => {
    const runbook = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'deploy', 'RUNBOOK.md'), 'utf8')
    const section = runbook.slice(runbook.indexOf('### A17.'), runbook.indexOf('## Partie B'))
    const ids = [...REGISTRY.keys(), 'instance.list', 'backup.list', 'users.accessReport', 'users.invite']
    const missing = ids.filter((id) => !section.includes(`| \`${id}\` |`))
    expect(missing).toEqual([])
  })
})
