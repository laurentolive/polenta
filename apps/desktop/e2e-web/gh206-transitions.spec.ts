import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH206 — contraintes de transition à niveaux (specs/GH206-tests.md, I1 à I4) : règle ajoutée et réglée
 * dans l'éditeur de schéma, option de statut bloquée (désactivée, motif) ou notifiée (passage fait,
 * notification sans confirmation) dans la vue document. Un type dédié (préfixe GHX) est créé par le test.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 400/, /status of 422/, /status of 500/, /TRANSITION_BLOCKED/))

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: unknown[]; transitions?: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }

const TYPE_NAME = 'gh206_req'
const TYPE_LABEL = 'GH206 Transitions'
let reqId = ''

const schema = () => s.invoke<SchemaLike>('schema:get', s.project.localPath)
const ourType = async () => (await schema()).nodes.find(n => n.name === 'root')!.objectTypes!.find(t => t.name === TYPE_NAME)!
const getReq = (id: string) => s.invoke<{ status: string }>('requirements:get', s.project.localPath, id)

async function setTransitions(transitions: unknown[] | undefined) {
  const current = await schema()
  const type = current.nodes.find(n => n.name === 'root')!.objectTypes!.find(t => t.name === TYPE_NAME)!
  if (transitions) type.transitions = transitions
  else delete type.transitions
  await s.invoke('schema:save', s.project.localPath, current)
}

async function navigate(url: string) {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await s.page.waitForLoadState('networkidle')
}

async function openElementModal() {
  await navigate(s.projectUrl('/schema', { repoPath: s.project.localPath }))
  await s.page.getByRole('button', { name: new RegExp(TYPE_LABEL) }).first().click()
  await expect(s.page.getByTestId('transition-rules')).toBeVisible()
}

/** Menu de statut de l'exigence dans la vue document (pré-contrôle chargé au focus). */
async function statusMenu() {
  const p = s.page
  await s.openView('Exigences')
  const combo = p.locator('input.input-field.cursor-pointer').first()
  await combo.click()
  await combo.fill(TYPE_LABEL)
  await combo.press('Enter')
  await p.getByTitle('Vue document').click()
  await p.waitForLoadState('networkidle')
  const header = p.locator('span.font-mono', { hasText: new RegExp(`^${reqId}$`) }).locator('xpath=..')
  const select = header.getByTitle('Changer le statut')
  await select.focus()
  return select
}

test.beforeAll(async () => {
  const { localPath } = s.project
  await s.invoke('schema:invalidate', localPath)
  const current = await schema()
  const root = current.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []), {
    name: TYPE_NAME, label: TYPE_LABEL, prefix: 'GHX', category: 'requirement', fields: [],
    statuses: [{ name: 'draft', label: 'Brouillon' }, { name: 'approved', label: 'Approuvé', isApproval: true }],
  }]
  await s.invoke('schema:save', localPath, current)
  reqId = (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: `root::${TYPE_NAME}`, title: 'GH206 non couverte' })).id
})

test('GH206-I1/I2 — éditeur : règle ajoutée en Notification, réglée en Blocage, puis retirée en un clic', async () => {
  const p = s.page
  await openElementModal()
  await p.getByTestId('transition-add').click()
  // Ajout : statut approuvé visé, première condition en Notification.
  await expect(p.getByTestId('transition-level-0-fieldsFilled-warn')).toHaveAttribute('aria-checked', 'true')
  await p.getByTestId('transition-level-0-fieldsFilled-off').click()
  await p.getByTestId('transition-level-0-hasCoverageLink-block').click()
  await p.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(p.getByTestId('transition-rules')).toBeHidden()
  expect((await ourType()).transitions).toEqual([{ to: 'approved', requires: { fieldsFilled: 'off', hasCoverageLink: 'block' } }])

  await openElementModal()
  await p.getByTestId('transition-remove-0').click()
  await expect(p.getByTestId('transition-rule-0')).toHaveCount(0)
  await p.getByRole('button', { name: 'Enregistrer', exact: true }).click()
  await expect(p.getByTestId('transition-rules')).toBeHidden()
  expect((await ourType()).transitions).toBeUndefined()
})

test('GH206-I3 — Blocage : « Approuvé » visible, désactivé, avec son motif ; statut inchangé', async () => {
  await setTransitions([{ to: 'approved', requires: { hasCoverageLink: 'block' } }])
  const select = await statusMenu()
  const option = select.locator('option[value="approved"]')
  await expect(option).toBeDisabled()
  await expect(option).toContainText('Aucun test ne couvre')
  expect((await getReq(reqId)).status).toBe('draft')
})

test('GH206-I4 — Notification : passage fait, motif notifié sans confirmation', async () => {
  await setTransitions([{ to: 'approved', requires: { hasCoverageLink: 'warn' } }])
  const select = await statusMenu()
  const option = select.locator('option[value="approved"]')
  await expect(option).toBeEnabled()
  await expect(option).toContainText('⚠')
  await select.selectOption('approved')
  await expect(s.page.getByTestId('transition-notice-warning')).toContainText('Aucun test ne couvre')
  await expect.poll(async () => (await getReq(reqId)).status).toBe('approved')
})
