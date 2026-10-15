import { describe, expect, it } from 'vitest'

import { emptyObjType } from './objectTypeEditor'

// GH97 — un 2e type de la même catégorie dans un repo ne reprend plus le nom/préfixe du premier.

describe('emptyObjType — proposition de nom/préfixe (GH97)', () => {
  it('propose <COMPOSANT>_<SUFFIXE> quand rien n\'est pris', () => {
    const t = emptyObjType('requirement', 'hmi-PH2', 'Exigence', 'Description')
    expect(t.name).toBe('HMI_PH2_REQ')
    expect(t.prefix).toBe('HMI_PH2_REQ')
  })

  it('prend le premier suffixe libre quand la proposition est déjà prise', () => {
    const t = emptyObjType('requirement', 'hmi-PH2', 'Exigence', 'Description', new Set(['HMI_PH2_REQ', 'HMI_PH2_REQ_2']))
    expect(t.name).toBe('HMI_PH2_REQ_3')
    expect(t.prefix).toBe('HMI_PH2_REQ_3')
  })

  it('ne touche pas une proposition vide', () => {
    expect(emptyObjType('test', '', 'Test', 'Description', new Set([''])).name).toBe('')
  })
})
