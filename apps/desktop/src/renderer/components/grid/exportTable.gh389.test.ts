import { describe, expect, it } from 'vitest'
import { buildTablePayload, fileBaseNameOf, joinIds, sheetNameOf, type ExportableColumn } from './exportTable'

// GH389 U5 — payload d'export d'une grille : ce qui est affiché.
interface Row { id: string; decision: string; tests: string[]; url?: string }
const rows: Row[] = [
  { id: 'SYS-001', decision: 'conforme', tests: ['TST-1', 'TST-2'], url: 'https://ex.com/a' },
  { id: 'SYS-002', decision: 'en_attente', tests: [] },
  { id: 'SYS-003', decision: 'non_conforme', tests: ['TST-3'] },
]
const labels: Record<string, string> = { conforme: 'Conforme', en_attente: 'À décider', non_conforme: 'Non conforme' }
const columns: ExportableColumn<Row>[] = [
  { key: 'decision', label: 'Décision', text: r => labels[r.decision] },
  { key: 'id', label: 'ID', text: r => r.id, hyperlink: r => r.url },
  { key: 'tests', label: 'Tests', text: r => joinIds(r.tests) },
]

describe('GH389 U5 — exportTable', () => {
  it('lignes filtrées et colonnes visibles dans l’ordre, texte affiché', () => {
    const shown = rows.filter(r => r.decision !== 'en_attente')
    const p = buildTablePayload('Validation 2.0', columns, shown, { decision: 140, id: 90 }, 1)
    expect(p.columns).toEqual([
      { key: 'decision', label: 'Décision', width: 140 },
      { key: 'id', label: 'ID', width: 90 },
      { key: 'tests', label: 'Tests' },
    ])
    expect(p.rows).toEqual([
      { decision: 'Conforme', id: 'SYS-001', tests: 'TST-1, TST-2' },
      { decision: 'Non conforme', id: 'SYS-003', tests: 'TST-3' },
    ])
    expect(p.hyperlinks).toEqual({ 0: { id: 'https://ex.com/a' } })
    expect(p.freezeColCount).toBe(1)
    expect(p.sheetName).toBe('Validation 2.0')
  })

  it('grille vide : en-tête seul', () => {
    const p = buildTablePayload('Vide', columns, [])
    expect(p.rows).toEqual([])
    expect(p.columns).toHaveLength(3)
    expect(p.hyperlinks).toBeUndefined()
    expect(p.freezeColCount).toBeUndefined()
  })

  it('nom de feuille tronqué et nettoyé, nom de fichier', () => {
    expect(sheetNameOf('Validation [v2]: a/b?c*d\\e')).toBe('Validation v2 a b c d e')
    expect(sheetNameOf('x'.repeat(40))).toHaveLength(31)
    expect(sheetNameOf('///')).toBe('Sheet1')
    expect(fileBaseNameOf('Validation 2.0: a/b')).toBe('Validation 2.0 a b')
  })
})
