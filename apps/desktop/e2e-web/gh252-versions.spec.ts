import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'
import { typeOfCategory } from './support/demo-types'

/**
 * GH252 — versions, analyse d'impact et validation sur le client web (specs/GH252-tests.md, U1 à U8).
 * Sans `allowConsoleErrors` : un canal encore masqué répondrait 404 et ferait échouer le test.
 * Le push vise un dépôt nu propre à ce fichier : le repo de démo de la forge est partagé entre les specs.
 */
const s = setupSession()

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: unknown[]; decisions?: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }
interface PageLike { validation: { id: string }; rows: Array<{ requirementId: string }> }

const REQ_LABEL = 'GH252 Exigence'
let versionId = ''
let reqA = ''
let reqB = ''
let testId = ''

const repo = () => s.project.localPath
const ws = () => s.project.workspaceDir
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo(), encoding: 'utf8' })
const commit = async (message: string) => {
  await s.invoke('sync:stage-all', repo())
  await s.invoke('sync:commit', repo(), message)
}

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}
const openVersion = () => navigate(s.page, s.projectUrl(`/version/${versionId}`, { repoPath: repo() }))

test.beforeAll(async () => {
  await s.invoke('schema:invalidate', repo())
  const schema = await s.invoke<SchemaLike>('schema:get', repo())
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []),
    { name: 'gh252_req', label: REQ_LABEL, prefix: 'GHV', category: 'requirement', fields: [], statuses: [{ name: 'draft', label: 'Brouillon' }, { name: 'approved', label: 'Approuvé', isApproval: true }] },
    { name: 'gh252_test', label: 'GH252 Test', prefix: 'GHT', category: 'test', fields: [], statuses: [{ name: 'draft', label: 'Brouillon' }] },
    { name: 'gh252_issue', label: 'GH252 Issue', prefix: 'GHI', category: 'issue', fields: [], statuses: [{ name: 'ouverte', label: 'Ouverte' }] },
  ]
  typeOfCategory(root, 'version', { name: 'gh252_version', label: 'Version', prefix: 'GHP', category: 'version', fields: [], statuses: [{ name: 'en_cours', label: 'En cours' }, { name: 'released', label: 'Released', isApproval: true }, { name: 'abandonnee', label: 'Abandonnée', isTerminal: true }] })
  typeOfCategory(root, 'validation', {
    name: 'gh252_validation', label: 'Validation', prefix: 'GHA', category: 'validation', fields: [],
    statuses: [{ name: 'en_cours', label: 'En cours' }, { name: 'signee', label: 'Signée', isApproval: true }, { name: 'annulee', label: 'Annulée', isTerminal: true }],
    decisions: [{ name: 'en_attente', label: 'En attente', isPending: true }, { name: 'conforme', label: 'Conforme' }, { name: 'non_conforme', label: 'Non conforme', proposesIssue: true }],
  })
  await s.invoke('schema:save', repo(), schema)
  reqA = (await s.invoke<{ id: string }>('requirements:create', repo(), { objectTypeRef: 'root::gh252_req', title: 'GH252 livrée', fields: {} }, ws())).id
  reqB = (await s.invoke<{ id: string }>('requirements:create', repo(), { objectTypeRef: 'root::gh252_req', title: 'GH252 autre', fields: {} }, ws())).id
  testId = (await s.invoke<{ id: string }>('tests:create', repo(), { objectTypeRef: 'root::gh252_test', title: 'GH252 test', fields: {}, steps: [] }, ws())).id
  await s.invoke('requirements:link-create', repo(), { type: 'verification', sourceId: testId, targetId: reqA }, ws())
  versionId = (await s.invoke<{ id: string }>('versions:create', repo(), { title: '9.9' }, ws())).id
  await s.invoke('versions:include', repo(), versionId, [reqA], ws())
  await commit('GH252 préparation')
})

test('U1, U2 — panneau Version, backlog, page d\'une version', async () => {
  const p = s.page
  await s.openView('Version')
  await p.getByRole('button', { name: 'Version produit', exact: true }).click()
  await expect(p.getByTestId('product-versions-panel')).toBeVisible()
  await expect(p.getByTestId('version-backlog')).toBeVisible()
  await p.getByTestId(`version-row-${versionId}`).click()
  await expect(p.getByTestId('version-page')).toBeVisible()
  await expect(p.getByTestId('version-page')).toContainText(reqA)
})

