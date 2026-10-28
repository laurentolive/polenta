import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AppSettingsService } from './app-settings.service'

describe('GH15 — AppSettingsService : délai de connexion réseau', () => {
  let dir: string
  const file = () => path.join(dir, 'app-settings.json')
  const onDisk = () => JSON.parse(fs.readFileSync(file(), 'utf-8')) as Record<string, unknown>

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh15-settings-')) })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  function service() {
    const applied: number[] = []
    return { svc: new AppSettingsService(dir, undefined, undefined, s => applied.push(s)), applied }
  }

  it('fichier absent → 10, appliqué dès la construction', () => {
    const { svc, applied } = service()
    expect(svc.get().networkTimeoutSeconds).toBe(10)
    expect(applied).toEqual([10])
  })

  it('écriture, persistance et application immédiate', () => {
    const { svc, applied } = service()
    expect(svc.set({ networkTimeoutSeconds: 40 }).networkTimeoutSeconds).toBe(40)
    expect(onDisk().networkTimeoutSeconds).toBe(40)
    expect(applied).toEqual([10, 40])
    const reloaded = service()
    expect(reloaded.svc.get().networkTimeoutSeconds).toBe(40)
    expect(reloaded.applied).toEqual([40])
  })

  it('retour au défaut : la clé disparaît du fichier', () => {
    const { svc } = service()
    svc.set({ networkTimeoutSeconds: 40 })
    svc.set({ networkTimeoutSeconds: 10 })
    expect('networkTimeoutSeconds' in onDisk()).toBe(false)
  })

  it('les autres préférences conservent le réglage', () => {
    const { svc } = service()
    svc.set({ networkTimeoutSeconds: 40 })
    svc.set({ autoCheckUpdates: false })
    expect(onDisk()).toEqual({ autoCheckUpdates: false, networkTimeoutSeconds: 40 })
  })

  it.each(['"abc"', '5', '500', '12.5'])('valeur invalide %s dans le fichier → 10, sans erreur', raw => {
    fs.writeFileSync(file(), `{ "autoCheckUpdates": true, "networkTimeoutSeconds": ${raw} }`)
    const { svc, applied } = service()
    expect(svc.get().networkTimeoutSeconds).toBe(10)
    expect(applied).toEqual([10])
  })

  it('sans rappel (serveur web) : écriture normale', () => {
    const svc = new AppSettingsService(dir)
    expect(svc.set({ networkTimeoutSeconds: 30 }).networkTimeoutSeconds).toBe(30)
  })
})
