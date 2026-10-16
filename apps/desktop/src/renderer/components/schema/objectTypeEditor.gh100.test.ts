import { describe, expect, it } from 'vitest'

import type { ObjectTypeDefinition, TypeRenamePlan } from '@polenta/types'
import { emptyFieldRenameResult } from '@polenta/types'
import { migrationSteps, objTypeToEditable, typeRename, typeRenameDecision, type MigrationApi } from './objectTypeEditor'

// GH100 — scénarios T11–T14 de specs/GH100-tests.md (parties pures du flux de StructureTab).

const RAW = { name: 'HMI_PH2_REQ', prefix: 'HMI_PH2_REQ', category: 'requirement', fields: [], statuses: [] } as unknown as ObjectTypeDefinition
const emptyPlan: TypeRenamePlan = { objects: [], retargeted: 0, files: [], linkTypeRepos: [], errors: [] }

describe('typeRename (T11)', () => {
  it('null si nom et préfixe inchangés', () => {
    expect(typeRename(objTypeToEditable(RAW), RAW, 'root')).toBeNull()
  })

  it('nom seul, préfixe seul, les deux', () => {
    const edit = (patch: object) => ({ ...objTypeToEditable(RAW), ...patch })
    expect(typeRename(edit({ name: 'VE22D_REQ' }), RAW, 'root')).toEqual({
      nodeName: 'root', category: 'requirement', oldName: 'HMI_PH2_REQ', newName: 'VE22D_REQ', oldPrefix: 'HMI_PH2_REQ', newPrefix: 'HMI_PH2_REQ',
    })
    expect(typeRename(edit({ prefix: 'VE22D_REQ' }), RAW, 'root')).toMatchObject({ newName: 'HMI_PH2_REQ', newPrefix: 'VE22D_REQ' })
    expect(typeRename(edit({ name: 'VE22D_REQ', prefix: 'VE22D_REQ' }), RAW, 'n')).toMatchObject({ nodeName: 'n', newName: 'VE22D_REQ', newPrefix: 'VE22D_REQ' })
  })

  it('type nouveau (aucun original) : null', () => {
    expect(typeRename(objTypeToEditable(RAW), null, 'root')).toBeNull()
  })
})

describe('typeRenameDecision (T12–T13)', () => {
  it('erreur de pré-contrôle → rien n\'est enregistré', () => {
    expect(typeRenameDecision({ ...emptyPlan, errors: [{ code: 'ID_COLLISION', detail: 'x' }] })).toBe('error')
  })

  it('rien à migrer → enregistrement direct ; sinon confirmation', () => {
    expect(typeRenameDecision(emptyPlan)).toBe('direct')
    expect(typeRenameDecision({ ...emptyPlan, retargeted: 2 })).toBe('confirm')
    expect(typeRenameDecision({ ...emptyPlan, objects: [{ oldId: 'A-0001', newId: 'B-0001' }] })).toBe('confirm')
    expect(typeRenameDecision({ ...emptyPlan, files: [{ repoPath: 'r', path: 'links/links.yaml' }] })).toBe('confirm')
  })
})

describe('migrationSteps (T14)', () => {
  it('champs puis valeurs sous l\'ancien objectTypeRef, puis type', async () => {
    const calls: string[] = []
    const fake: MigrationApi = {
      renameFields: async (_p, ref) => { calls.push(`fields:${ref}`); return emptyFieldRenameResult() },
      renameValues: async (_p, ref) => { calls.push(`values:${ref}`); return emptyFieldRenameResult() },
      renameType: async (_p, ws, dto) => { calls.push(`type:${ws}:${dto.newName}`); return { ...emptyFieldRenameResult(), files: 0 } },
    }
    const dto = typeRename({ ...objTypeToEditable(RAW), name: 'VE22D_REQ' }, RAW, 'root')
    const steps = migrationSteps(fake, 'repo', 'ws', 'root::HMI_PH2_REQ', [{ from: 'a', to: 'b' }],
      [{ target: { kind: 'status' }, from: 'draft', to: 'brouillon' }], dto)
    for (const s of steps) await s()
    expect(calls).toEqual(['fields:root::HMI_PH2_REQ', 'values:root::HMI_PH2_REQ', 'type:ws:VE22D_REQ'])
  })

  it('aucune migration → aucune étape', () => {
    const fake = {} as MigrationApi
    expect(migrationSteps(fake, 'repo', 'ws', 'root::X', [], [], null)).toEqual([])
  })
})
