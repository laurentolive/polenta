import { describe, expect, it } from 'vitest'
import { rowTargetRoute } from './rowNavigation'

describe('GH65 / GH74 — onglet ouvert pour un objet de la vue Suivi', () => {
  it('routes et paramètres de l\'onglet ouvert', () => {
    expect(rowTargetRoute({ kind: 'requirement', id: 'SYS-0001', repoPath: '/r' }, 'P'))
      .toEqual({ pathname: '/req/SYS-0001', search: { repoPath: '/r', projectId: 'P' } })
    expect(rowTargetRoute({ kind: 'test', id: 'TEST-0001', repoPath: '/r' }, 'P').pathname).toBe('/test/TEST-0001')
    expect(rowTargetRoute({ kind: 'campaign', id: 'CAMP-0001', repoPath: '/c' }, 'P'))
      .toEqual({ pathname: '/campaign/CAMP-0001', search: { repoPath: '/c', projectId: 'P' } })
  })

  it('entrée de campagne : résultat si exécutée, sinon campagne filtrée sur son statut', () => {
    expect(rowTargetRoute({ kind: 'campaign-entry', campaignId: 'CAMP-0001', entryId: 'TEST-0002-2', executed: true, status: 'FAIL', repoPath: '/c' }, 'P').pathname)
      .toBe('/campaign/CAMP-0001/run/TEST-0002-2')
    expect(rowTargetRoute({ kind: 'campaign-entry', campaignId: 'CAMP-0001', entryId: 'TEST-0003-1', executed: false, status: 'pending', repoPath: '/c' }, 'P'))
      .toEqual({ pathname: '/campaign/CAMP-0001', search: { repoPath: '/c', projectId: 'P', status: 'pending' } })
  })
})
