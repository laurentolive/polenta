import { describe, expect, it } from 'vitest'

import { COMPONENT_DEFAULT_CATEGORIES, defaultObjectTypes, emptyObjType, typeNamingRoot } from './objectTypeEditor'

// GH365 — types par défaut d'un composant : toutes les catégories, nom/préfixe tirés du label affiché.

describe('typeNamingRoot (U-1)', () => {
  it('préfère le label affiché', () => {
    expect(typeNamingRoot('Contrôle moteur', 'comp-motor-control')).toBe('Contrôle moteur')
  })
  it('replie sur le nom quand le label est vide ou sans caractère latin/chiffre', () => {
    expect(typeNamingRoot('', 'comp-motor-control')).toBe('comp-motor-control')
    expect(typeNamingRoot(undefined, 'motor')).toBe('motor')
    expect(typeNamingRoot('  ', 'motor')).toBe('motor')
    expect(typeNamingRoot('电机', 'motor')).toBe('motor')
    // Racine qui ne commence pas par une lettre : préfixe numérique évité.
    expect(typeNamingRoot('电机 2', 'motor')).toBe('motor')
  })
})

describe('racine de nom/préfixe (U-2)', () => {
  const nameOf = (root: string) => emptyObjType('requirement', root, 'Exigence', 'Description').name
  it('retire les accents, met en majuscules, remplace espaces et ponctuation par _', () => {
    expect(nameOf('Contrôle moteur v2.1')).toBe('CONTROLE_MOTEUR_V2_1_REQ')
    expect(nameOf('Œil — capteur')).toBe('OEIL_CAPTEUR_REQ')
    expect(nameOf('  Ça  va  ')).toBe('CA_VA_REQ')
    expect(nameOf('Straße Æther')).toBe('STRASSE_AETHER_REQ')
    expect(nameOf('Øresund Łódź')).toBe('ORESUND_LODZ_REQ')
  })
})

describe('defaultObjectTypes (U-3, U-4)', () => {
  const labelOf = (c: string) => `label ${c}`

  it('un type par catégorie, dans l\'ordre, nom = préfixe', () => {
    const types = defaultObjectTypes(COMPONENT_DEFAULT_CATEGORIES, 'Contrôle moteur', labelOf, 'Description')
    expect(types.map(t => [t.category, t.name, t.prefix])).toEqual([
      ['requirement', 'CONTROLE_MOTEUR_REQ', 'CONTROLE_MOTEUR_REQ'],
      ['test', 'CONTROLE_MOTEUR_TEST', 'CONTROLE_MOTEUR_TEST'],
      ['campaign', 'CONTROLE_MOTEUR_CAMP', 'CONTROLE_MOTEUR_CAMP'],
      ['issue', 'CONTROLE_MOTEUR_ISS', 'CONTROLE_MOTEUR_ISS'],
      ['version', 'CONTROLE_MOTEUR_VER', 'CONTROLE_MOTEUR_VER'],
      ['validation', 'CONTROLE_MOTEUR_VAL', 'CONTROLE_MOTEUR_VAL'],
    ])
    expect(types[0].label).toBe('label requirement')
    expect(types.find(t => t.category === 'version')!.statuses.length).toBeGreaterThan(0)
    expect(types.find(t => t.category === 'validation')!.decisions.length).toBeGreaterThan(0)
  })

  it('évite les préfixes déjà pris, sans toucher les autres', () => {
    const types = defaultObjectTypes(['requirement', 'test'], 'Moteur', labelOf, 'Description', ['MOTEUR_REQ'])
    expect(types.map(t => t.prefix)).toEqual(['MOTEUR_REQ_2', 'MOTEUR_TEST'])
  })

  it('n\'ajoute rien pour une liste vide', () => {
    expect(defaultObjectTypes([], 'Moteur', labelOf, 'Description')).toEqual([])
  })
})
