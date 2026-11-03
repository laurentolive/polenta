import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as yaml from 'js-yaml'
import { isAppMaintainedFile } from '@polenta/types'
import { SavedViewsService, moveTeamViewsFile, renameFieldsInTeamViews } from './saved-views.service'
import { readPref, writePref } from './pref-store.util'

const KEY = 'root::exigence'
const FILE = path.join('.polenta', 'views', 'root', 'exigence.yaml')
const settings = { excel: ['id', 'name'], word: ['name'], popup: [], showFoldersExcel: true }

let repo: string
let readonly: boolean
let service: SavedViewsService

const teamYaml = () => yaml.load(fs.readFileSync(path.join(repo, FILE), 'utf-8')) as { version: number; views: Array<{ name: string; settings: Record<string, unknown> }> }
const writeTeamText = (text: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, FILE)), { recursive: true })
  fs.writeFileSync(path.join(repo, FILE), text)
}
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: Error) => e.message.split(':')[0])

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gh203-'))
  readonly = false
  service = new SavedViewsService(async () => readonly)
})
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }))

describe('portée personnelle', () => {
  it('écrit dans le .pref, sans fichier de repo, et garde les clés voisines', async () => {
    writePref(repo, 'bob', { fieldVisibility: { [KEY]: { excel: ['id'], picker: ['status'] } } })
    await service.create(repo, 'bob', KEY, 'personal', '  Revue  ', settings)
    const entry = (readPref(repo, 'bob').fieldVisibility as Record<string, Record<string, unknown>>)[KEY]
    expect(entry.excel).toEqual(['id'])
    expect(entry.picker).toEqual(['status'])
    expect(entry.savedViews).toEqual([{ name: 'Revue', settings }])
    expect(fs.existsSync(path.join(repo, FILE))).toBe(false)
  })

  it('met à jour, renomme, supprime ; la dernière suppression retire la clé', async () => {
    const ref = await service.create(repo, 'bob', KEY, 'personal', 'A', settings)
    await service.update(repo, 'bob', KEY, ref, { excel: ['id'] })
    expect((await service.list(repo, 'bob', KEY)).personal).toEqual([{ name: 'A', settings: { excel: ['id'] } }])
    const renamed = await service.rename(repo, 'bob', KEY, ref, 'B')
    expect(renamed).toEqual({ scope: 'personal', name: 'B' })
    await service.delete(repo, 'bob', KEY, renamed)
    expect((await service.list(repo, 'bob', KEY)).personal).toEqual([])
    expect(readPref(repo, 'bob').fieldVisibility).toEqual({})
  })

  it('ne voit pas les vues d\'un autre utilisateur', async () => {
    await service.create(repo, 'bob', KEY, 'personal', 'A', settings)
    expect((await service.list(repo, 'alice', KEY)).personal).toEqual([])
  })
})

describe('portée équipe', () => {
  it('crée le fichier, le met à jour et le retire avec la dernière vue', async () => {
    const ref = await service.create(repo, 'bob', KEY, 'team', 'Revue', settings)
    expect(teamYaml()).toEqual({ version: 1, views: [{ name: 'Revue', settings }] })
    await service.update(repo, 'bob', KEY, ref, { excel: ['id'] })
    expect(teamYaml().views[0].settings).toEqual({ excel: ['id'] })
    expect((await service.list(repo, 'alice', KEY)).team.map(v => v.name)).toEqual(['Revue'])
    await service.delete(repo, 'bob', KEY, ref)
    expect(fs.existsSync(path.join(repo, FILE))).toBe(false)
  })

  it('composant en lecture seule : lecture possible, écriture d\'équipe refusée, personnelle acceptée', async () => {
    await service.create(repo, 'bob', KEY, 'team', 'Revue', settings)
    const before = fs.readFileSync(path.join(repo, FILE), 'utf-8')
    readonly = true
    const list = await service.list(repo, 'bob', KEY)
    expect(list.teamReadonly).toBe(true)
    expect(list.team).toHaveLength(1)
    expect(await code(service.create(repo, 'bob', KEY, 'team', 'Autre', settings))).toBe('READONLY_REPO')
    expect(await code(service.delete(repo, 'bob', KEY, { scope: 'team', name: 'Revue' }))).toBe('READONLY_REPO')
    expect(await code(service.create(repo, 'bob', KEY, 'personal', 'Moi', settings))).toBe('ok')
    expect(fs.readFileSync(path.join(repo, FILE), 'utf-8')).toBe(before)
  })

  it.each([
    ['YAML invalide', '<<<<<<< HEAD\nviews: [\n', 'unreadable'],
    ['structure inattendue', 'version: 1\nviews: [{ name: 3 }]\n', 'unreadable'],
    ['version absente', 'views: []\n', 'unreadable'],
    ['format plus récent', 'version: 2\nviews: []\n', 'newer-format'],
  ])('fichier inexploitable (%s) : signalé, écriture refusée, fichier intact', async (_label, text, error) => {
    writeTeamText(text)
    const list = await service.list(repo, 'bob', KEY)
    expect(list.teamError).toBe(error)
    expect(list.team).toEqual([])
    expect(await code(service.create(repo, 'bob', KEY, 'team', 'A', settings))).toBe('VIEWS_UNREADABLE')
    expect(await code(service.create(repo, 'bob', KEY, 'personal', 'A', settings))).toBe('ok')
    expect(fs.readFileSync(path.join(repo, FILE), 'utf-8')).toBe(text)
  })
})

