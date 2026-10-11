import { describe, expect, it } from 'vitest'

import { loadMachineConfig, machineConfigPath, parseMachineConfig } from './machine-config'
import { BRAND } from '../../shared/brand'

function load(content: string | null | Error, env: NodeJS.ProcessEnv = {}) {
  const warnings: string[] = []
  const config = loadMachineConfig({
    platform: 'win32',
    env,
    readFile: () => { if (content instanceof Error) throw content; return content },
    warn: m => warnings.push(m),
  })
  return { config, warnings }
}

describe('machine-config', () => {
  it('chemins par plateforme (dossier de la marque, GH49), POLENTA_CONFIG prioritaire', () => {
    expect(machineConfigPath('win32', { ProgramData: 'D:\\PD' })).toBe(`D:\\PD\\${BRAND.productName}\\config.json`)
    expect(machineConfigPath('linux', {})).toBe(`/etc/${BRAND.id}/config.json`)
    expect(machineConfigPath('darwin', {})).toBe(`/Library/Application Support/${BRAND.productName}/config.json`)
    expect(machineConfigPath('linux', { POLENTA_CONFIG: '/tmp/c.json' })).toBe('/tmp/c.json')
  })

  it('fichier absent → comportement par défaut, sans avertissement', () => {
    expect(load(null)).toEqual({ config: { hideGithub: false }, warnings: [] })
  })

  it('configuration complète, URL normalisée, BOM toléré', () => {
    const { config, warnings } = load('\uFEFF' + JSON.stringify({
      defaultServer: 'https://acme.forge.example.fr/user/login',
      hideGithub: true,
      demoProjectUrl: 'https://acme.forge.example.fr/acme/demo.git',
      autoUpdate: false,
    }))
    expect(config).toEqual({
      defaultServer: 'https://acme.forge.example.fr',
      hideGithub: true,
      demoProjectUrl: 'https://acme.forge.example.fr/acme/demo.git',
      autoUpdate: false,
    })
    expect(warnings).toEqual([])
  })

  it('JSON invalide → défaut + avertissement, jamais d’exception', () => {
    const { config, warnings } = load('{ "hideGithub": tru')
    expect(config).toEqual({ hideGithub: false })
    expect(warnings[0]).toMatch(/JSON invalide/)
  })

  it('erreur de lecture (droits) → défaut + avertissement', () => {
    const { config, warnings } = load(new Error('EACCES'))
    expect(config).toEqual({ hideGithub: false })
    expect(warnings[0]).toMatch(/EACCES/)
  })

  it('clé inconnue, valeurs invalides : ignorées une à une, avec avertissement', () => {
    const warnings: string[] = []
    const config = parseMachineConfig(JSON.stringify({
      defaultServer: 'ftp://x', hideGithub: 'oui', autoUpdate: true, demoProjectUrl: 12, theme: 'dark',
    }), 'f', m => warnings.push(m))
    expect(config).toEqual({ hideGithub: false })
    expect(warnings).toHaveLength(4)   // autoUpdate: true n'a pas d'effet mais est valide
    expect(warnings.join('\n')).toMatch(/clé inconnue ignorée : theme/)
  })

  it('un tableau ou une valeur scalaire n’est pas une configuration', () => {
    expect(parseMachineConfig('[]', 'f', () => {})).toEqual({ hideGithub: false })
    expect(parseMachineConfig('42', 'f', () => {})).toEqual({ hideGithub: false })
  })
})
