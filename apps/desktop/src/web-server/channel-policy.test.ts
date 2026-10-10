import { describe, expect, it } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { createContainer } from '../main/container'
import { registerHandlers } from '../main/ipc/index'
import { DESKTOP_ONLY_CHANNELS } from '../main/ipc/channels'
import { registerWebHandlers } from './web-handlers'
import { FileStore } from './file-store'
import { createWebHostContext, createWebPlatformHost, MemoryTokenStore, pendingPrintRenderer } from './web-host'
import * as fs from 'fs'
import { WEB_EXPOSED, WEB_HIDDEN, WEB_ONLY_CHANNELS, ROOT_ARGS, ROOT_PARAM_NAME, isExposed } from './channel-policy'

/** Positions des paramètres « racine » relevées dans le source des handlers (même règle que la table). */
function rootArgsFromSource(): Record<string, number[]> {
  const files = ['../main/ipc/index.ts', '../main/ipc/pref.handlers.ts', './web-handlers.ts']
  const src = files.map(f => fs.readFileSync(path.join(__dirname, f), 'utf-8')).join('\n')
  const result: Record<string, number[]> = {}
  for (const m of src.matchAll(/(?:r\.handle|handle)\(\s*'([^']+)',\s*(?:async\s*)?\(([^)]*)\)/g)) {
    const params = m[2].replace(/\s+/g, ' ').split(/,(?![^<{]*[>}])/).map(p => p.trim()).filter(Boolean)
    const names = params.slice(1).map(p => p.split(':')[0].trim().replace(/\?$/, '').split('=')[0].trim())
    const idx = names.flatMap((n, i) => (ROOT_PARAM_NAME.test(n) ? [i] : []))
    if (idx.length) result[m[1]] = idx
  }
  return result
}

function registeredChannels() {
  const dir = path.join(os.tmpdir(), 'polenta-policy-test')
  const container = createContainer(createWebHostContext(dir, new MemoryTokenStore(), { hideGithub: true }), pendingPrintRenderer)
  const shared: string[] = []
  registerHandlers({ handle: (ch) => { shared.push(ch) } }, container, createWebPlatformHost(() => {}, dir))
  const web: string[] = []
  registerWebHandlers({ handle: (ch) => { web.push(ch) } }, {
    container,
    dirs: { root: dir, workspaces: dir, userData: dir },
    uploads: new FileStore(dir, 1),
    downloads: new FileStore(dir, 1),
    version: '0',
  })
  return { shared, web }
}

describe('ChannelPolicy (S2-12, S2-13)', () => {
  const { shared, web } = registeredChannels()

  it('chaque channel partagé est classé : exposé ou masqué, jamais les deux', () => {
    const hidden = new Set(Object.keys(WEB_HIDDEN))
    const unclassified = shared.filter(ch => !WEB_EXPOSED.has(ch) && !hidden.has(ch))
    expect(unclassified).toEqual([])
    expect([...hidden].filter(ch => WEB_EXPOSED.has(ch))).toEqual([])
  })

  it('aucune entrée de la politique ne vise un channel inexistant', () => {
    const all = new Set([...shared, ...web])
    expect([...WEB_EXPOSED].filter(ch => !all.has(ch))).toEqual([])
    expect(Object.keys(WEB_HIDDEN).filter(ch => !all.has(ch))).toEqual([])
  })

  it('les channels web-only déclarés sont exactement ceux enregistrés', () => {
    expect([...web].sort()).toEqual([...WEB_ONLY_CHANNELS].sort())
  })

  it('aucun channel desktop-only n\'est enregistré côté serveur', () => {
    const all = new Set([...shared, ...web].filter(ch => ch !== 'app:get-version'))
    expect(DESKTOP_ONLY_CHANNELS.filter(ch => all.has(ch))).toEqual([])
  })

  it('ROOT_ARGS synchronisée avec les signatures des handlers', () => {
    expect(ROOT_ARGS).toEqual(rootArgsFromSource())
  })

  it('channels sensibles ou locaux non exposés', () => {
    for (const ch of ['auth:get-token', 'auth:save-token', 'auth:setup', 'dialog:pick-folder', 'update:install',
      'export:open-file', 'export:show-in-folder', 'drawio:open-external', 'inconnu:x']) {
      expect(isExposed(ch)).toBe(false)
    }
  })
})
