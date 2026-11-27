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

describe('GH52 — machine-config : updateFeedUrl', () => {
  it('U-M1 : https valide : renseigné, « / » final ajouté', () => {
    const { config, warnings } = load({ updateFeedUrl: 'https://forge.client.fr/polenta-updates' })
    expect(config.updateFeedUrl).toBe('https://forge.client.fr/polenta-updates/')
    expect(warnings).toEqual([])
  })

  it('U-M1b : un « / » final déjà présent n\'est pas doublé', () => {
    const { config } = load({ updateFeedUrl: 'https://forge.client.fr/polenta-updates/' })
    expect(config.updateFeedUrl).toBe('https://forge.client.fr/polenta-updates/')
  })

  it('U-M2 : http, identifiants dans l\'URL, vide ou non-chaîne : avertissement, clé ignorée', () => {
    for (const bad of ['http://forge.client.fr/polenta-updates/', 'https://user:secret@forge.client.fr/x/', '', 7]) {
      const { config, warnings } = load({ updateFeedUrl: bad, hideGithub: true })
      expect(config.updateFeedUrl).toBeUndefined()
      expect(config.hideGithub).toBe(true)
      expect(warnings.some(w => w.includes('updateFeedUrl ignoré'))).toBe(true)
    }
  })

  it('U-M3 : sans updateFeedUrl, configuration identique au défaut (non-régression)', () => {
    const { config, warnings } = load({})
    expect(config).toEqual(DEFAULT_MACHINE_CONFIG)
    expect(warnings).toEqual([])
  })
})
