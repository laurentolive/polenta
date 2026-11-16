import { describe, expect, it } from 'vitest'
import type { TypeTreeNode } from '@polenta/types'
import {
  TreeOpError, deleteFolder, ensureFolder, findFolder, moveFolder, moveObject, parseFolderPath,
  renameFolder, reorderChildren, toEntries,
} from './tree-ops.util'

// GH361 — opérations de rangement par chemin (specs/GH361-tests.md §A).

const folder = (id: string, name: string, children: TypeTreeNode[] = []): TypeTreeNode => ({ id, kind: 'folder', name, children })
const item = (objectId: string, children: TypeTreeNode[] = []): TypeTreeNode =>
  ({ id: `n-${objectId}`, kind: 'item', name: objectId, objectId, children })

const ids = () => { let n = 0; return () => `g${++n}` }
const code = (fn: () => unknown): string => {
  try {
    fn()
  } catch (err) {
    if (err instanceof TreeOpError) return err.code
    throw err
  }
  return 'OK'
}
/** Forme lisible : `Nom[enfants]` / `#ID[enfants]`. */
const shape = (nodes: TypeTreeNode[]): string => nodes.map(n =>
  `${n.kind === 'folder' ? n.name : `#${n.objectId}`}${n.children.length ? `[${shape(n.children)}]` : ''}`).join(',')

describe('parseFolderPath', () => {
  it('A1 — segments nettoyés, chemin vide ou segment vide refusés', () => {
    expect(parseFolderPath('A/B')).toEqual(['A', 'B'])
    expect(parseFolderPath(' A / B ')).toEqual(['A', 'B'])
    for (const bad of ['', '  ', 'A//B', '/A', 'A/']) expect(code(() => parseFolderPath(bad))).toBe('FOLDER_PATH_INVALID')
  })
})

describe('ensureFolder / findFolder', () => {
  it('A2 — crée les intermédiaires une fois, chacun à la fin de son parent', () => {
    const gen = ids()
    let root: TypeTreeNode[] = [item('R1')]
    const a = ensureFolder(root, ['Sécurité', 'Batterie'], gen)
    root = a.root
    const b = ensureFolder(root, ['Sécurité', 'Moteur'], gen)
    expect(a.created).toEqual(['Sécurité', 'Sécurité/Batterie'])
    expect(b.created).toEqual(['Sécurité/Moteur'])
    expect(shape(b.root)).toBe('#R1,Sécurité[Batterie,Moteur]')
    expect(b.folderId).toBe(findFolder(b.root, ['Sécurité', 'Moteur']).id)
  })

  it('A3 — chemin existant : rien de créé', () => {
    const root = [folder('f', 'A', [folder('g', 'B')])]
    const out = ensureFolder(root, ['A', 'B'], ids())
    expect(out.created).toEqual([])
    expect(out.root).toBe(root)
    expect(out.folderId).toBe('g')
  })

  it('A4 — deux dossiers frères de même nom : ambigu', () => {
    const root = [folder('f1', 'A'), folder('f2', 'A')]
    expect(code(() => findFolder(root, ['A']))).toBe('FOLDER_AMBIGUOUS')
    expect(code(() => ensureFolder(root, ['A', 'B'], ids()))).toBe('FOLDER_AMBIGUOUS')
    expect(code(() => findFolder(root, ['X']))).toBe('FOLDER_NOT_FOUND')
  })

  it('A5 — dossier sous un élément ou nom avec / : non désignable', () => {
    const root = [item('R1', [folder('f', 'Sous')]), folder('g', 'A/B', [folder('h', 'C')])]
    expect(code(() => findFolder(root, ['Sous']))).toBe('FOLDER_NOT_FOUND')
    const entries = toEntries(root, new Map([['R1', 'Titre']]))
    expect(entries[0]).toMatchObject({ kind: 'item', id: 'R1', title: 'Titre' })
    expect(entries[0].children[0].path).toBeNull()
    expect(entries[1].path).toBeNull()
    expect(entries[1].children[0].path).toBeNull()
  })
})

describe('renameFolder / moveFolder / deleteFolder', () => {
  const tree = () => [folder('a', 'A', [folder('b', 'B', [item('R1')]), folder('c', 'C')]), folder('d', 'D', [folder('c2', 'C')])]

  it('A6 — renommage, homonyme, nom invalide, même nom', () => {
    expect(shape(renameFolder(tree(), ['A', 'B'], 'Bis').root)).toBe('A[Bis[#R1],C],D[C]')
    expect(code(() => renameFolder(tree(), ['A', 'B'], 'C'))).toBe('FOLDER_EXISTS')
    expect(code(() => renameFolder(tree(), ['A', 'B'], 'X/Y'))).toBe('FOLDER_PATH_INVALID')
    expect(renameFolder(tree(), ['A', 'B'], ' B ').changed).toBe(false)
  })

  it('A7 — déplacement avec contenu, cycle, homonyme, déjà en place', () => {
    expect(shape(moveFolder(tree(), ['A', 'B'], ['D']).root)).toBe('A[C],D[C,B[#R1]]')
    expect(shape(moveFolder(tree(), ['A', 'B'], null).root)).toBe('A[C],D[C],B[#R1]')
    expect(code(() => moveFolder(tree(), ['A'], ['A']))).toBe('FOLDER_CYCLE')
    expect(code(() => moveFolder(tree(), ['A'], ['A', 'B']))).toBe('FOLDER_CYCLE')
    expect(code(() => moveFolder(tree(), ['A', 'C'], ['D']))).toBe('FOLDER_EXISTS')
    expect(moveFolder(tree(), ['A', 'B'], ['A']).changed).toBe(false)
  })

  it('A8 — suppression vide / non vide / récursive ; objets libérés seulement s’ils ne sont plus rangés', () => {
    expect(shape(deleteFolder(tree(), ['A', 'C'], false).root)).toBe('A[B[#R1]],D[C]')
    expect(code(() => deleteFolder(tree(), ['A'], false))).toBe('FOLDER_NOT_EMPTY')
    const out = deleteFolder(tree(), ['A'], true)
    expect(shape(out.root)).toBe('D[C]')
    expect(out.freed).toEqual(['R1'])
    const twice = [folder('a', 'A', [item('R1')]), { ...item('R1'), id: 'other' }]
    expect(deleteFolder(twice, ['A'], true).freed).toEqual([])
  })
})

describe('moveObject', () => {
  it('A9 — élément avec enfants déplacé avec eux, à la fin ; objet non classé : élément créé', () => {
    const root = [item('R1', [item('R2')]), folder('f', 'F', [item('R3')])]
    expect(shape(moveObject(root, 'R1', 'f', ids()).root)).toBe('F[#R3,#R1[#R2]]')
    const created = moveObject(root, 'R9', 'f', ids())
    expect(shape(created.root)).toBe('#R1[#R2],F[#R3,#R9]')
    expect(moveObject(root, 'R3', 'f', ids()).changed).toBe(false)
  })

  it('A10 — objet rangé deux fois : ambigu', () => {
    const root = [item('R1'), folder('f', 'F', [{ ...item('R1'), id: 'x' }])]
    expect(code(() => moveObject(root, 'R1', 'f', ids()))).toBe('OBJECT_AMBIGUOUS')
  })

  it('A11 — retrait : les enfants prennent sa place', () => {
    const root = [folder('f', 'F', [item('A'), item('R1', [item('R2'), folder('g', 'G')]), item('B')])]
    expect(shape(moveObject(root, 'R1', null, ids()).root)).toBe('F[#A,#R2,G,#B]')
    expect(moveObject(root, 'R9', null, ids()).changed).toBe(false)
  })
})

describe('reorderChildren', () => {
  it('A12 — cités en tête, autres dans l’ordre ; non-enfant, doublon, non classé à la racine', () => {
    const root = [folder('a', 'A', [item('R1'), folder('b', 'B'), item('R2')]), item('R3')]
    const none = () => false
    expect(shape(reorderChildren(root, ['A'], [{ id: 'R2' }, { folder: 'B' }], ids(), none).root)).toBe('A[#R2,B,#R1],#R3')
    expect(code(() => reorderChildren(root, ['A'], [{ id: 'R3' }], ids(), none))).toBe('NOT_A_CHILD')
    expect(code(() => reorderChildren(root, ['A'], [{ id: 'R1' }, { id: 'R1' }], ids(), none))).toBe('DUPLICATE_ENTRY')
    const atRoot = reorderChildren(root, null, [{ id: 'R9' }, { id: 'R3' }], ids(), id => id === 'R9')
    expect(shape(atRoot.root)).toBe('#R9,#R3,A[#R1,B,#R2]')
    expect(reorderChildren(root, null, [{ folder: 'A' }], ids(), none).changed).toBe(false)
  })
})
