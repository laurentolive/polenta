import { describe, expect, it, vi } from 'vitest'
import type { TFunction } from 'i18next'
import type { VersionAnalysis, VersionPage, VersionRequirementsPage, VersionTestsToRun } from '@polenta/types'
import {
  availableVersionSections, buildVersionSectionTables, toTablesExportPayload, VERSION_SECTIONS, type SectionTable, type VersionSectionTablesInput,
} from './versionSectionTables'
import { buildVersionRequirementColumns } from './versionRequirementColumns'
import { buildVersionChangeColumns, INERT_CHANGE_GESTURES } from './versionChangeColumns'

// Les liens d'élément et de version sont des composants liés à l'application (navigation, API, `window`) : sans objet
// pour des tables de texte, qui ne lisent que `getText`.
vi.mock('../element/ElementLink', () => ({ ElementLink: () => null }))
vi.mock('../element/ElementLinks', () => ({ ElementLinks: () => null }))
vi.mock('../element/PageLink', () => ({ PageLink: () => null }))

// GH439 sprint 3 — tables d'export des sections de la page d'une version (specs/GH439-tests.md T1 à T10).

/** Traduction de test : la clé, suivie des paramètres. */
const t = ((key: string, opts?: Record<string, unknown>) => (opts ? `${key} ${JSON.stringify(opts)}` : key)) as unknown as TFunction

const TYPE_DEF = { name: 'version', label: 'Version', category: 'version', fields: [{ name: 'notes', label: 'Notes', type: 'text' }], statuses: [{ name: 'en_cours', label: 'En cours' }, { name: 'released', label: 'Released', isApproval: true }] }
const page = (over: Partial<VersionPage> = {}, freeze?: VersionPage['version']['freeze']): VersionPage => ({
  version: { id: 'PV-0001', objectTypeRef: 'root::version', title: '1.0', status: 'released', fields: { notes: 'à relire' }, ...(freeze && { freeze }) },
  state: 'released', component: { name: 'produit', label: 'Produit', repoPath: '/repo', readonly: false },
  typeDef: TYPE_DEF, basedOn: null, basedOnOptions: [], components: [],
  rows: [
    { component: 'produit', componentLabel: 'Produit', repoPath: '/repo', versionId: 'PV-0001', versionTitle: '1.0', category: 'requirement', id: 'PR-0001', title: 'Démarrage', toSha: 'abc', filePath: 'requirements/PR-0001.yaml', own: true },
    { component: 'produit', componentLabel: 'Produit', repoPath: '/repo', versionId: 'PV-0001', versionTitle: '1.0', category: 'test', id: 'PT-0001', title: 'Test démarrage', toSha: 'abc', filePath: 'tests/PT-0001.yaml', own: true },
  ],
  ...over,
} as unknown as VersionPage)
const FREEZE = { tag: 'p-1.0', sha: '0123456789abcdef', at: '2026-11-25T10:00:00.000Z' }

const requirements = (over: Partial<VersionRequirementsPage> = {}): VersionRequirementsPage => ({
  version: { id: 'PV-0001', title: '1.0', state: 'released', freeze: FREEZE }, verification: 'frozen',
  rows: [
    { requirementId: 'PR-0001', title: 'Démarrage', objectTypeRef: 'root::exigence', status: 'approved', version: 2, fields: { priority: 'high' }, coverageStatus: 'validated', tests: ['PT-0001'] },
    { requirementId: 'PR-0002', title: 'Arrêt', objectTypeRef: 'root::exigence', status: 'draft', version: 1, fields: { priority: '<p>low</p>' }, coverageStatus: null, tests: [] },
  ],
  requirementFields: [{ name: 'priority', label: 'Priorité', type: 'text' }],
  requirementTypeLabels: { 'root::exigence': 'Exigence' },
  requirementStatusLabels: { approved: 'Approuvé', draft: 'Brouillon' },
  ...over,
})
const impact = (): { analysis: VersionAnalysis; tests: VersionTestsToRun | null } => ({
  analysis: {
    computedAt: FREEZE.at, frozen: true, roots: [],
    rows: [{ id: 'PR-0003', elementType: 'requirement', title: 'Impactée', status: 'impact_non_verifie', reached: true, sources: [{ rootId: 'PR-0001', path: [{ id: 'PR-0003', linkType: 'refines' }] }] }],
  },
  tests: { tests: [{ testId: 'PT-0001', title: 'Test démarrage', requirementIds: ['PR-0001'], sources: ['PR-0001', 'PT-0001'], alreadyIn: [] }], uncovered: [] },
})
const input = (over: Partial<VersionSectionTablesInput> = {}): VersionSectionTablesInput => ({
  selected: VERSION_SECTIONS, page: page({}, FREEZE), impact: impact(), requirements: requirements(), t, language: 'fr', exportedAt: new Date('2026-11-26T08:00:00Z'), ...over,
})
const byId = (tables: SectionTable[], id: string) => tables.find(x => x.id === id)!

