import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AppSettingsService } from './app-settings.service'

describe('GH237 — AppSettingsService : zoom de l\'interface', () => {
  let dir: string
  const file = () => path.join(dir, 'app-settings.json')
  const onDisk = () => JSON.parse(fs.readFileSync(file(), 'utf-8')) as Record<string, unknown>

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh237-settings-')) })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('fichier absent → pas de zoomFactor (100 %)', () => {
    expect(new AppSettingsService(dir).get().zoomFactor).toBeUndefined()
  })

  it('U3 — écriture, persistance, clé supprimée au retour à 100 %', () => {
    const svc = new AppSettingsService(dir)
    expect(svc.set({ zoomFactor: 1.25 }).zoomFactor).toBe(1.25)
    expect(onDisk().zoomFactor).toBe(1.25)
    expect(new AppSettingsService(dir).get().zoomFactor).toBe(1.25)
    svc.set({ zoomFactor: 1 })
    expect('zoomFactor' in onDisk()).toBe(false)
  })

  it('U3 — valeurs invalides du fichier tolérées', () => {
    fs.writeFileSync(file(), JSON.stringify({ zoomFactor: 'abc' }))
    expect(new AppSettingsService(dir).get().zoomFactor).toBeUndefined()
    fs.writeFileSync(file(), JSON.stringify({ zoomFactor: 7 }))
    expect(new AppSettingsService(dir).get().zoomFactor).toBe(3)
  })
})
