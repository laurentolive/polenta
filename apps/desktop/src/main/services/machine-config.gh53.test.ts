import { describe, expect, it } from 'vitest'

import { DEFAULT_MACHINE_CONFIG, loadMachineConfig } from './machine-config'

function load(json: unknown) {
  const warnings: string[] = []
  const config = loadMachineConfig({
    platform: 'win32',
    env: {},
    readFile: () => JSON.stringify(json),
    warn: m => warnings.push(m),
  })
  return { config, warnings }
}

describe('GH53 — machine-config : caPath', () => {
  it('chemin de CA non vide : renseigné, sans avertissement', () => {
    const { config, warnings } = load({ caPath: 'C:\\ProgramData\\Entreprise\\ca.pem' })
    expect(config.caPath).toBe('C:\\ProgramData\\Entreprise\\ca.pem')
    expect(warnings).toEqual([])
  })

  it('chemin vide, nombre ou objet : avertissement, clé ignorée, autres réglages inchangés', () => {
    for (const bad of ['', '   ', 42, { path: 'x' }]) {
      const { config, warnings } = load({ caPath: bad, hideGithub: true })
      expect(config.caPath).toBeUndefined()
      expect(config.hideGithub).toBe(true)
      expect(warnings.some(w => w.includes('caPath ignoré'))).toBe(true)
    }
  })

  it('sans caPath : configuration identique au défaut (non-régression)', () => {
    const { config, warnings } = load({})
    expect(config).toEqual(DEFAULT_MACHINE_CONFIG)
    expect(warnings).toEqual([])
  })
})