describe('buildVersionSectionTables', () => {
  it('T1 — sections cochées : une table chacune, dans l\'ordre de la page', () => {
    const tables = buildVersionSectionTables(input({ selected: ['requirements', 'info'] }))
    expect(tables.map(x => x.id)).toEqual(['info', 'requirements'])
    expect(tables.map(x => x.title)).toEqual(['versions.info.title', 'versions.requirements.title'])
  })

  it('T2 — colonne masquée dans les préférences : absente ; colonnes dans l\'ordre choisi ; verrouillée en tête', () => {
    const [table] = buildVersionSectionTables(input({
      selected: ['requirements'],
      grids: { requirements: { columns: ['coverageStatus', 'title', 'tests'], widths: { title: 240 } } },
    }))
    expect(table.columns.map(c => c.key)).toEqual(['id', 'coverageStatus', 'title', 'tests'])   // `id` verrouillée, `status` masquée
    expect(table.columns.find(c => c.key === 'title')!.width).toBe(240)
    expect(table.rows[0]).toEqual({ id: 'PR-0001', coverageStatus: 'system.coverage.status.validated', title: 'Démarrage', tests: 'PT-0001' })
  })

  it('T2b — sans préférence : colonnes par défaut de la grille (ID, titre, statut, champs, vérification)', () => {
    const [table] = buildVersionSectionTables(input({ selected: ['requirements'] }))
    expect(table.columns.map(c => c.key)).toEqual(['id', 'title', 'status', 'field:priority', 'coverageStatus'])
  })

  it('T3 — colonnes de gestes (diff, actions) exclues, même si les préférences les listent', () => {
    const [table] = buildVersionSectionTables(input({ selected: ['changes'], grids: { changes: { columns: ['id', 'label', 'diff', 'actions'] } } }))
    expect(table.columns.map(c => c.key)).toEqual(['id', 'label'])
  })

  it('T4 — toutes les lignes : aucun filtre ni tri de l\'écran n\'entre dans la fonction', () => {
    const [table] = buildVersionSectionTables(input({ selected: ['requirements'] }))
    expect(table.rows.map(r => r['id'])).toEqual(['PR-0001', 'PR-0002'])
  })

  it('T5 — texte exporté = getText de la colonne de la grille, cellule par cellule', () => {
    const p = page({}, FREEZE)
    const columns = buildVersionChangeColumns({ t, gestures: INERT_CHANGE_GESTURES, removable: false }).filter(c => !['diff', 'actions'].includes(c.key))
    const [table] = buildVersionSectionTables(input({ selected: ['changes'], page: p, grids: { changes: { columns: columns.map(c => c.key) } } }))
    p.rows.forEach((row, i) => columns.forEach(c => expect(table.rows[i][c.key], c.key).toBe(c.getText(row))))
    const req = requirements()
    const reqColumns = buildVersionRequirementColumns({ page: req, t })
    const [reqTable] = buildVersionSectionTables(input({ selected: ['requirements'], requirements: req, grids: { requirements: { columns: reqColumns.map(c => c.key) } } }))
    req.rows.forEach((row, i) => reqColumns.forEach(c => expect(reqTable.rows[i][c.key], c.key).toBe(c.getText(row))))
  })

  it('T6 — Informations : libellé, état, statut, tag, date de gel, commit, champs du type, composant ; en cours : ni tag ni commit', () => {
    const info = byId(buildVersionSectionTables(input({ selected: ['info'] })), 'info')
    expect(info.columns.map(c => c.key)).toEqual(['field', 'value'])
    const values = Object.fromEntries(info.rows.map(r => [r['field'], r['value']]))
    expect(values['versions.label']).toBe('1.0')
    expect(values['versions.export.info.state']).toBe('versions.state.released')
    expect(values['versions.status']).toBe('Released')
    expect(values['versions.release.tag']).toBe('p-1.0')
    expect(values['versions.export.info.commit']).toBe('0123456')
    expect(values['versions.export.info.frozenAt']).toContain('2026')
    expect(values['Notes']).toBe('à relire')
    expect(values['versions.export.info.component']).toBe('Produit')
    expect(values['versions.export.info.exportedAt']).toContain('2026')

    const running = buildVersionSectionTables(input({ selected: ['info'], page: page({ state: 'in_progress' }) }))[0]
    const fields = running.rows.map(r => r['field'])
    expect(fields).not.toContain('versions.release.tag')
    expect(fields).not.toContain('versions.export.info.commit')
  })

  it('T7 — Composants : composant, version retenue, état', () => {
    const p = page({
      components: [
        { name: 'moteur', label: 'Moteur', repoPath: '/m', versionType: true, selected: { id: 'MV-0001', title: '2.1', status: 'released', state: 'released' }, options: [] },
        { name: 'bms', label: 'BMS', repoPath: '/b', versionType: true, selected: null, options: [] },
        { name: 'doc', label: 'Doc', repoPath: '/d', versionType: false, selected: null, options: [] },
      ],
    }, FREEZE)
    const [table] = buildVersionSectionTables(input({ selected: ['components'], page: p }))
    expect(table.rows).toEqual([
      { component: 'Moteur', version: '2.1 (MV-0001)', state: 'versions.state.released' },
      { component: 'BMS', version: 'versions.none', state: '' },
      { component: 'Doc', version: 'versions.noType', state: '' },
    ])
  })

  it('T8 — couverture non figée : « — » ; statut figé : libellé du statut ; champ richtext aplati', () => {
    const [table] = buildVersionSectionTables(input({ selected: ['requirements'] }))
    expect(table.rows[0]['coverageStatus']).toBe('system.coverage.status.validated')
    expect(table.rows[1]['coverageStatus']).toBe('—')
    const [withField] = buildVersionSectionTables(input({ selected: ['requirements'], grids: { requirements: { columns: ['field:priority'] } } }))
    expect(withField.rows[1]['field:priority']).toBe('low')
  })

  it('T9 — version abandonnée : Analyse et Tests non produites même demandées ; sans gel, pas d\'Exigences', () => {
    const abandonedFrozen = page({ state: 'abandoned' }, FREEZE)
    expect(buildVersionSectionTables(input({ page: abandonedFrozen })).map(x => x.id)).toEqual(['info', 'changes', 'requirements'])
    const abandonedNever = page({ state: 'abandoned' })
    expect(availableVersionSections(abandonedNever)).toEqual(['info', 'changes'])
    expect(buildVersionSectionTables(input({ page: abandonedNever })).map(x => x.id)).toEqual(['info', 'changes'])
  })

  it('T10 — section vide : table avec ses en-têtes et zéro ligne ; données absentes : section omise', () => {
    const [empty] = buildVersionSectionTables(input({ selected: ['requirements'], requirements: requirements({ rows: [] }) }))
    expect(empty.rows).toEqual([])
    expect(empty.columns.length).toBeGreaterThan(0)
    expect(buildVersionSectionTables(input({ selected: ['requirements', 'tests'], requirements: undefined, impact: undefined }))).toEqual([])
  })

  it('analyse et tests : lignes de l\'analyse, tests à exécuter', () => {
    const tables = buildVersionSectionTables(input({ selected: ['analysis', 'tests'] }))
    expect(byId(tables, 'analysis').rows[0]).toMatchObject({ id: 'PR-0003', label: 'Impactée', source: 'PR-0001 → PR-0003' })
    expect(byId(tables, 'tests').rows[0]).toMatchObject({ id: 'PT-0001', requirements: 'PR-0001', via: 'PR-0001' })
  })
})

describe('toTablesExportPayload', () => {
  it('une feuille par table, colonnes et lignes reprises, nom de feuille ≤ 31 caractères', () => {
    const table = (title: string): SectionTable => ({ id: 'changes', title, columns: [{ key: 'a', label: 'A', width: 120 }], rows: [{ a: '1' }] })
    const { sheets } = toTablesExportPayload([table('Informations'), table('Un titre de section bien trop long pour Excel')])
    expect(sheets).toEqual([
      { sheetName: 'Informations', columns: [{ key: 'a', label: 'A', width: 120 }], rows: [{ a: '1' }] },
      { sheetName: 'Un titre de section bien trop l', columns: [{ key: 'a', label: 'A', width: 120 }], rows: [{ a: '1' }] },
    ])
  })
})
