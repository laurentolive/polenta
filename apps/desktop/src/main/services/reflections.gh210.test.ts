import { describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition, ProductVersion, Validation } from '@polenta/types'
import { ReflectionsService } from './reflections.service'

// GH210 — reflets Design et Validation (specs/GH210-tests.md, R1 à R11). Le statut de design est calculé par
// `VersionsService.designVersionsFor` (testé par GH204) : ici, choix de la validation retenue et assemblage.

const VALIDATION_TYPE = {
  name: 'validation', category: 'validation', fields: [],
  statuses: [{ name: 'en_cours' }, { name: 'signee', isApproval: true }, { name: 'annulee', isTerminal: true }],
  decisions: [{ name: 'en_attente', label: 'En attente', isPending: true }, { name: 'conforme', label: 'Conforme' }, { name: 'derogation', label: 'Dérogation' }],
} as unknown as ObjectTypeDefinition

const version = (id: string, title: string) => ({ id, title }) as ProductVersion
const validation = (id: string, versionId: string, status: string, entries: Array<[string, string]>) =>
  ({ id, versionId, status, entries: entries.map(([requirementId, decision]) => ({ requirementId, decision })) }) as unknown as Validation

function service(opts: {
  design?: Array<[string, { id: string; title: string }]>
  released?: ProductVersion[]
  validations?: Validation[]
  withType?: boolean
  owner?: string | null
  seen?: string[]
}) {
  const record = (repo: string) => { opts.seen?.push(repo) }
  return new ReflectionsService(
    { resolveComponentRepoPath: async () => opts.owner ?? null },
    {
      designOf: async repo => { record(repo); return new Map(opts.design ?? []) },
      releasedVersions: async () => opts.released ?? [],
    },
    {
      list: async () => opts.validations ?? [],
      validationType: async () => (opts.withType === false ? null : { typeDef: VALIDATION_TYPE, ref: 'root::validation' }),
    },
  )
}

const V10 = version('PV-0001', '1.0')
const V11 = version('PV-0002', '1.1')
const V12 = version('PV-0003', '1.2')

describe('GH210 — reflets', () => {
  it('R1/R10 — sans version ni validation : aucun reflet, pas d\'erreur', async () => {
    expect((await service({ withType: false }).list('/p', 'root::exigence')).requirements).toEqual({})
  })

  it('R2/R3 — design : label de la version ; exigence modifiée depuis : absente du calcul', async () => {
    const r = (await service({ design: [['SYS-0001', { id: 'PV-0001', title: '1.0' }]], released: [V10] }).list('/p', 'root::exigence')).requirements
    expect(r['SYS-0001'].design).toEqual({ versionId: 'PV-0001', versionLabel: '1.0' })
    expect(r['SYS-0002']).toBeUndefined()
  })

  it('R4/R5 — décision de la dernière validation signée, avec son libellé et sa version', async () => {
    const r = (await service({
      released: [V10, V11],
      validations: [validation('VAL-0001', 'PV-0001', 'signee', [['SYS-0001', 'conforme']]), validation('VAL-0002', 'PV-0002', 'signee', [['SYS-0001', 'derogation']])],
    }).list('/p', 'root::exigence')).requirements
    expect(r['SYS-0001'].validation).toEqual({ decision: 'derogation', decisionLabel: 'Dérogation', validationId: 'VAL-0002', versionId: 'PV-0002', versionLabel: '1.1' })
  })

  it('R6/R7 — annulée et ouverte ignorées : retour à la précédente signée', async () => {
    const r = (await service({
      released: [V10, V11, V12],
      validations: [
        validation('VAL-0001', 'PV-0001', 'signee', [['SYS-0001', 'conforme']]),
        validation('VAL-0002', 'PV-0002', 'annulee', [['SYS-0001', 'derogation']]),
        validation('VAL-0003', 'PV-0003', 'en_cours', [['SYS-0001', 'derogation']]),
      ],
    }).list('/p', 'root::exigence')).requirements
    expect(r['SYS-0001'].validation).toMatchObject({ decisionLabel: 'Conforme', versionLabel: '1.0' })
  })

  it('R8 — exigence sans entrée dans la validation retenue : pas de reflet de validation', async () => {
    const r = (await service({
      released: [V10, V11],
      validations: [validation('VAL-0001', 'PV-0001', 'signee', [['SYS-0002', 'conforme']]), validation('VAL-0002', 'PV-0002', 'signee', [['SYS-0001', 'conforme']])],
    }).list('/p', 'root::exigence')).requirements
    expect(r['SYS-0002']).toBeUndefined()
  })

  it('R9 — ordre des livraisons, pas des signatures (fichiers listés dans l\'autre ordre)', async () => {
    const r = (await service({
      released: [V10, V11],
      validations: [validation('VAL-0002', 'PV-0002', 'signee', [['SYS-0001', 'derogation']]), validation('VAL-0003', 'PV-0001', 'signee', [['SYS-0001', 'conforme']])],
    }).list('/p', 'root::exigence')).requirements
    expect(r['SYS-0001'].validation?.versionLabel).toBe('1.1')
  })

  it('R11 — sous-composant : lu dans le repo propriétaire', async () => {
    const seen: string[] = []
    await service({ owner: '/comp', seen }).list('/p', 'moteur::exigence', '/ws')
    expect(seen).toEqual(['/comp'])
  })
})
