import { describe, expect, it } from 'vitest'

import { parseTeamConfig, resolveTeamConfig } from './team-config'

const YAML = `
version: 1
defaults:
  updates: auto
  projects:
    - repo: acme/demo
      label: Démonstration
  preferences:
    language: fr
    projectHome: dashboard
teams:
  testeurs:
    projects:
      - repo: acme/essai
      - repo: acme/demo
    preferences:
      projectHome: campaigns
      theme: dark
  auteurs:
    projects:
      - acme/specs
    preferences:
      projectHome: requirements
      language: en
  lecteurs:
    updates: managed
`

describe('parseTeamConfig', () => {
  it('lit le modèle complet, sans avertissement', () => {
    const { config, warnings } = parseTeamConfig(YAML)
    expect(warnings).toEqual([])
    expect(config.teams.map(t => t.name)).toEqual(['testeurs', 'auteurs', 'lecteurs'])
    expect(config.teams[1].section.projects).toEqual([{ repo: 'acme/specs' }])   // forme courte acceptée
  })

  it('valeurs invalides et clés inconnues ignorées une à une, avec avertissement', () => {
    const { config, warnings } = parseTeamConfig(`
version: 2
defaults:
  updates: parfois
  projects: [{ repo: "pas un repo" }, { repo: acme/ok }]
  preferences: { language: de, theme: dark, projectHome: system, couleur: rouge,
                 fieldVisibility: { "root::exigence": { excel: [a, b], word: 3 } } }
  autre: 1
teams: { lecteurs: [1, 2] }
racine: x
`)
    expect(config.defaults).toEqual({
      projects: [{ repo: 'acme/ok' }],
      preferences: { theme: 'dark', fieldVisibility: { 'root::exigence': { excel: ['a', 'b'] } } },
    })
    expect(warnings.length).toBeGreaterThanOrEqual(9)
    expect(warnings.join('\n')).toMatch(/version 2/)
  })

  it('fichier vide ou non-objet → erreur explicite (config ignorée par l’appelant)', () => {
    expect(() => parseTeamConfig('')).toThrow()
    expect(() => parseTeamConfig('- a\n- b')).toThrow(/objet YAML/)
    expect(() => parseTeamConfig('defaults: [')).toThrow()
  })
})

describe('resolveTeamConfig (spec §3bis-4, critère 22)', () => {
  const { config } = parseTeamConfig(YAML)

  it('aucune équipe : defaults seuls', () => {
    expect(resolveTeamConfig(config, [])).toEqual({
      projects: [{ repo: 'acme/demo', label: 'Démonstration' }],
      updates: 'auto',
      preferences: { language: 'fr', projectHome: 'dashboard' },
    })
  })

  it('une équipe : projets ajoutés sans doublon, préférences surchargées', () => {
    const r = resolveTeamConfig(config, ['Testeurs'])     // casse du nom d'équipe ignorée
    expect(r.projects.map(p => p.repo)).toEqual(['acme/demo', 'acme/essai'])
    expect(r.preferences).toEqual({ language: 'fr', projectHome: 'campaigns', theme: 'dark' })
  })

  it('deux équipes : union des projets ; la première équipe du FICHIER l’emporte pour une préférence', () => {
    const r = resolveTeamConfig(config, ['auteurs', 'testeurs'])
    expect(r.projects.map(p => p.repo)).toEqual(['acme/demo', 'acme/essai', 'acme/specs'])
    expect(r.preferences.projectHome).toBe('campaigns')   // testeurs avant auteurs dans le fichier
    expect(r.preferences.language).toBe('en')             // seule auteurs la définit
  })

  it('mises à jour : managed dès qu’une source le demande', () => {
    expect(resolveTeamConfig(config, ['auteurs']).updates).toBe('auto')
    expect(resolveTeamConfig(config, ['auteurs', 'lecteurs']).updates).toBe('managed')
  })

  it('champs visibles résolus par type : une équipe ne fait pas perdre les défauts des autres types', () => {
    const { config: c } = parseTeamConfig(`
defaults:
  preferences:
    fieldVisibility:
      root::exigence: { excel: [priority] }
teams:
  testeurs:
    preferences:
      fieldVisibility:
        root::test: { excel: [steps] }
  auteurs:
    preferences:
      fieldVisibility:
        root::test: { excel: [title] }
        root::exigence: { word: [statement] }
`)
    expect(resolveTeamConfig(c, ['testeurs', 'auteurs']).preferences.fieldVisibility).toEqual({
      'root::exigence': { word: ['statement'] },   // seule auteurs règle ce type
      'root::test': { excel: ['steps'] },          // testeurs, première du fichier
    })
    expect(resolveTeamConfig(c, ['testeurs']).preferences.fieldVisibility).toEqual({
      'root::exigence': { excel: ['priority'] },   // défaut conservé
      'root::test': { excel: ['steps'] },
    })
  })

  it('équipe absente de la configuration : sans effet', () => {
    expect(resolveTeamConfig(config, ['projet-x'])).toEqual(resolveTeamConfig(config, []))
  })
})
