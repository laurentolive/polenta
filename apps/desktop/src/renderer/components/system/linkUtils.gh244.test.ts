import { describe, expect, it } from 'vitest'
import { isForeignIssuePair, parseLinkError } from './linkUtils'

// GH244 — une issue n'impacte que les exigences de son composant.

const issue = { category: 'issue', objectTypeRef: 'root::ISS', repoPath: 'C:/ws/prod' }
const req = (objectTypeRef: string, repoPath: string, category = 'requirement') => ({ category, objectTypeRef, repoPath })
const declaredBy = { 'root::REQ': ['c:\\ws\\prod'], 'root::HMI_REQ': ['c:\\ws\\hmi'] }

describe('GH244 — isForeignIssuePair', () => {
  it("exigence du composant de l'issue : acceptée, dans les deux sens", () => {
    const own = req('root::REQ', 'c:\\ws\\prod')
    expect(isForeignIssuePair(issue, own, declaredBy)).toBe(false)
    expect(isForeignIssuePair(own, issue, declaredBy)).toBe(false)
  })

  it("exigence d'un autre repo : écartée", () => {
    expect(isForeignIssuePair(issue, req('root::HMI_REQ', 'C:/ws/hmi'), declaredBy)).toBe(true)
  })

  it("exigence du repo d'un type non déclaré par ce repo : écartée (cas PH2, VE22D_SW_REQ)", () => {
    expect(isForeignIssuePair(issue, req('VE22D_SW::VE22D_SW_REQ', 'C:/ws/prod'), declaredBy)).toBe(true)
  })

  it('hors workspace (pas de `declaredBy`) : seul le repo compte', () => {
    expect(isForeignIssuePair(issue, req('VE22D_SW::VE22D_SW_REQ', 'C:/ws/prod'))).toBe(false)
  })

  it('paire sans issue ou sans exigence : jamais écartée', () => {
    const a = req('root::REQ', 'C:/ws/prod')
    const b = req('root::HMI_REQ', 'C:/ws/hmi')
    expect(isForeignIssuePair(a, b, declaredBy)).toBe(false)
    expect(isForeignIssuePair(issue, req('root::T', 'C:/ws/hmi', 'test'), declaredBy)).toBe(false)
  })
})

describe('GH244 — parseLinkError', () => {
  it('reconnaît NOT_OWN_ELEMENT derrière le préfixe IPC', () => {
    const err = new Error("Error invoking remote method 'links:create': Error: NOT_OWN_ELEMENT: H-1 n'appartient pas au composant de l'issue.")
    expect(parseLinkError(err)).toEqual({ code: 'NOT_OWN_ELEMENT', reason: "H-1 n'appartient pas au composant de l'issue." })
  })
})
