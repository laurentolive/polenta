import { describe, expect, it } from 'vitest'
import type { ObjectTypeDefinition, TypeTreeNode } from '@polenta/types'
import { buildDisplayedExportRows, buildExportOutline, buildExportRows, type DisplayedExportRow } from './exportColumns'

// GH389 U7 — export Tableau de la Vue Excel : ce qui est affiché (spec §1.10).

const typeDef = {
  name: 'exigence', category: 'requirement',
  fields: [{ name: 'note', label: 'Note', type: 'richtext' }, { name: 'doc', label: 'Doc', type: 'link' }],
} as unknown as ObjectTypeDefinition

const rows: DisplayedExportRow[] = [
  { kind: 'folder', nodeId: 'f1', name: 'Dossier A' },
  { kind: 'item', nodeId: 'n1', objectId: 'SYS-1', name: 'Démarrage' },
  { kind: 'item', nodeId: 'n3', objectId: 'SYS-3', name: 'Arrêt' },
]
const texts: Record<string, Record<string, string>> = {
  'SYS-1': { id: 'SYS-1', status: 'Brouillon', 'link-out::verification': 'TC-1, TC-2', coverageStatus: 'Couverte', note: '<span class="pl-c-red">Rouge</span>', doc: 'Spec | https://x' },
  'SYS-3': { id: 'SYS-3', status: 'Approuvé', 'link-out::verification': '', coverageStatus: 'Non couverte', note: '', doc: '' },
}
const labels: Record<string, string> = { section: 'Section', name: 'Label', id: 'ID', status: 'Statut', 'link-out::verification': 'Vérifiée par', coverageStatus: 'Vérification', note: 'Note', doc: 'Doc' }
const fields = ['section', 'name', 'id', 'status', 'link-out::verification', 'coverageStatus', 'note', 'doc']
const sections = new Map([['f1', '1'], ['n1', '1.1'], ['n3', '1.2']])
const cellText = (row: DisplayedExportRow, col: string) =>
  col === 'section' ? sections.get(row.nodeId) ?? '' : col === 'name' ? row.name : texts[row.objectId!][col] ?? ''

describe('GH389 U7 — buildDisplayedExportRows', () => {
  const out = buildDisplayedExportRows(fields, rows, cellText, c => labels[c], typeDef, sections)

  it('colonnes visibles dans l’ordre, liens et Vérification compris, type du champ transmis', () => {
    expect(out.columns.map(c => c.key)).toEqual(fields)
    expect(out.columns.map(c => c.label)).toEqual(fields.map(f => labels[f]))
    expect(out.columns.find(c => c.key === 'doc')?.type).toBe('link')
  })

  it('lignes affichées dans l’ordre, titres de dossier compris', () => {
    expect(out.rows.map(r => r.id)).toEqual(['', 'SYS-1', 'SYS-3'])
    expect(out.rows[0]).toMatchObject({ section: '1', name: 'Dossier A', id: '', status: '' })
  })

  it('texte affiché : libellés, ID des liens, couverture ; couleurs richtext retirées', () => {
    expect(out.rows[1]).toMatchObject({ status: 'Brouillon', 'link-out::verification': 'TC-1, TC-2', coverageStatus: 'Couverte', note: 'Rouge', doc: 'Spec | https://x' })
  })

  it('dossier sans colonne section : titre dans la première colonne', () => {
    const r = buildDisplayedExportRows(['id', 'status'], rows, cellText, c => labels[c], typeDef, sections)
    expect(r.rows[0]).toEqual({ id: 'Dossier A', status: '' })
  })
})

describe('GH389 U7 — exports existants (Document, PDF, gabarit)', () => {
  const node = (id: string, objectId: string): TypeTreeNode => ({ id, kind: 'item', name: objectId, objectId, children: [] } as unknown as TypeTreeNode)
  const root = [{ id: 'f1', kind: 'folder', name: 'Dossier A', children: [node('n1', 'SYS-1'), node('n3', 'SYS-3')] } as unknown as TypeTreeNode]
  const objects = [{ id: 'SYS-1', title: 'Démarrage', status: 'draft' }, { id: 'SYS-3', title: 'Arrêt', status: 'approved' }]

  it('buildExportRows (Document / PDF) : colonnes de lien et couverture toujours exclues', () => {
    const { columns } = buildExportRows(['id', 'link::verification', 'coverageStatus'], root, objects, new Map(), undefined, typeDef, '')
    expect(columns.map(c => c.key)).toEqual(['id'])
  })

  it('gabarit : `keep` restreint l’arbre aux éléments affichés (dossier vide retiré)', () => {
    const outline = buildExportOutline(['id'], root, objects, new Map(), undefined, '', typeDef, new Set(['SYS-3']))
    expect(outline.map(e => e.kind === 'item' ? e.values.id : `dossier ${e.name}`)).toEqual(['dossier Dossier A', 'SYS-3'])
    expect(buildExportOutline(['id'], root, objects, new Map(), undefined, '', typeDef, new Set())).toEqual([])
  })
})
