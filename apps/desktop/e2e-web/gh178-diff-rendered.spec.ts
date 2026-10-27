import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH178 sprint 1 — vues de diff en mode Rendu (specs/GH178-tests.md) : bascule Raw / Rendu,
 * grille Avant | Après, unités modifiées marquées, `history` masqué, fichier ajouté, fichier sans
 * Rendu, mémorisation du mode, aucune écriture à l'affichage.
 *
 * Fixture : une exigence créée et commitée (c1), puis titre et statut modifiés et commités (c2),
 * puis titre modifié sans commit (working tree).
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface TypeLike { name: string; category: string; statuses?: Array<{ name: string; label?: string }> }
interface NodeLike { name: string; objectTypes?: TypeLike[]; children?: NodeLike[] }
interface StatusLike { staged: Array<{ path: string }>; unstaged: Array<{ path: string }> }

let reqId = ''
let reqFile = ''
let otherFile = ''
let c1 = ''
let c2 = ''
let fromLabel = ''
let toLabel = ''

async function commit(message: string): Promise<string> {
  const { localPath } = s.project
  await s.invoke('sync:stage-all', localPath)
  await s.invoke('sync:commit', localPath, message)
  return s.invoke<string>('git:head-sha', localPath)
}

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  const schema = await s.invoke<{ nodes: NodeLike[] }>('schema:get', localPath)
  const type = schema.nodes.flatMap(n => n.objectTypes ?? []).find(t => t.category === 'requirement' && (t.statuses?.length ?? 0) >= 2)!
  const [from, to] = type.statuses!
  fromLabel = from.label ?? from.name
  toLabel = to.label ?? to.name

  reqId = (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: `root::${type.name}`, title: 'GH178 avant' }, workspaceDir)).id
  if (from.name !== 'draft') await s.invoke('requirements:transition', localPath, reqId, { toStatus: from.name }, workspaceDir)
  c1 = await commit('GH178 c1')
  const files = await s.invoke<Array<{ path: string }>>('sync:commit-files', localPath, c1)
  reqFile = files.find(f => f.path.endsWith(`${reqId}.yaml`))!.path
  otherFile = files.find(f => f.path !== reqFile && !f.path.endsWith('.yaml'))?.path ?? files.find(f => f.path !== reqFile)!.path

  await s.invoke('requirements:update', localPath, reqId, { title: 'GH178 après' }, workspaceDir)
  await s.invoke('requirements:transition', localPath, reqId, { toStatus: to.name }, workspaceDir)
  c2 = await commit('GH178 c2')

  await s.invoke('requirements:update', localPath, reqId, { title: 'GH178 local' }, workspaceDir)
})

async function goto(url: string) {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await s.page.waitForLoadState('networkidle')
}

const commitDiff = (sha: string, filepath: string) =>
  goto(s.projectUrl('/diff', { repoPath: s.project.localPath, filepath, commitSha: sha }))
const grid = () => s.page.getByTestId('object-diff')
const toggle = () => s.page.getByTestId('diff-mode-toggle')
const unit = (key: string) => grid().locator(`[data-unit="${key}"]`)

test('G7/G1 — commit du graphe : Rendu par défaut, Avant = parent, unités modifiées marquées, history masqué', async () => {
  await commitDiff(c2, reqFile)
  await expect(toggle()).toBeVisible()
  await expect(grid()).toBeVisible()
  await expect(grid()).toContainText(`Avant · ${c1.slice(0, 7)}`)
  await expect(grid()).toContainText(`Après · ${c2.slice(0, 7)}`)

  await expect(unit('title')).toHaveAttribute('data-changed', 'true')
  await expect(unit('status')).toHaveAttribute('data-changed', 'true')
  await expect(grid()).toContainText('GH178 avant')
  await expect(grid()).toContainText('GH178 après')
  await expect(grid()).toContainText(fromLabel)
  await expect(grid()).toContainText(toLabel)
  await expect(unit('history')).toHaveCount(0)
  await expect(unit('id')).toHaveCount(0)
  await s.shot('gh178-rendered')
})

test('L8 — « Masquer les inchangés » replie les unités inchangées', async () => {
  await commitDiff(c2, reqFile)
  await s.page.getByLabel('Masquer les inchangés').check()
  await expect(unit('title')).toBeVisible()
  await expect(grid().getByRole('button', { name: /inchangé/ }).first()).toBeVisible()
  await s.page.getByLabel('Masquer les inchangés').uncheck()
  await expect(grid().getByRole('button', { name: /inchangé/ })).toHaveCount(0)
})

test('G2/G3 — bascule Raw : diff texte ; le mode est mémorisé', async () => {
  await commitDiff(c2, reqFile)
  await toggle().getByRole('button', { name: 'Raw' }).click()
  await expect(grid()).toHaveCount(0)
  await expect(s.page.locator('table tr').filter({ hasText: 'title: GH178 après' })).toHaveCount(1)

  await commitDiff(c1, reqFile)
  await expect(toggle().getByRole('button', { name: 'Raw' })).toHaveAttribute('aria-pressed', 'true')
  await toggle().getByRole('button', { name: 'Rendu' }).click()
  await expect(grid()).toBeVisible()
})

test('L2 — fichier ajouté : colonne Avant « Fichier absent de cette version »', async () => {
  await commitDiff(c1, reqFile)
  await expect(grid()).toContainText('Fichier absent de cette version')
  await expect(unit('title')).toHaveAttribute('data-changed', 'true')
})

test('L1 — fichier sans Rendu : pas de bascule, diff Raw', async () => {
  await commitDiff(c1, otherFile)
  await expect(s.page.locator('table').first()).toBeVisible()
  await expect(toggle()).toHaveCount(0)
})

test('G6 — modification locale : Avant = HEAD, Après = working tree', async () => {
  await goto(s.projectUrl('/diff', { repoPath: s.project.localPath, filepath: reqFile }))
  await expect(grid()).toContainText(`Avant · ${c2.slice(0, 7)}`)
  await expect(grid()).toContainText('Après · working tree')
  await expect(grid()).toContainText('GH178 local')
  await expect(unit('title')).toHaveAttribute('data-changed', 'true')
  await expect(unit('status')).not.toHaveAttribute('data-changed', 'true')
})

test('L15 — aucune écriture à l\'affichage des diffs', async () => {
  const { localPath } = s.project
  const before = await s.invoke<StatusLike>('sync:status', localPath)
  await commitDiff(c2, reqFile)
  await expect(grid()).toBeVisible()
  await goto(s.projectUrl('/diff', { repoPath: localPath, filepath: reqFile }))
  await expect(grid()).toBeVisible()
  const after = await s.invoke<StatusLike>('sync:status', localPath)
  expect(after).toEqual(before)
})
