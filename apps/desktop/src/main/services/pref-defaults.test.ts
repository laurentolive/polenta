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
  it('sans choix personnel : défaut de l’équipe ; autre type : défaut de Polenta', () => {
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