test('U3 — analyse d\'impact : statut et commentaire libre enregistrés', async () => {
  const analysis = await s.invoke<{ rows: unknown[] }>('versions:analysis', repo(), versionId, ws())
  expect(JSON.stringify(analysis.rows)).toContain(testId)
  await s.invoke('versions:set-impact', repo(), versionId, testId, 'pas_d_impact_reel', 'voir ../docs', ws())
  const page = await s.invoke<{ version: { impacted?: Array<{ id: string; status: string; comment?: string }> } }>('versions:get', repo(), versionId, ws())
  expect(page.version.impacted?.find(i => i.id === testId)).toMatchObject({ status: 'pas_d_impact_reel', comment: 'voir ../docs' })
  await commit('GH252 impact')
})

test('U4, U5 — passage released : tag en attente, poussé avec le repo', async () => {
  const p = s.page
  await openVersion()
  await p.getByTestId('version-release').click()
  await p.getByTestId('release-tag').fill('gh252-9.9')
  await p.getByTestId('release-confirm').click()
  await expect(p.getByTestId('version-tag-pending')).toBeVisible()
  expect(git('tag', '--list', 'gh252-9.9').trim()).toBe('gh252-9.9')

  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-gh252-bare-'))
  execFileSync('git', ['init', '--bare', bare])
  git('remote', 'set-url', 'origin', bare)
  await s.invoke('sync:push', repo())
  expect(execFileSync('git', ['tag', '--list'], { cwd: bare, encoding: 'utf8' })).toContain('gh252-9.9')
  await openVersion()
  await expect(p.getByTestId('version-page')).toBeVisible()
  await expect(p.getByTestId('version-tag-pending')).toHaveCount(0)
})

test('U6, U7 — validation : création, popup d\'issue, signature par le compte de la session', async () => {
  const p = s.page
  await s.openView('Validation')
  await p.getByTestId(`validation-create-${versionId}`).click()
  await p.getByTestId('new-validation-submit').click()
  await expect(p.getByTestId('validation-page')).toBeVisible()

  await p.getByTestId(`validation-decision-${reqB}`).selectOption('non_conforme')
  await expect(p.getByTestId('issue-proposal')).toBeVisible()
  await p.getByTestId('issue-proposal-submit').click()
  await expect(p.getByTestId('issue-proposal')).toHaveCount(0)
  await expect.poll(async () => JSON.stringify(await s.invoke('issues:list', repo()))).toContain(reqB)

  // Le périmètre couvre toutes les exigences du repo de démo : le reste est décidé par le canal.
  const id = /\/validation\/([^/?]+)/.exec(p.url())![1]
  const page = await s.invoke<PageLike>('validations:page', repo(), id, ws())
  for (const row of page.rows) {
    if (row.requirementId !== reqB) await s.invoke('validations:decide', repo(), id, { requirementId: row.requirementId, decision: 'conforme' }, ws())
  }
  await expect(p.getByTestId('validation-remaining')).toHaveText('0')
  await p.getByTestId('validation-sign').click()
  await p.getByTestId('validation-dialog-confirm').click()
  await expect(p.getByTestId('validation-state')).toHaveText('Signée')
  const author = git('log', '-1', '--format=%an').trim()
  const username = await s.invoke<string>('auth:project-username', repo())
  expect(author.toLowerCase()).toContain(username.toLowerCase())
})

test('U8 — colonne Design : le label de version ouvre sa page', async () => {
  const p = s.page
  const username = await s.invoke<string>('auth:project-username', repo())
  await s.invoke('pref:set-field-visibility', repo(), username, 'root::gh252_req', { excel: ['section', 'name', 'id', 'designStatus', 'validationStatus'] })
  await s.openView('Exigences')
  const combo = p.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(REQ_LABEL)
  await combo.press('Enter')
  await p.getByTitle('Vue tableau').click()
  await p.waitForLoadState('networkidle')
  const row = p.locator('tr').filter({ hasText: reqA })
  await expect(row.getByTestId('reflection-validationStatus')).toHaveText('Conforme (9.9)')
  await row.getByTestId('reflection-designStatus').getByRole('button', { name: '9.9' }).click()
  await expect(p).toHaveURL(new RegExp(`/version/${versionId}`))
})
