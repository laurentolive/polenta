import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'
import { typeOfCategory } from './support/demo-types'

/**
 * GH430 — la vue Validation affiche les entrées en attente des campagnes ouvertes sous leur test,
 * comme la section Exécutions de l'exigence (specs/GH197.md §1) : une entrée sans run, verdict
 * « En attente », campagne, et un clic ouvre sa page d'exécution. Le test reste « Aucune exécution » :
 * une attente n'est pas une dernière exécution.
 */
const s = setupSession()

interface TypeLike { name: string; label?: string; prefix?: string; category: string; fields: unknown[]; statuses?: unknown[]; decisions?: unknown[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }>; linkTypes?: Array<{ name: string }> }
interface Campaign { id: string; runs: Array<{ entryId: string; testCaseId: string }> }

const TITLE = 'GH430 validation'
let testId = ''
let reqId = ''
let versionId = ''
let validationId = ''
let campaign: Campaign

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  await s.invoke('schema:invalidate', localPath)
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const root = schema.nodes.find(n => n.name === 'root')!
  root.objectTypes = [...(root.objectTypes ?? []), {
    name: 'gh430_req', label: 'GH430 Exigence', prefix: 'GHQ', category: 'requirement', fields: [],
    statuses: [{ name: 'draft', label: 'Brouillon' }],
  }]
  const testType = typeOfCategory(root, 'test', {
    name: 'gh430_essai', label: 'GH430 Essai', prefix: 'GHE', category: 'test', fields: [],
    statuses: [{ name: 'valide', label: 'Validé', isApproval: true }],
  })
  typeOfCategory(root, 'version', {
    name: 'gh430_version', label: 'Version', prefix: 'GHX', category: 'version', fields: [],
    statuses: [{ name: 'en_cours', label: 'En cours' }, { name: 'released', label: 'Released', isApproval: true }, { name: 'abandonnee', label: 'Abandonnée', isTerminal: true }],
  })
  typeOfCategory(root, 'validation', {
    name: 'gh430_validation', label: 'Validation', prefix: 'GHY', category: 'validation', fields: [],
    statuses: [{ name: 'en_cours', label: 'En cours' }, { name: 'signee', label: 'Signée', isApproval: true }, { name: 'annulee', label: 'Annulée', isTerminal: true }],
    decisions: [{ name: 'en_attente', label: 'En attente', isPending: true }, { name: 'conforme', label: 'Conforme' }, { name: 'non_conforme', label: 'Non conforme', proposesIssue: true }],
  })
  await s.invoke('schema:save', localPath, schema)

  testId = (await s.invoke<{ id: string }>('tests:create', localPath, {
    title: 'GH430 T', objectTypeRef: `root::${testType}`, fields: {},
    steps: [{ order: 1, action: 'Mesurer', expectedResult: '12 V', notes: '' }],
  }, workspaceDir)).id
  reqId = (await s.invoke<{ id: string }>('requirements:create', localPath, { objectTypeRef: 'root::gh430_req', title: 'GH430 R', fields: {} }, workspaceDir)).id
  // Exigence couverte par le test (sens test → exigence, premier type de lien du schéma comme GH197).
  await s.invoke('requirements:link-create', localPath, { type: schema.linkTypes?.[0]?.name ?? 'verification', sourceId: testId, targetId: reqId })

  // Campagne ouverte : le test y est une entrée en attente, sans run.
  campaign = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH430 campagne', testCaseIds: [testId] }, workspaceDir)

  versionId = (await s.invoke<{ id: string }>('versions:create', localPath, { title: 'GH430' }, workspaceDir)).id
  await s.invoke('versions:include', localPath, versionId, [reqId], workspaceDir)
  validationId = (await s.invoke<{ id: string }>('validations:create', localPath, { versionId, title: TITLE, fields: {} }, workspaceDir)).id
})

test('GH430-1 — validation : entrée en attente sous son test, page d\'exécution au clic', async () => {
  const p = s.page
  const entryId = campaign.runs[0].entryId
  const key = `pending:${campaign.id}:${entryId}`
  await navigate(p, s.projectUrl(`/validation/${validationId}`, { repoPath: s.project.localPath }))
  await expect(p.getByTestId('validation-page')).toBeVisible()

  // Dépliage à la souris : l'exigence, puis le test.
  await p.getByTestId(`validation-toggle-${reqId}`).click()
  await expect(p.getByTestId(`validation-test-empty-${testId}`)).toContainText('Aucune exécution')
  await p.getByTestId(`validation-test-toggle-${testId}`).click()

  const pending = p.getByTestId(`validation-pending-${key}`)
  await expect(pending).toBeVisible()
  await expect(pending).toContainText(campaign.id)
  await expect(pending).toContainText('En attente')
  // Aucune ligne d'exécution : l'attente ne devient pas une dernière exécution.
  await expect(p.locator('[data-testid^="validation-run-"]')).toHaveCount(0)

  await p.getByTestId(`validation-pending-link-${key}`).click()
  await expect(p).toHaveURL(new RegExp(`/campaign/${campaign.id}/execute/${entryId}`))
})
