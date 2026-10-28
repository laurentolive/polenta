import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CampaignsService } from './campaigns.service'
import { GitService } from './git.service'
import type { TestsService } from './tests.service'

// GH59 — filtre `level` de list() : une campagne sans `level` (écrite hors de l'app, ex. le
// générateur de démo) ne doit pas disparaître de la vue Campagnes.

let dir: string
let git: GitService
let service: CampaignsService

async function writeCampaign(id: string, extra: Record<string, unknown>): Promise<void> {
  await git.writeYaml(dir, `campaigns/${id}.yaml`, {
    id, title: id, fields: {}, status: 'planned', component: 'root', testCaseIds: [], runs: [],
    createdAt: `2026-10-0${id.slice(-1)}T00:00:00.000Z`, ...extra,
  })
}

beforeEach(async () => {
  dir = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-gh59-'))
  git = new GitService()
  service = new CampaignsService(git, {} as TestsService)
})

afterEach(async () => {
  await fsP.rm(dir, { recursive: true, force: true })
})

describe('CampaignsService.list — filtre level (GH59)', () => {
  it('garde les campagnes sans level, en lisant le type dans objectTypeRef', async () => {
    await writeCampaign('CAMP-0001', { level: 'campagne-produit', objectTypeRef: 'root::campagne-produit' })
    await writeCampaign('CAMP-0002', { objectTypeRef: 'root::campagne-produit' })
    await writeCampaign('CAMP-0003', { objectTypeRef: 'root::campagne-labo' })
    await writeCampaign('CAMP-0004', {})
    await writeCampaign('CAMP-0005', { level: 'campagne-labo' })

    const ids = (await service.list(dir, 'root', 'campagne-produit')).map(c => c.id)
    expect(ids).toEqual(['CAMP-0001', 'CAMP-0002', 'CAMP-0004'])
  })

  it('sans level demandé, renvoie toutes les campagnes du composant', async () => {
    await writeCampaign('CAMP-0001', { level: 'campagne-produit' })
    await writeCampaign('CAMP-0002', { component: 'bms' })
    expect((await service.list(dir, 'root')).map(c => c.id)).toEqual(['CAMP-0001'])
  })
})

describe('CampaignsService.list — filtre component (GH146)', () => {
  it("à défaut de component, lit le nœud dans objectTypeRef ; sans l'un ni l'autre, reste visible", async () => {
    // Forme écrite avant le correctif par « Générer la campagne » (analyse d'impact) : ni component ni level.
    const withoutComponent = (id: string, objectTypeRef: string) => git.writeYaml(dir, `campaigns/${id}.yaml`, {
      id, title: id, fields: {}, status: 'planned', objectTypeRef, testCaseIds: [], runs: [],
      createdAt: `2026-10-0${id.slice(-1)}T00:00:00.000Z`,
    })
    await withoutComponent('CAMP-0001', 'root::campagne-test')
    await withoutComponent('CAMP-0002', 'bms::campagne-test')
    await withoutComponent('CAMP-0003', 'campagne-test')
    expect((await service.list(dir, 'root', 'campagne-test')).map(c => c.id)).toEqual(['CAMP-0001', 'CAMP-0003'])
  })
})
