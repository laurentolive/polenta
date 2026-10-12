import { describe, expect, it } from 'vitest'
import { isRowNavigable, rowTargetRoute } from './rowNavigation'
import { rawValueIndex } from '../components/dashboard/widgets/drilldown'

describe('GH65 — navigation depuis une ligne de résultat', () => {
  it('2.25 — ligne navigable : campaignId ou id non vide', () => {
    expect(isRowNavigable({ id: 'SYS-0001' })).toBe(true)
    expect(isRowNavigable({ campaignId: 'CAMP-0001', entryId: 'TEST-0001' })).toBe(true)
    expect(isRowNavigable({ status: 'draft', n: 3 })).toBe(false)
    expect(isRowNavigable({ id: '  ' })).toBe(false)
    expect(isRowNavigable({ id: 42 })).toBe(false)
    expect(isRowNavigable({ id: 'LINK-0001', sourceId: 'TEST-0001', targetId: 'SYS-0001' })).toBe(false)
  })

  it('routes et paramètres de l\'onglet ouvert', () => {
    expect(rowTargetRoute({ kind: 'requirement', id: 'SYS-0001', repoPath: '/r' }, 'P'))
      .toEqual({ pathname: '/req/SYS-0001', search: { repoPath: '/r', projectId: 'P' } })
    expect(rowTargetRoute({ kind: 'test', id: 'TEST-0001', repoPath: '/r' }, 'P').pathname).toBe('/test/TEST-0001')
    expect(rowTargetRoute({ kind: 'campaign', id: 'CAMP-0001', repoPath: '/c', status: 'pending' }, 'P'))
      .toEqual({ pathname: '/campaign/CAMP-0001', search: { repoPath: '/c', projectId: 'P', status: 'pending' } })
    expect(rowTargetRoute({ kind: 'campaign', id: 'CAMP-0001', repoPath: '/c' }, 'P').search).not.toHaveProperty('status')
    expect(rowTargetRoute({ kind: 'campaign-run', campaignId: 'CAMP-0001', entryId: 'TEST-0002-2', repoPath: '/c' }, 'P').pathname)
      .toBe('/campaign/CAMP-0001/run/TEST-0002-2')
  })

  it('libellé affiché → valeur brute (null, nombre), première occurrence', () => {
    const idx = rawValueIndex([{ c: null }, { c: 3 }, { c: 'a' }, { c: 'a' }, {}], 'c')
    expect(idx.get('—')).toBeNull()
    expect(idx.get('3')).toBe(3)
    expect(idx.get('a')).toBe('a')
  })
})
