import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { TypeTreeNode } from '@polenta/types'
import { TreeService, hydrateTree, stripTree } from './tree.service'

// GH180 — le fichier d'arbre ne garde que le rangement curaté ; l'inventaire et les libellés
// viennent des objets.

const item = (objectId: string, name = objectId, id = `n-${objectId}`): TypeTreeNode =>
  ({ id, kind: 'item', name, objectId, children: [] })
const folder = (id: string, name: string, children: TypeTreeNode[] = []): TypeTreeNode =>
  ({ id, kind: 'folder', name, children })

describe('hydrateTree', () => {
  it('nomme les éléments d’après le titre et ajoute les objets non classés triés par ID', () => {
    const stored = [folder('f1', 'Perf', [{ id: 'n1', kind: 'item', objectId: 'R-0002', children: [] } as unknown as TypeTreeNode])]
    const root = hydrateTree(stored, [
      { id: 'R-0003', title: 'Trois' }, { id: 'R-0002', title: 'Deux' }, { id: 'R-0001', title: 'Un' },
    ])
    expect(root.map(n => n.name)).toEqual(['Perf', 'Un', 'Trois'])
    expect(root[0].children[0].name).toBe('Deux')
    expect(root[1]).toEqual({ id: 'item-R-0001', kind: 'item', name: 'Un', objectId: 'R-0001', children: [] })
  })

  it('garde le nom d’un ancien fichier pour un objet introuvable, sinon l’ID', () => {
    const root = hydrateTree([item('R-0009', 'Ancien'), { id: 'x', kind: 'item', objectId: 'R-0008', children: [] } as unknown as TypeTreeNode], [])
    expect(root.map(n => n.name)).toEqual(['Ancien', 'R-0008'])
  })
})

describe('stripTree', () => {
  it('retire le nom des éléments et la queue non classée en ordre croissant', () => {
    const stored = stripTree([folder('f1', 'Perf', [item('R-0005', 'Cinq')]), item('R-0001'), item('R-0003')])
    expect(stored).toEqual([{ id: 'f1', kind: 'folder', name: 'Perf', children: [{ id: 'n-R-0005', kind: 'item', objectId: 'R-0005', children: [] }] }])
  })

  it('garde les éléments placés hors ordre croissant (vrai rangement)', () => {
    const stored = stripTree([item('R-0003'), item('R-0001'), item('R-0002')])
    expect(stored.map(n => n.objectId)).toEqual(['R-0003'])
    // relu : R-0003 puis les non classés R-0001, R-0002 → même ordre qu'avant
    expect(hydrateTree(stored, ['R-0001', 'R-0002', 'R-0003'].map(id => ({ id, title: id }))).map(n => n.objectId))
      .toEqual(['R-0003', 'R-0001', 'R-0002'])
  })

  it('s’arrête sur un dossier, un élément à enfants, un doublon ou un élément sans objet', () => {
    expect(stripTree([item('R-0001'), folder('f', 'F')])).toHaveLength(2)
    expect(stripTree([{ ...item('R-0001'), children: [item('R-0002')] }])).toHaveLength(1)
    expect(stripTree([folder('f', 'F', [item('R-0001')]), item('R-0001')])).toHaveLength(2)
    expect(stripTree([{ id: 'tmp', kind: 'item', name: 'Sans titre', children: [] }])).toEqual([
      { id: 'tmp', kind: 'item', name: 'Sans titre', children: [] },
    ])
  })
})

describe('TreeService (GH180)', () => {
  let repo: string
  let objects: Array<{ id: string; title: string }>
  let service: TreeService
  const file = () => path.join(repo, '.polenta', 'trees', 'root', 'req.yaml')

  beforeEach(async () => {
    repo = await fsP.mkdtemp(path.join(os.tmpdir(), 'gh180-'))
    objects = [{ id: 'R-0001', title: 'Un' }, { id: 'R-0002', title: 'Deux' }]
    service = new TreeService(async (_repo, ref) => (ref === 'root::req' ? objects : []))
  })
  afterEach(() => fsP.rm(repo, { recursive: true, force: true }))

  it('sans fichier, liste les objets du type et n’écrit rien si rien n’est rangé', async () => {
    const tree = await service.get(repo, 'root', 'req')
    expect(tree.root.map(n => n.name)).toEqual(['Un', 'Deux'])
    await service.save(repo, tree)
    await expect(fsP.access(file())).rejects.toThrow()
  })

  it('ajouter un objet en fin de liste ne modifie pas le fichier', async () => {
    const tree = await service.get(repo, 'root', 'req')
    await service.save(repo, { ...tree, root: [folder('f1', 'Perf', [tree.root[1]]), tree.root[0]] })
    const before = await fsP.readFile(file(), 'utf-8')
    expect(before).not.toContain('Deux')

    objects.push({ id: 'R-0003', title: 'Trois' })
    const after = await service.get(repo, 'root', 'req')
    expect(after.root.map(n => n.name)).toEqual(['Perf', 'Un', 'Trois'])
    await service.save(repo, after)
    expect(await fsP.readFile(file(), 'utf-8')).toBe(before)
  })

  it('lit un ancien fichier (avec `name`) et le libellé suit le titre courant', async () => {
    await fsP.mkdir(path.dirname(file()), { recursive: true })
    await fsP.writeFile(file(), yaml.dump({ nodeId: 'root', typeId: 'req', root: [item('R-0002', 'Ancien titre')] }))
    const tree = await service.get(repo, 'root', 'req')
    expect(tree.root.map(n => n.name)).toEqual(['Deux', 'Un'])
  })
})
