import { describe, expect, it } from 'vitest'
import type { UpdateState } from '@polenta/types'
import { updateView } from './updateView'

const base: UpdateState = { status: 'idle', currentVersion: '0.2.0' }
const desktop = (s: Partial<UpdateState>) => updateView({ ...base, ...s }, false, false)

describe('GH302 — vue du bouton de mise à jour', () => {
  it('R1 — rien sans état, au repos, en vérification sans version connue', () => {
    expect(updateView(undefined, false, false)).toBeNull()
    expect(desktop({})).toBeNull()
    expect(desktop({ status: 'checking' })).toBeNull()
    expect(desktop({ status: 'installing', availableVersion: '0.3.0' })).toBeNull()
  })

  it('R2/R4 — disponible, avec ou sans verrou', () => {
    expect(desktop({ status: 'available', availableVersion: '0.3.0' })).toEqual({ kind: 'available', version: '0.3.0', managed: false })
    expect(desktop({ status: 'available', availableVersion: '0.3.0', managed: true })).toEqual({ kind: 'available', version: '0.3.0', managed: true })
  })

  it('R5/R6/R8 — téléchargement, prête, erreur', () => {
    expect(desktop({ status: 'downloading', availableVersion: '0.3.0', progress: 42 })).toEqual({ kind: 'downloading', version: '0.3.0', progress: 42 })
    expect(desktop({ status: 'downloading', availableVersion: '0.3.0' })).toEqual({ kind: 'downloading', version: '0.3.0', progress: 0 })
    expect(desktop({ status: 'ready', availableVersion: '0.3.0' })).toEqual({ kind: 'ready', version: '0.3.0' })
    expect(desktop({ status: 'error', availableVersion: '0.3.0' })).toEqual({ kind: 'error', version: '0.3.0' })
  })

  it('R10 — web : version servie différente → recharger, pour tout utilisateur', () => {
    const s = { ...base, servedVersion: '0.3.0' }
    expect(updateView(s, true, false)).toEqual({ kind: 'reload', version: '0.3.0' })
    expect(updateView({ ...s, status: 'available', availableVersion: '0.4.0' }, true, true)).toEqual({ kind: 'reload', version: '0.3.0' })
  })

  it('R11 — web : release disponible visible pour l’administrateur seulement', () => {
    const s: UpdateState = { ...base, status: 'available', availableVersion: '0.3.0' }
    expect(updateView(s, true, true)).toEqual({ kind: 'release', version: '0.3.0' })
    expect(updateView(s, true, false)).toBeNull()
    expect(updateView(base, true, true)).toBeNull()
  })
})
