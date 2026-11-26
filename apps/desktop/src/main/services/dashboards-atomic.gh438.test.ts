import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitService } from './git.service'
import { DashboardsService } from './dashboards.service'

// GH438 — un dashboard partagé lu pendant son écriture ne doit jamais apparaître comme absent.
// Cause : writeObjectFolder tronquait dashboard.yaml avant de l'écrire ; une lecture dans cette
// fenêtre voyait un fichier vide, donc « introuvable ».

let repo: string
let dashboards: DashboardsService
const U = 'alice'

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gh438-dash-'))
  dashboards = new DashboardsService(new GitService())
})
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }))

describe('GH438 — lecture pendant l\'écriture d\'un dashboard partagé', () => {
  it('200 écritures successives : aucune lecture concurrente ne reçoit null', async () => {
    const d = await dashboards.create(repo, U, { title: 'T0', scope: 'shared', createdBy: U })
    const absent: number[] = []
    let writing = true
    const writer = (async () => {
      try {
        for (let i = 1; i <= 200; i++) await dashboards.update(repo, U, d.id, { title: `T${i}` })
      } finally {
        writing = false
      }
    })()
    let reads = 0
    while (writing) {
      const got = await dashboards.get(repo, U, d.id)
      reads++
      if (!got) absent.push(reads)
    }
    await writer
    expect(reads).toBeGreaterThan(0)
    expect(absent).toEqual([])
    expect((await dashboards.get(repo, U, d.id))?.title).toBe('T200')
  })

  it('aucun fichier temporaire ne reste dans le dossier de l\'objet', async () => {
    const d = await dashboards.create(repo, U, { title: 'T0', scope: 'shared', createdBy: U })
    for (let i = 1; i <= 20; i++) await dashboards.update(repo, U, d.id, { title: `T${i}` })
    const files = fs.readdirSync(path.join(repo, 'dashboards', d.id)).sort()
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([])
    expect(files).toContain('dashboard.yaml')
  })
})
