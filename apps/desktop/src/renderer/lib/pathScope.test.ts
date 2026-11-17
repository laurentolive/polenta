import { describe, expect, it } from 'vitest'
import { isInsideWorkspace } from './pathScope'

describe('GH343 — T7 repo du projet affiché', () => {
  it('repo dans le workspace, séparateurs et casse Windows', () => {
    expect(isInsideWorkspace('C:\\ws\\produit', 'C:\\ws\\produit\\comp-bms')).toBe(true)
    expect(isInsideWorkspace('C:\\ws\\produit', 'c:/ws/produit/comp-bms')).toBe(true)
    expect(isInsideWorkspace('C:\\ws\\produit\\', 'C:\\ws\\produit')).toBe(true)
    expect(isInsideWorkspace('/home/u/ws', '/home/u/ws/repo')).toBe(true)
  })

  it('repo d’un autre projet, préfixe trompeur', () => {
    expect(isInsideWorkspace('C:\\ws\\produit', 'C:\\ws\\produit-b\\repo')).toBe(false)
    expect(isInsideWorkspace('C:\\ws\\produit', 'C:\\ws\\autre')).toBe(false)
    expect(isInsideWorkspace('/home/u/ws', '/home/U/ws/repo')).toBe(false)
    expect(isInsideWorkspace('', '/x')).toBe(false)
  })
})
