import { test, expect, type Locator } from '@playwright/test'
import { setupSession } from './support/session'
import { typeOfCategory } from './support/demo-types'

/**
 * GH446 — popup « Historique » : commits qui modifient le fichier de l'objet, ouverts au clic droit depuis
 * le panneau (arbre, versions, campagnes, validations). Scénarios E1 à E7 de specs/GH446-tests.md. Les objets
 * sont créés par IPC, puis le dépôt est commité deux fois (création, puis modification du titre) pour
 * avoir une liste ordonnée.
 */
const s = setupSession()

interface TypeLike { name: string; label: string; prefix: string; category: string; fields: unknown[]; statuses?: unknown[]; decisions?: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }
interface IdLike { id: string }

// Types retenus par `typeOfCategory` : ceux de la démo (une catégorie a son type), sinon celui du spec.
let REQ_TYPE = ''
let TEST_TYPE = ''
let ISSUE_TYPE = ''
const repo = () => s.project.localPath
const ws = () => s.project.workspaceDir

let reqId = ''
let testId = ''
let _issueId = ''
let _campaignId = ''
let versionId = ''
let validationId = ''

test.beforeAll(async () => {
  await s.invoke('schema:invalidate', repo())
  const schema = await s.invoke<SchemaLike>('schema:get', repo())
  const root = schema.nodes.find(n => n.name === 'root')!
  REQ_TYPE = typeOfCategory(root, 'requirement', {
    name: 'gh446_req', label: 'GH446 Exigence', prefix: 'GHQ', category: 'requirement', fields: [], statuses: [{ name: 'draft', label: 'Brouillon' }],
  })
  TEST_TYPE = typeOfCategory(root, 'test', {
    name: 'gh446_test', label: 'GH446 Test', prefix: 'GHT', category: 'test', fields: [], statuses: [{ name: 'draft', label: 'Brouillon' }],
  })
  ISSUE_TYPE = typeOfCategory(root, 'issue', {
    name: 'gh446_issue', label: 'GH446 Issue', prefix: 'GHI', category: 'issue', fields: [], statuses: [{ name: 'ouverte', label: 'Ouverte' }, { name: 'close', label: 'Close', isTerminal: true }],
  })
  typeOfCategory(root, 'version', {
    name: 'gh446_version', label: 'Version', prefix: 'GHX', category: 'version', fields: [],
    statuses: [{ name: 'en_cours', label: 'En cours' }, { name: 'released', label: 'Released', isApproval: true }, { name: 'abandonnee', label: 'Abandonnée', isTerminal: true }],
  })
  typeOfCategory(root, 'validation', {
    name: 'gh446_validation', label: 'Validation', prefix: 'GHY', category: 'validation', fields: [],
    statuses: [{ name: 'en_cours', label: 'En cours' }, { name: 'signee', label: 'Signée', isApproval: true }, { name: 'annulee', label: 'Annulée', isTerminal: true }],
    decisions: [{ name: 'en_attente', label: 'En attente', isPending: true }, { name: 'conforme', label: 'Conforme' }],
  })
  await s.invoke('schema:save', repo(), schema)
  await s.invoke('schema:invalidate', repo())

  reqId = (await s.invoke<IdLike>('requirements:create', repo(), { objectTypeRef: `root::${REQ_TYPE}`, title: 'GH446 exigence', fields: {} }, ws())).id
  await s.invoke<IdLike>('requirements:create', repo(), { objectTypeRef: `root::${REQ_TYPE}`, title: 'GH446 exigence deux', fields: {} }, ws())
  testId = (await s.invoke<IdLike>('tests:create', repo(), { objectTypeRef: `root::${TEST_TYPE}`, title: 'GH446 test', fields: {}, steps: [] }, ws())).id
  _issueId = (await s.invoke<IdLike>('issues:create', repo(), { objectTypeRef: `root::${ISSUE_TYPE}`, title: 'GH446 issue', fields: {} }, ws())).id
  _campaignId = (await s.invoke<IdLike>('campaigns:create', repo(), { title: 'GH446 campagne', testCaseIds: [testId] }, ws())).id
  versionId = (await s.invoke<IdLike>('versions:create', repo(), { title: 'GH446' }, ws())).id
  await s.invoke('versions:include', repo(), versionId, [reqId], ws())
  validationId = (await s.invoke<IdLike>('validations:create', repo(), { versionId, title: 'GH446 validation', fields: {} }, ws())).id
  await s.invoke('sync:stage-all', repo())
  await s.invoke('sync:commit', repo(), 'GH446 : création')
  await s.invoke('requirements:update', repo(), reqId, { title: 'GH446 exigence modifiée' })
  await s.invoke('sync:stage-all', repo())
  await s.invoke('sync:commit', repo(), 'GH446 : titre')
})

