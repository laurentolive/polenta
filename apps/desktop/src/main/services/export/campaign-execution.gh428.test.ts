import { describe, expect, it } from 'vitest'
import type { CampaignTestRun, ObjectTypeDefinition, TestCampaign, TestCase } from '@polenta/types'
import { buildExecutionSheetModel, buildExecutionWorkbook } from './campaign-execution.xlsx'

// GH428 §3.3 — classeur d'exécution : une entrée en attente exporte ses valeurs « renseigné en campagne »
// (L1). Le format ne change pas : les colonnes `run:<nom>` existent déjà.

const TN: ObjectTypeDefinition = {
  name: 'tn', category: 'test', fields: [],
  runFields: [
    { name: 'criticite', label: 'Criticité', type: 'enum', values: ['critique', 'regression'], campaignInput: true },
    { name: 'quantite', label: 'Quantité', type: 'number', campaignInput: true },
    { name: 'rapport', label: 'Rapport', type: 'text' },
  ],
}

const test = { id: 'TN-1', title: 'Essai', objectTypeRef: 'root::tn', status: 'approved', version: 1, fields: {}, steps: [{ order: 1, action: 'A', expectedResult: 'E', notes: '' }] } as unknown as TestCase
const entry = (extra: Partial<CampaignTestRun> = {}): CampaignTestRun => ({ entryId: 'TN-1-1', testCaseId: 'TN-1', status: 'pending', ...extra } as CampaignTestRun)

function sheetCells(wb: Awaited<ReturnType<typeof buildExecutionWorkbook>>, header: string): unknown[] {
  const sheet = wb.worksheets[0]!
  let col = -1
  // En-tête : première ligne contenant le libellé de la colonne.
  for (let r = 1; r <= sheet.rowCount && col < 0; r++) {
    for (let c = 1; c <= sheet.columnCount; c++) {
      if (String(sheet.getRow(r).getCell(c).value ?? '') === header) { col = c; break }
    }
  }
  expect(col).toBeGreaterThan(0)
  const values: unknown[] = []
  for (let r = 1; r <= sheet.rowCount; r++) values.push(sheet.getRow(r).getCell(col).value)
  return values
}

describe('classeur d\'exécution — valeurs de campagne (GH428 L1)', () => {
  it('une entrée en attente avec des valeurs saisies en campagne les pré-remplit', async () => {
    const campaign = { id: 'CAMP-0001', title: 'C', status: 'planned', runs: [entry({ runInputs: { criticite: 'critique', quantite: '12.5' } })] } as unknown as TestCampaign
    const model = buildExecutionSheetModel({
      campaign, locale: 'fr', exportedAt: '2026-11-23T10:00:00Z',
      entries: [{ run: campaign.runs[0]!, test, typeDef: TN }],
    })
    const wb = await buildExecutionWorkbook(model)
    expect(sheetCells(wb, 'Criticité')).toContain('critique')
    expect(sheetCells(wb, 'Quantité')).toContain(12.5)
  })

  it('une entrée sans valeur saisie ne pré-remplit rien', async () => {
    const campaign = { id: 'CAMP-0001', title: 'C', status: 'planned', runs: [entry()] } as unknown as TestCampaign
    const model = buildExecutionSheetModel({
      campaign, locale: 'fr', exportedAt: '2026-11-23T10:00:00Z',
      entries: [{ run: campaign.runs[0]!, test, typeDef: TN }],
    })
    const wb = await buildExecutionWorkbook(model)
    expect(sheetCells(wb, 'Criticité')).not.toContain('critique')
  })
})
