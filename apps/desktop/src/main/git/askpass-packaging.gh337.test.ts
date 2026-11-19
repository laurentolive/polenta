import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { describe, expect, it } from 'vitest'

import { builderConfig } from '../../../electron-builder.config'
import { loadBrand } from '../../../scripts/brand'
import { askpassDir } from './askpass'

/**
 * GH337 P1 — les shims d'askpass (`askpass.sh`, `askpass.js`) doivent être livrés dans l'application
 * installée : `askpassDir()` cherche `resources/git/askpass` en packagé, et electron-builder ne packe que
 * `out/**` (les sources de `src/` n'y sont pas). Sans ce dossier, toute opération réseau et le terminal
 * échouent avant même que git tourne (« Shim askpass introuvable »).
 */

const APP_ROOT = path.resolve(__dirname, '../../..')
const SHIM_SOURCE = path.join(APP_ROOT, 'src/main/git/askpass')

describe('GH337 P1 — livraison des shims askpass dans le package', () => {
  it('les deux shims existent dans le dossier source copié par la configuration', () => {
    expect(fs.existsSync(path.join(SHIM_SOURCE, 'askpass.sh'))).toBe(true)
    expect(fs.existsSync(path.join(SHIM_SOURCE, 'askpass.js'))).toBe(true)
  })

  it('extraResources copie le dossier des shims vers resources/git/askpass (hors asar)', () => {
    const config = builderConfig(loadBrand('polenta'))
    const entries = (config.extraResources ?? []) as Array<{ from: string; to: string }>
    const shim = entries.find(e => e.to === 'git/askpass')
    expect(shim, 'aucune entrée extraResources vers git/askpass').toBeDefined()
    expect(path.resolve(APP_ROOT, shim!.from)).toBe(SHIM_SOURCE)
  })

  it('askpassDir() trouve le dossier en packagé (process.resourcesPath/git/askpass)', () => {
    const resources = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-askpass-res-'))
    const dir = path.join(resources, 'git', 'askpass')
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(path.join(SHIM_SOURCE, 'askpass.js'), path.join(dir, 'askpass.js'))
    fs.copyFileSync(path.join(SHIM_SOURCE, 'askpass.sh'), path.join(dir, 'askpass.sh'))
    const previous = process.resourcesPath
    Object.defineProperty(process, 'resourcesPath', { value: resources, configurable: true })
    try {
      expect(askpassDir()).toBe(dir)
    } finally {
      Object.defineProperty(process, 'resourcesPath', { value: previous, configurable: true })
      fs.rmSync(resources, { recursive: true, force: true })
    }
  })
})