/** Ouvre une vue du panneau. Chargement complet : le schéma créé par IPC dans `beforeAll` est relu par la page
 *  (une navigation interne garde le schéma déjà en cache et ne propose pas les types de ce ticket). */
async function goTo(route: string, search: Record<string, string> = {}) {
  await s.page.goto(s.projectUrl(route, search))
  await s.page.waitForLoadState('networkidle')
}

/** Clic droit sur une ligne, puis « Historique » dans le menu. */
async function openHistoryFrom(target: Locator) {
  await target.first().click({ button: 'right' })
  await s.page.getByRole('button', { name: 'Historique', exact: true }).click()
  const dialog = s.page.getByTestId('object-commits-dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

test('E1 — exigence : Historique au clic droit liste les commits du fichier, du plus récent au plus ancien', async () => {
  await goTo('/product', { category: 'requirement', node: 'root', type: REQ_TYPE })
  const dialog = await openHistoryFrom(s.page.getByText('GH446 exigence modifiée', { exact: true }))
  await expect(dialog.getByRole('heading')).toContainText('GH446 exigence modifiée')
  const rows = dialog.getByTestId('object-commit-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('GH446 : titre')
  await expect(rows.nth(1)).toContainText('GH446 : création')
  // Aucun diff avant une sélection (critère 15), puis le diff du fichier au commit choisi.
  await expect(dialog.getByTestId('object-commit-diff')).toContainText('Sélectionnez un commit')
  await rows.nth(0).click()
  await expect(rows.nth(0)).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByTestId('object-commit-diff')).not.toContainText('Sélectionnez un commit')
  await s.page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('E2 — test : Historique au clic droit dans l\'arbre', async () => {
  await goTo('/product', { category: 'test', node: 'root', type: TEST_TYPE })
  const dialog = await openHistoryFrom(s.page.getByText('GH446 test', { exact: true }))
  await expect(dialog.getByTestId('object-commit-row')).toHaveCount(1)
  await expect(dialog.getByTestId('object-commit-row').first()).toContainText('GH446 : création')
  await s.page.keyboard.press('Escape')
})

test('E3 — issue : Historique au clic droit ; une issue jamais commitée affiche « Aucun commit »', async () => {
  await goTo('/product', { category: 'issue', node: 'root', type: ISSUE_TYPE })
  const dialog = await openHistoryFrom(s.page.getByText('GH446 issue', { exact: true }))
  await expect(dialog.getByTestId('object-commit-row')).toHaveCount(1)
  await s.page.keyboard.press('Escape')

  // Objet créé après le dernier commit : son fichier n'a pas de commit (critère 4).
  await s.invoke<IdLike>('issues:create', repo(), { objectTypeRef: `root::${ISSUE_TYPE}`, title: 'GH446 issue neuve', fields: {} }, ws())
  await goTo('/product', { category: 'issue', node: 'root', type: ISSUE_TYPE })
  const freshDialog = await openHistoryFrom(s.page.getByText('GH446 issue neuve', { exact: true }))
  await expect(freshDialog.getByTestId('object-commits-none')).toBeVisible()
  await s.page.keyboard.press('Escape')
})

test('E4 — version : Historique au clic droit dans le panneau des versions', async () => {
  await goTo('/versions')
  await s.page.getByTestId(`version-row-${versionId}`).click({ button: 'right' })
  await s.page.getByRole('button', { name: 'Historique', exact: true }).click()
  const dialog = s.page.getByTestId('object-commits-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('object-commit-row').first()).toContainText('GH446 : création')
  await s.page.keyboard.press('Escape')
})

test('E5 — campagne : Historique au clic droit dans la liste des campagnes', async () => {
  await goTo('/product', { category: 'campaign', node: 'root' })
  const dialog = await openHistoryFrom(s.page.getByText('GH446 campagne', { exact: true }))
  await expect(dialog.getByTestId('object-commit-row')).toHaveCount(1)
  await s.page.keyboard.press('Escape')
})

test('E6 — validation : Historique au clic droit sur une validation existante', async () => {
  await goTo('/validations')
  await s.page.getByTestId(`validation-version-${versionId}`).click({ button: 'right' })
  await s.page.getByRole('button', { name: 'Historique', exact: true }).click()
  const dialog = s.page.getByTestId('object-commits-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('object-commit-row').first()).toContainText('GH446 : création')
  await s.page.keyboard.press('Escape')
  expect(validationId).toBeTruthy()
})

// Vues Excel et Word : mêmes entrées, ciblées sur la ligne ou la carte (`data-node-id` dans la zone de défilement).
const viewRow = (name: string) => s.page.locator('[data-view-scroll] [data-node-id]').filter({ hasText: name }).first()

test('E7 — vue Excel : Historique sur une exigence ; la sélection multiple désactive l\'entrée', async () => {
  await goTo('/product', { category: 'requirement', node: 'root', type: REQ_TYPE })
  const row = viewRow('GH446 exigence modifiée')
  await row.click({ button: 'right' })
  await expect(s.page.getByRole('button', { name: 'Historique', exact: true })).toBeEnabled()
  await s.page.getByRole('button', { name: 'Historique', exact: true }).click()
  const dialog = s.page.getByTestId('object-commits-dialog')
  await expect(dialog.getByTestId('object-commit-row')).toHaveCount(2)
  await s.page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  // Deux lignes sélectionnées (Ctrl+clic) : l'entrée reste visible mais désactivée (Q4).
  await row.click()
  await viewRow('GH446 exigence deux').click({ modifiers: ['Control'] })
  await viewRow('GH446 exigence modifiée').click({ button: 'right' })
  await expect(s.page.getByRole('button', { name: 'Historique', exact: true })).toBeDisabled()
  await s.page.keyboard.press('Escape')
})

test('E8 — vue Word : Historique sur une carte d\'exigence', async () => {
  await goTo('/product', { category: 'requirement', node: 'root', type: REQ_TYPE })
  await s.page.getByTitle('Vue document').click()
  const card = viewRow('GH446 exigence modifiée')
  await card.click({ button: 'right' })
  await s.page.getByRole('button', { name: 'Historique', exact: true }).click()
  const dialog = s.page.getByTestId('object-commits-dialog')
  await expect(dialog.getByTestId('object-commit-row')).toHaveCount(2)
  await s.page.keyboard.press('Escape')
})

test('E9 — popup : aucun diff à l\'ouverture, Brut / Rendu au choix mémorisé, lecture seule (git status inchangé)', async () => {
  const before = await s.invoke<{ files?: unknown[] }>('sync:status', repo())
  await goTo('/product', { category: 'requirement', node: 'root', type: REQ_TYPE })
  const dialog = await openHistoryFrom(s.page.getByText('GH446 exigence modifiée', { exact: true }))
  await dialog.getByTestId('object-commit-row').nth(1).click()
  await expect(dialog.getByTestId('diff-mode-toggle')).toBeVisible()
  await dialog.getByRole('button', { name: /Brut|Raw/ }).first().click()
  await s.page.keyboard.press('Escape')

  // Réouverture : le mode choisi (Brut) est repris.
  const again = await openHistoryFrom(s.page.getByText('GH446 exigence modifiée', { exact: true }))
  await again.getByTestId('object-commit-row').nth(1).click()
  await expect(again.getByRole('button', { name: /Brut|Raw/ }).first()).toHaveAttribute('aria-pressed', 'true')
  await s.page.keyboard.press('Escape')

  const after = await s.invoke<{ files?: unknown[] }>('sync:status', repo())
  expect(after).toEqual(before)
})
