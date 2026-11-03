import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { setupSession } from './support/session'

/**
 * GH203 — vues enregistrées nommées du ⚙️ : deux portées, application, mention « modifiée »,
 * renommage, suppression, colonnes par défaut. Deux types dédiés : une exigence et une issue, dont
 * les vues passent par le même `SystemView`.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }
interface Pref { excel?: string[]; word?: string[]; popup?: string[]; picker?: string[]; collapsedFoldersExcel?: string[]; activeView?: { scope: string; name: string } | null; savedViews?: Array<{ name: string }> }
interface Sync { staged: Array<{ path: string }>; unstaged: Array<{ path: string }> }

const REQ = { name: 'gh203_exigence', label: 'GH203 Exigence', ref: 'root::gh203_exigence' }
const ISSUE = { name: 'gh203_issue', label: 'GH203 Issue', ref: 'root::gh203_issue' }
const fields = (category: string) => [
  { name: 'alpha', label: `Alpha ${category}`, type: 'text', defaultVisible: true },
  { name: 'beta', label: `Beta ${category}`, type: 'text' },
]
const statuses = [{ name: 'open', label: 'Ouvert' }, { name: 'closed', label: 'Fermé', isTerminal: true }]

let username = ''
let reqId = ''

const repo = () => s.project.localPath
const teamRel = (type: string) => `.polenta/views/root/${type}.yaml`
const teamPath = (type: string) => path.join(repo(), ...teamRel(type).split('/'))
const getPref = (ref = REQ.ref) => s.invoke<Pref | null>('pref:get-field-visibility', repo(), username, ref)
const syncPaths = async () => {
  const st = await s.invoke<Sync>('sync:status', repo())
  return [...st.staged, ...st.unstaged].map(f => f.path)
}
const header = (label: string) => s.page.locator('th').filter({ hasText: label })
const label = () => s.page.getByTestId('saved-views-label')
const modifiedMark = () => s.page.getByTestId('saved-views-modified')
const openMenu = () => s.page.getByTestId('saved-views-button').click()
const panel = () => s.page.getByTestId('field-config-panel')

async function openTable(view: string, typeLabel: string) {
  await s.openView(view)
  const combo = s.page.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(typeLabel)
  await combo.press('Enter')
  await s.page.getByTitle('Vue tableau').click()
  await s.page.waitForLoadState('networkidle')
}

async function saveAs(name: string, scope: 'personal' | 'team' = 'personal') {
  await openMenu()
  await s.page.getByTestId('saved-views-save-as').click()
  await s.page.getByTestId('saved-view-name').fill(name)
  await s.page.getByTestId(`saved-view-scope-${scope}`).check()
  await s.page.getByTestId('saved-view-confirm').click()
  await expect(s.page.getByTestId('saved-view-dialog')).toHaveCount(0)
  await expect(label()).toHaveText(name)
}

async function choose(scope: 'personal' | 'team', name: string) {
  await openMenu()
  await s.page.getByTestId(`saved-view-${scope}-${name}`).click()
  await expect(label()).toHaveText(name)
}

async function toggleColumn(field: string) {
  await s.page.getByTitle('Configurer les colonnes').click()
  await panel().getByTestId(`field-config-field-${field}`).click()
  await s.page.locator('.fixed.inset-0.z-50').click({ position: { x: 5, y: 5 } })
  await expect(panel()).toHaveCount(0)
}

async function deleteActive() {
  await openMenu()
  await s.page.getByTestId('saved-views-delete').click()
  await s.page.getByTestId('saved-view-delete-confirm').click()
  await expect(s.page.getByTestId('saved-view-delete-dialog')).toHaveCount(0)
}

test.beforeAll(async () => {
  const localPath = repo()
  username = await s.invoke<string>('auth:project-username', localPath)
  await s.invoke('schema:invalidate', localPath)
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []),
    { name: REQ.name, label: REQ.label, prefix: 'GVR', category: 'requirement', fields: fields('req') },
    { name: ISSUE.name, label: ISSUE.label, prefix: 'GVI', category: 'issue', fields: fields('iss'), statuses },
  ]
  await s.invoke('schema:save', localPath, schema)
  reqId = (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: REQ.ref, title: 'GH203 A' })).id
})

test('GH203-1 — vue personnelle : enregistrée dans le .pref, rien dans le statut git', async () => {
  await openTable('Exigences', REQ.label)
  await expect(s.page.locator('tr').filter({ hasText: reqId }).first()).toBeVisible()
  await expect(label()).toHaveText('Vues')
  await saveAs('Perso A')
  const pref = await getPref()
  expect(pref?.savedViews?.map(v => v.name)).toEqual(['Perso A'])
  expect(pref?.activeView).toEqual({ scope: 'personal', name: 'Perso A' })
  expect((await syncPaths()).filter(p => p.includes('views'))).toEqual([])
  await s.shot('gh203-personal')
})

test('GH203-2 — aller-retour entre deux vues : colonnes, ordre, Document, Popup, dossiers, colonnes figées', async () => {
  await openTable('Exigences', REQ.label)
  const a = { excel: ['status', 'id', 'name', 'beta'], word: ['name', 'beta'], popup: ['beta'], showFoldersExcel: false, showFoldersWord: false, freezeColCountExcel: 2 }
  const b = { excel: ['id', 'alpha'], word: ['name'], popup: [], showFoldersExcel: true, showFoldersWord: true, freezeColCountExcel: 0 }
  await s.invoke('views:create', repo(), username, REQ.ref, 'personal', 'Vue RT A', a, null)
  await s.invoke('views:create', repo(), username, REQ.ref, 'personal', 'Vue RT B', b, null)
  await s.page.reload()
  await openTable('Exigences', REQ.label)

  await choose('personal', 'Vue RT A')
  await expect(header('Beta req')).toHaveCount(1)
  await expect(header('Alpha req')).toHaveCount(0)
  const headers = async () => (await s.page.locator('th').allTextContents()).map(t => t.trim()).filter(Boolean)
  const expected = await headers()
  expect(expected.at(-1)).toContain('Beta req')
  await expect.poll(async () => (await getPref())?.excel).toEqual(a.excel)

  await choose('personal', 'Vue RT B')
  await expect(header('Alpha req')).toHaveCount(1)
  await expect(header('Beta req')).toHaveCount(0)
  await expect.poll(getPref).toMatchObject({ excel: b.excel, word: b.word, popup: b.popup, showFoldersExcel: true, showFoldersWord: true, freezeColCountExcel: 0 })

  await choose('personal', 'Vue RT A')
  await expect(modifiedMark()).toHaveCount(0)
  await expect.poll(getPref).toMatchObject(a)
  expect(await headers()).toEqual(expected)
})

test('GH203-3 — « modifiée » sans écrire, Enregistrer, retour manuel', async () => {
  await openTable('Exigences', REQ.label)
  await s.invoke('views:create', repo(), username, REQ.ref, 'personal', 'Vue Modif', { excel: ['id', 'name'], word: ['name'] }, null)
  await s.page.reload()
  await openTable('Exigences', REQ.label)
  await choose('personal', 'Vue Modif')
  await expect(modifiedMark()).toHaveCount(0)

  await toggleColumn('status')
  await expect(modifiedMark()).toBeVisible()
  const stored = async () => (await s.invoke<{ personal: Array<{ name: string; settings: { excel: string[] } }> }>('views:list', repo(), username, REQ.ref, null)).personal.find(v => v.name === 'Vue Modif')!.settings.excel
  expect(await stored()).toEqual(['id', 'name'])

  await toggleColumn('status')
  await expect(modifiedMark()).toHaveCount(0)   // retour manuel à l'état de la vue

  await toggleColumn('status')
  await expect(modifiedMark()).toBeVisible()
  await openMenu()
  await s.page.getByTestId('saved-views-save').click()
  await expect(modifiedMark()).toHaveCount(0)
  await expect.poll(stored).toContain('status')
  await s.page.mouse.click(5, 5)
})

test('GH203-4 — vue d\'équipe : fichier du repo, présent dans le statut git, autre utilisateur', async () => {
  await openTable('Exigences', REQ.label)
  await saveAs('Revue équipe', 'team')
  expect(fs.existsSync(teamPath(REQ.name))).toBe(true)
  await expect.poll(syncPaths).toContain(teamRel(REQ.name))
  const other = await s.invoke<{ team: Array<{ name: string }>; personal: unknown[] }>('views:list', repo(), 'autre-utilisateur', REQ.ref, null)
  expect(other.team.map(v => v.name)).toEqual(['Revue équipe'])
  expect(other.personal).toEqual([])
  await s.shot('gh203-team')
})

test('GH203-5 — vue d\'équipe changée sur disque : écran inchangé, « modifiée », resélection applique', async () => {
  await openTable('Exigences', REQ.label)
  await choose('team', 'Revue équipe')
  await expect(modifiedMark()).toHaveCount(0)
  await expect(header('Beta req')).toHaveCount(0)
  await s.invoke('views:update', repo(), 'autre-utilisateur', REQ.ref, { scope: 'team', name: 'Revue équipe' }, { excel: ['id', 'beta'], word: ['name'] }, null)
  await expect(modifiedMark()).toBeVisible()   // relue par le watcher (useLiveFileSync), sans recharger
  await expect(header('Beta req')).toHaveCount(0)   // pas d'application d'office
  await choose('team', 'Revue équipe')
  await expect(header('Beta req')).toHaveCount(1)
  await expect(modifiedMark()).toHaveCount(0)
})

test('GH203-6 — renommer, doublon refusé, supprimer ; dernière vue d\'équipe : fichier retiré', async () => {
  await openTable('Exigences', REQ.label)
  await choose('team', 'Revue équipe')

  await openMenu()
  await s.page.getByTestId('saved-views-rename').click()
  await s.page.getByTestId('saved-view-name').fill('Revue sûreté')
  await s.page.getByTestId('saved-view-confirm').click()
  await expect(label()).toHaveText('Revue sûreté')
  await expect.poll(async () => (await getPref())?.activeView).toEqual({ scope: 'team', name: 'Revue sûreté' })

  await openMenu()
  await s.page.getByTestId('saved-views-save-as').click()
  await s.page.getByTestId('saved-view-name').fill('REVUE SÛRETÉ')
  await s.page.getByTestId('saved-view-scope-team').check()
  await s.page.getByTestId('saved-view-confirm').click()
  await expect(s.page.getByTestId('saved-view-dialog-error')).toContainText('existe déjà')
  await s.page.keyboard.press('Escape')
  await expect(s.page.getByTestId('saved-view-dialog')).toHaveCount(0)

  await deleteActive()
  await expect(label()).toHaveText('Vues')
  expect(fs.existsSync(teamPath(REQ.name))).toBe(false)

  await choose('personal', 'Perso A')
  await deleteActive()
  await expect(label()).toHaveText('Vues')
  await expect.poll(async () => (await getPref())?.savedViews?.map(v => v.name)).not.toContain('Perso A')
})

test('GH203-6b — un nom avec « : » ou « .. » est accepté sur le web, en création et en renommage', async () => {
  await openTable('Exigences', REQ.label)
  await saveAs('A: revue ../sûreté')
  await openMenu()
  await s.page.getByTestId('saved-views-rename').click()
  await s.page.getByTestId('saved-view-name').fill('B: revue ../sécurité')
  await s.page.getByTestId('saved-view-confirm').click()
  await expect(label()).toHaveText('B: revue ../sécurité')
  await deleteActive()
  await expect(label()).toHaveText('Vues')
})

test('GH203-7 et 8 — Colonnes par défaut ; picker et dossiers repliés intacts', async () => {
  await s.invoke('pref:set-field-visibility', repo(), username, REQ.ref, { picker: ['id', 'status'], collapsedFoldersExcel: ['dossier-x'] })
  await openTable('Exigences', REQ.label)
  await choose('personal', 'Vue RT A')
  await expect.poll(getPref).toMatchObject({ picker: ['id', 'status'], collapsedFoldersExcel: ['dossier-x'] })

  await openMenu()
  await s.page.getByTestId('saved-views-defaults').click()
  await expect(label()).toHaveText('Vues')
  await expect(header('Alpha req')).toHaveCount(1)   // defaultVisible du schéma
  await expect(header('Beta req')).toHaveCount(0)
  await expect.poll(getPref).toMatchObject({ picker: ['id', 'status'], collapsedFoldersExcel: ['dossier-x'] })
  const pref = await getPref()
  expect(pref?.excel).toBeUndefined()
  expect(pref?.activeView ?? null).toBeNull()
  expect(pref?.savedViews?.map(v => v.name)).toContain('Vue RT A')
})

test('GH203-9 — colonne invalide : ignorée sans erreur, fichier intact', async () => {
  const text = 'version: 1\nviews:\n  - name: Invalide\n    settings:\n      excel: [id, champ_disparu, beta]\n      word: [name]\n'
  fs.mkdirSync(path.dirname(teamPath(REQ.name)), { recursive: true })
  fs.writeFileSync(teamPath(REQ.name), text)
  await openTable('Exigences', REQ.label)
  await choose('team', 'Invalide')
  await expect(header('Beta req')).toHaveCount(1)
  await expect(s.page.locator('tr').filter({ hasText: reqId }).first()).toBeVisible()
  expect(fs.readFileSync(teamPath(REQ.name), 'utf-8')).toBe(text)
})

test('GH203-10 — vue active supprimée sur disque : oubliée sans message, réglages gardés', async () => {
  await openTable('Exigences', REQ.label)
  await choose('team', 'Invalide')
  fs.rmSync(teamPath(REQ.name))
  await s.page.reload()
  await openTable('Exigences', REQ.label)
  await expect(label()).toHaveText('Vues')
  await expect(header('Beta req')).toHaveCount(1)
  await expect.poll(async () => (await getPref())?.activeView ?? null).toBeNull()
})

test('GH203-11 — fichier d\'équipe illisible : avertissement, vue utilisable, fichier intact', async () => {
  const text = '<<<<<<< HEAD\nviews: [\n'
  fs.mkdirSync(path.dirname(teamPath(REQ.name)), { recursive: true })
  fs.writeFileSync(teamPath(REQ.name), text)
  await openTable('Exigences', REQ.label)
  await expect(s.page.locator('tr').filter({ hasText: reqId }).first()).toBeVisible()
  await openMenu()
  await expect(s.page.getByTestId('saved-views-team-error')).toBeVisible()
  await s.page.getByTestId('saved-views-save-as').click()
  await expect(s.page.getByTestId('saved-view-scope-team')).toBeDisabled()
  await s.page.keyboard.press('Escape')
  expect(fs.readFileSync(teamPath(REQ.name), 'utf-8')).toBe(text)
  fs.rmSync(teamPath(REQ.name))
})

test('GH203-12 — type issue : vues personnelle et d\'équipe', async () => {
  await openTable('Issues', ISSUE.label)
  await expect(label()).toHaveText('Vues')
  await saveAs('Perso issue')
  expect((await getPref(ISSUE.ref))?.savedViews?.map(v => v.name)).toEqual(['Perso issue'])
  await toggleColumn('beta')
  await expect(modifiedMark()).toBeVisible()
  await expect(header('Beta iss')).toHaveCount(1)
  await saveAs('Équipe issue', 'team')
  await expect.poll(syncPaths).toContain(teamRel(ISSUE.name))
  await choose('personal', 'Perso issue')
  await expect(header('Beta iss')).toHaveCount(0)
  await s.shot('gh203-issue')
})

test('GH203-13 — type campagne : pas de liste', async () => {
  await openTable('Exigences', REQ.label)
  await expect(s.page.getByTestId('saved-views-button')).toBeVisible()
  await s.openView('Campagnes')
  await expect(s.page.getByTitle('Configurer les colonnes')).toHaveCount(0)
  await expect(s.page.getByTestId('saved-views-button')).toHaveCount(0)
})
