import * as fsP from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TeamConfigStatus } from '@polenta/types'

import { registerPrefHandlers } from '../ipc/pref.handlers'
import type { ForgeConfigService } from './forge-config.service'

type Handler = (e: unknown, ...args: unknown[]) => unknown

let repo: string
let handlers: Map<string, Handler>

function withTeamDefault(fieldVisibility: Record<string, Record<string, string[]>> | undefined): void {
  const status: TeamConfigStatus = {
    config: { projects: [], updates: 'auto', preferences: fieldVisibility ? { fieldVisibility } : {}, teams: [] },
    warnings: [],
  }
  const forgeConfig = { status: () => status } as unknown as ForgeConfigService
  handlers = new Map()
  registerPrefHandlers({ handle: (ch: string, fn: Handler) => { handlers.set(ch, fn) } } as never, forgeConfig)
}

const get = (typeKey: string) => handlers.get('pref:get-field-visibility')!(null, repo, 'bob', typeKey)
const set = (typeKey: string, views: unknown) => handlers.get('pref:set-field-visibility')!(null, repo, 'bob', typeKey, views)

beforeEach(async () => { repo = await fsP.mkdtemp(path.join(os.tmpdir(), 'polenta-pref-')) })
afterEach(async () => { await fsP.rm(repo, { recursive: true, force: true }) })

describe('champs visibles par défaut de l’équipe (S2b-11, critère 23)', () => {
  it('sans choix personnel : défaut de l’équipe ; autre type : défaut de l’application', () => {
    withTeamDefault({ 'root::exigence': { excel: ['priority', 'statement'] } })
    expect(get('root::exigence')).toEqual({ excel: ['priority', 'statement'] })
    expect(get('root::test')).toBeNull()
  })

  it('un choix personnel l’emporte, et le défaut n’est jamais écrit dans le .pref', async () => {
    withTeamDefault({ 'root::exigence': { excel: ['priority'] } })
    expect(await fsP.readdir(repo)).toEqual([])          // rien d'écrit à la lecture
    set('root::exigence', { excel: ['title'], word: ['title'], edit: ['title'] })
    expect(get('root::exigence')).toEqual({ excel: ['title'], word: ['title'], edit: ['title'] })
  })

  it('sans configuration de forge : comportement d’avant (null)', () => {
    withTeamDefault(undefined)
    expect(get('root::exigence')).toBeNull()
  })
})

describe('GH176 — écriture partielle et colonnes du sélecteur de tests', () => {
  const readEntry = async (typeKey: string) => {
    const pref = JSON.parse(await fsP.readFile(path.join(repo, '.bob.pref'), 'utf-8')) as { fieldVisibility: Record<string, unknown> }
    return pref.fieldVisibility[typeKey]
  }

  it('U1 — une clé seule est ajoutée sans toucher aux autres', async () => {
    withTeamDefault(undefined)
    set('root::test', { excel: ['x'], word: ['y'] })
    set('root::test', { picker: ['a'] })
    expect(await readEntry('root::test')).toEqual({ excel: ['x'], word: ['y'], picker: ['a'] })
  })

  it('U2 — une écriture complète de la Vue Système conserve picker', async () => {
    withTeamDefault(undefined)
    set('root::test', { picker: ['a'], showFoldersPicker: false })
    set('root::test', { excel: ['x'], word: ['y'], edit: ['z'], showFoldersExcel: true })
    expect(await readEntry('root::test')).toEqual({ picker: ['a'], showFoldersPicker: false, excel: ['x'], word: ['y'], edit: ['z'], showFoldersExcel: true })
  })

  it('U3 — null supprime la clé', async () => {
    withTeamDefault(undefined)
    set('root::test', { excel: ['x'], picker: ['a'], showFoldersPicker: false })
    set('root::test', { picker: null, showFoldersPicker: null })
    expect(await readEntry('root::test')).toEqual({ excel: ['x'] })
  })

  it('U4 — une entrée vidée est retirée, la lecture retombe sur le défaut', async () => {
    withTeamDefault({ 'root::test': { excel: ['e'] } })
    set('root::test', { picker: ['a'] })
    set('root::test', { picker: null })
    expect(await readEntry('root::test')).toBeUndefined()
    expect(get('root::test')).toEqual({ excel: ['e'] })
  })

  it('U5 — le défaut de l’équipe complète une entrée qui ne porte que picker', () => {
    withTeamDefault({ 'root::test': { excel: ['e'] } })
    set('root::test', { picker: ['p'] })
    expect(get('root::test')).toEqual({ excel: ['e'], picker: ['p'] })
  })

  it('U6 — le choix personnel l’emporte vue par vue', () => {
    withTeamDefault({ 'root::test': { excel: ['e'], word: ['w'] } })
    set('root::test', { excel: ['m'] })
    expect(get('root::test')).toEqual({ excel: ['m'], word: ['w'] })
  })

  it('U7 — ni défaut ni choix personnel : null', () => {
    withTeamDefault({ 'root::autre': { excel: ['e'] } })
    expect(get('root::test')).toBeNull()
  })
})
