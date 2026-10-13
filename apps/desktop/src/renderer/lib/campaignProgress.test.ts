import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import type { CampaignTestRun, ProjectSchema, TestCase } from '@polenta/types'
import { prepStatusOrder } from '@polenta/types'
import { progressPills, runProgress } from './campaignProgress'
import { progressPresenter } from '../components/dashboard/widgets/progressPresentation'

// GH71 — étapes d'avancement côté renderer : pastilles de la page campagne (C1, C4) et présentation
// du préréglage de widget (W1, W4).

const SCHEMA = {
  nodes: [{
    name: 'root', objectTypes: [{
      name: 'test', category: 'test', fields: [],
      statuses: [{ name: 'draft', label: 'Brouillon' }, { name: 'review', label: 'En revue' }, { name: 'valide', label: 'Validé', isApproval: true }],
    }],
  }],
} as unknown as ProjectSchema
const t = ((key: string) => `t:${key}`) as unknown as TFunction

const tc = (id: string, status: string) => ({ id, status, objectTypeRef: 'root::test' } as unknown as TestCase)
const isApproved = (x: TestCase) => x.status === 'valide'
const run = (id: string, status: CampaignTestRun['status'], snap: string): CampaignTestRun =>
  ({ entryId: `${id}-1`, testCaseId: id, status, testSnapshot: tc(id, snap) })
const RUNS = [run('D', 'PASS', 'valide'), run('A', 'pending', 'draft'), run('E', 'FAIL', 'valide'), run('B', 'pending', 'review'), run('C', 'pending', 'valide')]
const progressOf = (r: CampaignTestRun) => runProgress(r, undefined, true, isApproved)

describe('campaignProgress — pastilles', () => {
  it('C1 — étapes présentes, ordre canonique', () => {
    expect(progressPills(RUNS, progressOf, prepStatusOrder(SCHEMA))).toEqual([
      { key: 'prep:draft', count: 1 }, { key: 'prep:review', count: 1 }, { key: 'ready', count: 1 },
      { key: 'FAIL', count: 1 }, { key: 'PASS', count: 1 },
    ])
  })

  it('C4 — sans entrée en préparation : pas de pastille de préparation ; étape filtrée gardée à 0', () => {
    const pills = progressPills([RUNS[0]], progressOf, prepStatusOrder(SCHEMA), 'ready')
    expect(pills).toEqual([{ key: 'ready', count: 0 }, { key: 'PASS', count: 1 }])
  })
})

describe('progressPresentation', () => {
  const p = progressPresenter(SCHEMA, t)

  it('W1 — ordre, libellés (schéma, i18n) et couleurs sémantiques', () => {
    const steps = p.present(['PASS', 'ready', 'FAIL', 'prep:review', 'prep:draft'])
    expect(steps.map(s => [s.key, s.label])).toEqual([
      ['prep:draft', 'Brouillon'], ['prep:review', 'En revue'], ['ready', 't:campaignProgress.ready'],
      ['FAIL', 't:campaignPage.runStatus.fail'], ['PASS', 't:campaignPage.runStatus.pass'],
    ])
    expect(steps.map(s => s.color)).toEqual([
      'rgb(var(--chart-progress-prep-1))', 'rgb(var(--chart-progress-prep-2))', 'rgb(var(--chart-progress-ready))',
      'rgb(var(--chart-progress-fail))', 'rgb(var(--chart-progress-pass))',
    ])
  })

  it('W4 — valeurs hors étape ignorées ; statut absent du schéma : libellé = nom', () => {
    expect(p.present(['bms', 'produit']).length).toBe(0)
    expect(p.present(['prep:inconnu']).map(s => s.label)).toEqual(['inconnu'])
  })

  it('au-delà de 4 étapes de préparation : dernière teinte réutilisée', () => {
    const keys = ['prep:a', 'prep:b', 'prep:c', 'prep:d', 'prep:e']
    expect(p.present(keys).map(s => s.color.match(/prep-(\d)/)![1])).toEqual(['1', '2', '3', '4', '4'])
  })
})