describe('écritures', () => {
  it.each([null, [], 'x'])('refuse des réglages invalides (%j), le fichier reste lisible', async bad => {
    const ref = await service.create(repo, 'bob', KEY, 'team', 'A', settings)
    expect(await code(service.create(repo, 'bob', KEY, 'team', 'B', bad as never))).toBe('VIEW_SETTINGS_INVALID')
    expect(await code(service.update(repo, 'bob', KEY, ref, bad as never))).toBe('VIEW_SETTINGS_INVALID')
    expect((await service.list(repo, 'bob', KEY)).teamError).toBeUndefined()
  })

  it('créations simultanées dans le fichier d\'équipe : aucune n\'est perdue', async () => {
    await Promise.all(['A', 'B', 'C', 'D'].map(n => service.create(repo, 'bob', KEY, 'team', n, settings)))
    expect(teamYaml().views.map(v => v.name).sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('le fichier d\'équipe n\'est pas modifiable depuis la vue de diff', () => {
    expect(isAppMaintainedFile('.polenta/views/root/exigence.yaml')).toBe(true)
  })
})

describe('règles de nom', () => {
  it.each(['', '   ', 'x'.repeat(81)])('refuse un nom invalide (%j)', async name => {
    expect(await code(service.create(repo, 'bob', KEY, 'personal', name, settings))).toBe('VIEW_NAME_INVALID')
  })

  it('accepte 80 caractères', async () => {
    expect(await code(service.create(repo, 'bob', KEY, 'personal', 'x'.repeat(80), settings))).toBe('ok')
  })

  it('refuse un doublon par portée, sans tenir compte de la casse ni des espaces', async () => {
    await service.create(repo, 'bob', KEY, 'team', 'Revue', settings)
    expect(await code(service.create(repo, 'bob', KEY, 'team', ' REVUE ', settings))).toBe('VIEW_NAME_TAKEN')
    expect(await code(service.create(repo, 'bob', KEY, 'personal', 'Revue', settings))).toBe('ok')
  })

  it('renommer : doublon refusé, changement de casse de la même vue accepté', async () => {
    const a = await service.create(repo, 'bob', KEY, 'personal', 'A', settings)
    await service.create(repo, 'bob', KEY, 'personal', 'B', settings)
    expect(await code(service.rename(repo, 'bob', KEY, a, 'b'))).toBe('VIEW_NAME_TAKEN')
    expect(await service.rename(repo, 'bob', KEY, a, 'a')).toEqual({ scope: 'personal', name: 'a' })
  })

  it('vue absente : VIEW_NOT_FOUND', async () => {
    expect(await code(service.delete(repo, 'bob', KEY, { scope: 'personal', name: 'X' }))).toBe('VIEW_NOT_FOUND')
    expect(await code(service.update(repo, 'bob', KEY, { scope: 'team', name: 'X' }, settings))).toBe('VIEW_NOT_FOUND')
  })
})

describe('clé de type', () => {
  it.each(['../../etc::x', 'root::../../x', 'root', 'a::b::c', 'root::a/b', 'root::a\\b', '..::x', '::x'])('refuse %s, rien hors de .polenta/views', async key => {
    expect(await code(service.create(repo, 'bob', key, 'team', 'A', settings))).toBe('VIEW_TYPE_INVALID')
    expect(await code(service.list(repo, 'bob', key))).toBe('VIEW_TYPE_INVALID')
    expect(fs.existsSync(path.join(repo, '.polenta'))).toBe(false)
  })

  it('portée inconnue refusée', async () => {
    expect(await code(service.create(repo, 'bob', KEY, 'autre' as 'team', 'A', settings))).toBe('VIEW_SCOPE_INVALID')
  })
})

describe('renommages', () => {
  it('champ : excel, word, popup migrés (échange compris), autres clés intactes', async () => {
    await service.create(repo, 'bob', KEY, 'team', 'A', {
      excel: ['id', 'a', 'b'], word: ['b'], popup: ['a'], picker: ['a'], freezeColCountExcel: 2,
    })
    await renameFieldsInTeamViews(repo, KEY, [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])
    expect(teamYaml().views[0].settings).toEqual({
      excel: ['id', 'b', 'a'], word: ['a'], popup: ['b'], picker: ['a'], freezeColCountExcel: 2,
    })
  })

  it('champ : sans fichier ni colonne concernée, rien n\'est écrit', async () => {
    await renameFieldsInTeamViews(repo, KEY, [{ from: 'a', to: 'b' }])
    expect(fs.existsSync(path.join(repo, FILE))).toBe(false)
    writeTeamText('version: 1\nviews:\n  - {name: A, settings: {excel: [id]}}\n')
    await renameFieldsInTeamViews(repo, KEY, [{ from: 'a', to: 'b' }])
    expect(fs.readFileSync(path.join(repo, FILE), 'utf-8')).toContain('{name: A')
  })

  it('champ : fichier illisible signalé, jamais réécrit', async () => {
    writeTeamText('<<<<<<< HEAD\n')
    await expect(renameFieldsInTeamViews(repo, KEY, [{ from: 'a', to: 'b' }])).rejects.toThrow('VIEWS_UNREADABLE')
    expect(fs.readFileSync(path.join(repo, FILE), 'utf-8')).toBe('<<<<<<< HEAD\n')
  })

  it('type : le fichier suit ; sans fichier, sans effet', async () => {
    await service.create(repo, 'bob', KEY, 'team', 'A', settings)
    await moveTeamViewsFile(repo, { node: 'root', type: 'exigence' }, { node: 'root', type: 'besoin' })
    expect(fs.existsSync(path.join(repo, FILE))).toBe(false)
    expect((await service.list(repo, 'bob', 'root::besoin')).team.map(v => v.name)).toEqual(['A'])
    await expect(moveTeamViewsFile(repo, { node: 'root', type: 'absent' }, { node: 'root', type: 'autre' })).resolves.toBeUndefined()
  })

  it('déplacement vers un autre nœud : le fichier suit', async () => {
    await service.create(repo, 'bob', KEY, 'team', 'A', settings)
    await moveTeamViewsFile(repo, { node: 'root', type: 'exigence' }, { node: 'bms', type: 'exigence' })
    expect((await service.list(repo, 'bob', KEY)).team).toEqual([])
    expect((await service.list(repo, 'bob', 'bms::exigence')).team.map(v => v.name)).toEqual(['A'])
  })

  it('fichier déjà présent à l\'arrivée : refusé, aucun des deux n\'est touché', async () => {
    await service.create(repo, 'bob', KEY, 'team', 'A', settings)
    await service.create(repo, 'bob', 'root::besoin', 'team', 'B', settings)
    await expect(moveTeamViewsFile(repo, { node: 'root', type: 'exigence' }, { node: 'root', type: 'besoin' })).rejects.toThrow('VIEWS_TARGET_EXISTS')
    expect((await service.list(repo, 'bob', KEY)).team.map(v => v.name)).toEqual(['A'])
    expect((await service.list(repo, 'bob', 'root::besoin')).team.map(v => v.name)).toEqual(['B'])
  })
})
