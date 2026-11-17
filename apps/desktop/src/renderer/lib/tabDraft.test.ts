import { afterEach, describe, expect, it } from 'vitest'
import { captureActiveDraft, registerTabDraft, resetTabDraftsForTest, stageIncomingDraft, takeStagedDraft } from './tabDraft'

afterEach(() => resetTabDraftsForTest())

describe('GH343 — T22 saisie transférée avec l’onglet', () => {
  it('capture la saisie de l’éditeur affiché (copie JSON) ; rien sans modification ni éditeur', () => {
    expect(captureActiveDraft()).toBeUndefined()
    let value: { text: string } | null = null
    const unregister = registerTabDraft('form:r::SYS-1', () => value)
    expect(captureActiveDraft()).toBeUndefined()
    value = { text: 'saisie' }
    const captured = captureActiveDraft()
    expect(captured).toEqual({ key: 'form:r::SYS-1', state: { text: 'saisie' } })
    expect(captured!.state).not.toBe(value)
    unregister()
    expect(captureActiveDraft()).toBeUndefined()
  })

  it('le retrait d’un éditeur remplacé ne retire pas le suivant', () => {
    const offFirst = registerTabDraft('form:a', () => 'a')
    registerTabDraft('form:b', () => 'b')
    offFirst()
    expect(captureActiveDraft()).toEqual({ key: 'form:b', state: 'b' })
  })

  it('reprise une seule fois, seulement pour la même clé', () => {
    stageIncomingDraft({ key: 'form:r::SYS-1', state: 'reçue' })
    expect(takeStagedDraft('form:r::SYS-2')).toBeUndefined()
    expect(takeStagedDraft('form:r::SYS-1')).toBe('reçue')
    expect(takeStagedDraft('form:r::SYS-1')).toBeUndefined()
  })

  it('fenêtre d’arrivée déjà sur la même page : saisie remise directement à l’éditeur affiché', () => {
    const received: unknown[] = []
    registerTabDraft('form:r::SYS-1', () => null, s => received.push(s), () => true)
    stageIncomingDraft({ key: 'form:r::SYS-1', state: 'reçue' })
    expect(received).toEqual(['reçue'])
    expect(takeStagedDraft('form:r::SYS-1')).toBeUndefined()
  })

  it('éditeur affiché pas encore prêt : la saisie attend', () => {
    const received: unknown[] = []
    registerTabDraft('form:r::SYS-1', () => null, s => received.push(s), () => false)
    stageIncomingDraft({ key: 'form:r::SYS-1', state: 'reçue' })
    expect(received).toEqual([])
    expect(takeStagedDraft('form:r::SYS-1')).toBe('reçue')
  })

  it('une autre page affichée jette la saisie en attente ; la même page la garde', () => {
    stageIncomingDraft({ key: 'form:r::SYS-1', state: 'reçue' })
    registerTabDraft('form:r::SYS-1', () => null)
    expect(takeStagedDraft('form:r::SYS-1')).toBe('reçue')
    stageIncomingDraft({ key: 'form:r::SYS-1', state: 'reçue' })
    registerTabDraft('schema:r', () => null)
    expect(takeStagedDraft('form:r::SYS-1')).toBeUndefined()
  })
})
