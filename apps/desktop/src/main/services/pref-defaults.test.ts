import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registerPrefHandlers } from '../ipc/pref.handlers'

type Handler = (e: unknown, ...args: unknown[]) => unknown

let repo: string
let handlers: Map<string, Handler>

const get = (typeKey: string) => handlers.get('pref:get-field-visibility')!(null, repo, 'bob', typeKey)
const set = (typeKey: string, views: unknown) => handlers.get('pref:set-field-visibility')!(null, repo, 'bob', typeKey, views)

beforeEach(async () => {
  repo = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-pref-'))
  handlers = new Map()
  registerPrefHandlers({ handle: (ch: string, fn: Handler) => { handlers.set(ch, fn) } } as never)
})
afterEach(async () => { await fsP.rm(repo, { recursive: true, force: true }) })

describe('GH139 — champs visibles : choix personnel seul (le défaut vient du schéma, côté renderer)', () => {
  it('sans choix personnel : null, rien d’écrit à la lecture', async () => {
    expect(get('root::exigence')).toBeNull()
    expect(await fsP.readdir(repo)).toEqual([])
  })

  it('choix personnel renvoyé tel quel', () => {
    set('root::exigence', { excel: ['title'], word: ['title'] })
    expect(get('root::exigence')).toEqual({ excel: ['title'], word: ['title'] })
  })

  it('« Réinitialiser » (vue à null) retire la vue ; entrée vide retirée, lecture null', () => {
    set('root::exigence', { excel: ['title'], word: ['statement'], showFoldersExcel: false })
    set('root::exigence', { excel: null, showFoldersExcel: null })
    expect(get('root::exigence')).toEqual({ word: ['statement'] })
    set('root::exigence', { word: null })
    expect(get('root::exigence')).toBeNull()
  })
})

describe('GH176 — écriture partielle et colonnes du sélecteur de tests', () => {
  const readEntry = async (typeKey: string) => {
    const pref = JSON.parse(await fsP.readFile(path.join(repo, '.bob.pref'), 'utf-8')) as { fieldVisibility: Record<string, unknown> }
    return pref.fieldVisibility[typeKey]
  }

  it('U1 — une clé seule est ajoutée sans toucher aux autres', async () => {
    set('root::test', { excel: ['x'], word: ['y'] })
    set('root::test', { picker: ['a'] })
    expect(await readEntry('root::test')).toEqual({ excel: ['x'], word: ['y'], picker: ['a'] })
  })

  it('U2 — une écriture complète de la Vue Système conserve picker', async () => {
    set('root::test', { picker: ['a'], showFoldersPicker: false })
    set('root::test', { excel: ['x'], word: ['y'], edit: ['z'], showFoldersExcel: true })
    expect(await readEntry('root::test')).toEqual({ picker: ['a'], showFoldersPicker: false, excel: ['x'], word: ['y'], edit: ['z'], showFoldersExcel: true })
  })

  it('U3 — null supprime la clé', async () => {
    set('root::test', { excel: ['x'], picker: ['a'], showFoldersPicker: false })
    set('root::test', { picker: null, showFoldersPicker: null })
    expect(await readEntry('root::test')).toEqual({ excel: ['x'] })
  })

  it('U4 — une entrée vidée est retirée', async () => {
    set('root::test', { picker: ['a'] })
    set('root::test', { picker: null })
    expect(await readEntry('root::test')).toBeUndefined()
    expect(get('root::test')).toBeNull()
  })
})
