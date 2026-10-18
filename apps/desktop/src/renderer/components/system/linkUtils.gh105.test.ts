import { describe, expect, it } from 'vitest'
import { filterCandidatesByRefs, normRepoPath, parseLinkError } from './linkUtils'
import type { Candidate } from './LinkCombobox'

// GH105 — candidats de lien sur le workspace : refs résolues avec le repo du candidat.

const c = (id: string, objectTypeRef: string, repoPath: string, category = 'requirement'): Candidate =>
  ({ id, title: id, objectTypeRef, category, repoPath })

const candidates = [
  c('P-1', 'root::P_REQ', 'C:/ws/prod'),
  c('H-1', 'root::HMI_REQ', 'C:/ws/hmi'),
  c('X-1', 'root::X', 'C:/ws/prod'),
  c('X-2', 'root::X', 'C:/ws/hmi'),
  c('T-1', 'root::T', 'C:/ws/hmi', 'test'),
]

describe('GH105 — filterCandidatesByRefs avec portée', () => {
  const scope = {
    definingRepo: 'c:\\ws\\prod',
    declaredBy: { 'root::HMI_REQ': ['c:\\ws\\hmi'], 'root::X': ['c:\\ws\\prod', 'c:\\ws\\hmi'], 'root::P_REQ': ['c:\\ws\\prod'] },
  }

  it("type d'un composant : objets du composant (cas PH2)", () => {
    expect(filterCandidatesByRefs(candidates, ['root::HMI_REQ'], scope).map(x => x.id)).toEqual(['H-1'])
  })

  it('ref déclarée aussi par le repo du type de lien : ses objets seulement', () => {
    expect(filterCandidatesByRefs(candidates, ['root::X'], scope).map(x => x.id)).toEqual(['X-1'])
  })

  it('ref par catégorie : tous les repos', () => {
    expect(filterCandidatesByRefs(candidates, ['test'], scope).map(x => x.id)).toEqual(['T-1'])
  })

  it('sans portée : comparaison sur objectTypeRef seul', () => {
    expect(filterCandidatesByRefs(candidates, ['root::X']).map(x => x.id)).toEqual(['X-1', 'X-2'])
  })
})

describe('GH105 — utilitaires', () => {
  it('normRepoPath ignore séparateurs, casse et barre finale', () => {
    expect(normRepoPath('C:\\Ws\\Prod\\')).toBe(normRepoPath('c:/ws/prod'))
  })

  it("parseLinkError retrouve le code dans un message d'IPC Electron", () => {
    const err = new Error("Error invoking remote method 'requirements:link-create': LinkWriteError: READONLY_REPO: Le lien serait stocké dans HMI")
    expect(parseLinkError(err)).toEqual({ code: 'READONLY_REPO', reason: 'Le lien serait stocké dans HMI' })
  })

  it('parseLinkError sans code : message brut', () => {
    expect(parseLinkError(new Error('boom'))).toEqual({ code: null, reason: 'boom' })
  })
})
