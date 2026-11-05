import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Requirement } from '@polenta/types'

import { InterfaceComplianceService } from './interface-compliance.service'
import type { RequirementsIndexService } from './requirements-index.service'
import type { WorkspaceTreeService } from './workspace-tree.service'

// GH22 — une interface en repo séparé porte ses rôles sur le nœud `root` de son schéma, alors que
// `implements[].interface` est son nom de montage : la matrice n'avait aucune colonne d'implémenteur.
// Même configuration que `if-bus-interne` et `bus-ihm` du projet de démo.

let ws: string

const req = (id: string, objectTypeRef: string): Requirement => ({
  id, projectId: '', branchId: '', objectTypeRef, title: id, status: 'approved', version: 1,
  fields: {}, jiraLinks: [], createdAt: null, createdBy: null, updatedAt: null, updatedBy: null,
})

async function repo(name: string, nodes: unknown[]): Promise<{ name: string; repoPath: string }> {
  const repoPath = path.join(ws, name)
  await fsP.mkdir(path.join(repoPath, '.polenta'), { recursive: true })
  await fsP.writeFile(path.join(repoPath, '.polenta', 'schema.yaml'), yaml.dump({ version: 1, nodes, linkTypes: [] }))
  return { name, repoPath }
}

const ROLES = [{ name: 'controller', label: 'Contrôleur' }, { name: 'device', label: 'Appareil' }]

async function service() {
  const nodes = [
    await repo('produit', [{
      name: 'root',
      children: [
        { name: 'bus-ihm', roles: ROLES },
        { name: 'carte', implements: [{ interface: 'if-bus', roles: ['controller'] }, { interface: 'bus-ihm', roles: ['device'] }] },
      ],
    }]),
    await repo('if-bus', [{ name: 'root', roles: ROLES }]),
    await repo('moteur', [{ name: 'root', implements: [{ interface: 'if-bus', roles: ['device'] }] }]),
    // Un autre repo d'interface : ses implémenteurs ne doivent pas se mélanger avec ceux d'`if-bus`.
    await repo('if-autre', [{ name: 'root', roles: ROLES }]),
  ]
  const reqs: Record<string, Requirement[]> = {
    [nodes[0].repoPath]: [req('IHM-1', 'bus-ihm::exigence')],
    [nodes[1].repoPath]: [req('BUS-1', 'root::exigence')],
    [nodes[3].repoPath]: [req('AUT-1', 'root::exigence')],
  }
  const tree = { nodes }
  const workspaceTree = { readCache: async () => tree } as unknown as WorkspaceTreeService
  const reqIndex = {
    findAll: async (repoPath: string) => reqs[repoPath] ?? [],
    findAllLinks: async () => [],
    findById: async () => null,
  } as unknown as RequirementsIndexService
  return new InterfaceComplianceService(workspaceTree, reqIndex)
}

beforeEach(async () => {
  ws = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh22-'))
})
afterEach(async () => {
  await fsP.rm(ws, { recursive: true, force: true })
})

describe('InterfaceComplianceService.getComplianceMatrix (GH22)', () => {
  const columns = async (reqId: string) => {
    const matrices = await (await service()).getComplianceMatrix(ws)
    const matrix = matrices.find(m => m.requirements.some(r => r.id === reqId))!
    return matrix.components.map(c => c.name).sort()
  }

  it('interface en repo séparé : un implémenteur par déclaration du nom de montage', async () => {
    expect(await columns('BUS-1')).toEqual(['moteur', 'produit › carte'])
  })

  it('interface locale : comportement inchangé', async () => {
    expect(await columns('IHM-1')).toEqual(['produit › carte'])
  })

  it('autre repo d\'interface : aucun implémenteur emprunté', async () => {
    expect(await columns('AUT-1')).toEqual([])
  })
})
