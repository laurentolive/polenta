import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH68 — tests non approuvés dans une campagne : ajout par le sélecteur, badge et bandeau,
 * resynchronisation de la copie à l'ouverture de l'exécution, avertissement et confirmation
 * (scénarios S1–S2, L3, E1–E3 et E6 de specs/GH68-tests.md). Le test brouillon et la campagne
 * sont créés par le test (IPC), l'ajout et l'exécution se font par l'interface.
 */
const s = setupSession()

interface Step { order: number; action: string; expectedResult: string; notes: null }
interface TestCaseLike { id: string; title: string; objectTypeRef: string; status: string; fields: Record<string, unknown>; steps?: Step[] }
interface Run { entryId: string; testCaseId: string; status: string; testSnapshot?: TestCaseLike }
interface Campaign { id: string; runs: Run[] }
interface StatusLike { name: string; isApproval?: boolean }
interface TypeLike { name: string; category: string; statuses?: StatusLike[] }
interface SchemaLike { nodes: Array<{ name: string; objectTypes?: TypeLike[] }> }

let draft: TestCaseLike
let approved: TestCaseLike
let campaign: Campaign

const steps = (v: number): Step[] => [{ order: 1, action: `Action GH68 v${v}`, expectedResult: 'OK', notes: null }]

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}

const getCampaign = () => s.invoke<Campaign>('campaigns:get', s.project.localPath, campaign.id)
const entryOf = async (testCaseId: string) => (await getCampaign()).runs.find(r => r.testCaseId === testCaseId)!

test.beforeAll(async () => {
  const { localPath, workspaceDir } = s.project
  const schema = await s.invoke<SchemaLike>('schema:get', localPath)
  const tests = await s.invoke<TestCaseLike[]>('tests:list', localPath)
  // Un type de test avec un statut d'approbation, et un test approuvé de ce type (modèle des champs).
  for (const node of schema.nodes) {
    for (const type of node.objectTypes ?? []) {
      const approval = type.statuses?.find(st => st.isApproval)?.name
      if (type.category !== 'test' || !approval) continue
      const ref = `${node.name}::${type.name}`
      const model = tests.find(t => t.objectTypeRef === ref && t.status === approval)
      if (model) { approved = model; break }
    }
    if (approved) break
  }
  test.skip(!approved, 'la démo doit avoir un test approuvé dans un type à statut d\'approbation')

  draft = await s.invoke<TestCaseLike>('tests:create', localPath, {
    title: 'GH68 test brouillon', objectTypeRef: approved.objectTypeRef, steps: steps(1), fields: approved.fields,
  }, workspaceDir)
  expect(draft.status).not.toBe(approved.status)
  campaign = await s.invoke<Campaign>('campaigns:create', localPath, { title: 'GH68 planification', testCaseIds: [] }, workspaceDir)
})

test('S1–S2 — un test brouillon est proposé à l\'ajout, signalé dans la campagne', async () => {
  const p = s.page
  await navigate(p, s.projectUrl(`/campaign/${campaign.id}`, { repoPath: s.project.localPath }))
  await p.getByText('Ajouter des tests').click()
  await p.locator(`select:has(option[value="${draft.objectTypeRef}"])`).selectOption(draft.objectTypeRef)

  // S1 — le brouillon est listé, colonne Statut affichée.
  const draftRow = p.locator('tr', { hasText: draft.id })
  await expect(draftRow).toBeVisible()
  await expect(p.getByRole('columnheader', { name: /Statut/ })).toBeVisible()
  await draftRow.getByRole('checkbox').click()
  await s.shot('gh68-s1-selecteur')
  await p.getByRole('button', { name: 'Ajouter (1)' }).click()

  // S2 — instance pending, badge et bandeau.
  await expect.poll(async () => (await entryOf(draft.id))?.status).toBe('pending')
  await expect(p.getByText('Non approuvé').first()).toBeVisible()
  await expect(p.getByText('1 instance à exécuter porte sur un test non approuvé')).toBeVisible()
  await s.shot('gh68-s2-campagne')
})

test('E1–E3 — exécution : copie resynchronisée, avertissement, confirmation, copie figée ensuite', async () => {
  const p = s.page
  const { localPath, workspaceDir } = s.project
  await s.invoke('tests:update', localPath, draft.id, { steps: steps(2) }, workspaceDir)
  const entry = await entryOf(draft.id)
  expect(entry.testSnapshot?.steps?.[0]?.action).toBe('Action GH68 v1')

  // E1 — l'ouverture de l'exécution affiche et enregistre la version actuelle.
  await navigate(p, s.projectUrl(`/campaign/${campaign.id}/execute/${entry.entryId}`, { repoPath: localPath }))
  await expect(p.getByText('Action GH68 v2')).toBeVisible()
  expect((await entryOf(draft.id)).testSnapshot?.steps?.[0]?.action).toBe('Action GH68 v2')

  // E2 — bandeau ; la confirmation annulée n'enregistre rien.
  await expect(p.getByText(/Ce test n'est pas approuvé/)).toBeVisible()
  await p.getByRole('button', { name: 'Soumettre le résultat' }).click()
  await expect(p.getByText('Exécuter un test non approuvé ?')).toBeVisible()
  await s.shot('gh68-e2-confirmation')
  await p.getByRole('button', { name: 'Annuler' }).last().click()
  await expect(p.getByText('Exécuter un test non approuvé ?')).toHaveCount(0)
  expect((await entryOf(draft.id)).status).toBe('pending')

  // E3 — confirmée : résultat enregistré, copie = version affichée.
  await p.getByRole('button', { name: 'Soumettre le résultat' }).click()
  await p.getByRole('button', { name: 'Exécuter quand même' }).click()
  await p.waitForURL(new RegExp(`/campaign/${campaign.id}(\\?|$)`))
  const executed = await entryOf(draft.id)
  expect(executed.status).not.toBe('pending')
  expect(executed.testSnapshot?.steps?.[0]?.action).toBe('Action GH68 v2')

  // Le test change encore : l'instance exécutée ne bouge plus ; badge conservé, bandeau retiré (L3).
  await s.invoke('tests:update', localPath, draft.id, { steps: steps(3) }, workspaceDir)
  await s.invoke('campaigns:refresh-entries', localPath, campaign.id, [executed.entryId])
  expect((await entryOf(draft.id)).testSnapshot?.steps?.[0]?.action).toBe('Action GH68 v2')
  await expect(p.getByText('Non approuvé').first()).toBeVisible()
  await expect(p.getByText(/instance à exécuter porte sur/)).toHaveCount(0)
})

test('E6 — test approuvé : ni bandeau ni confirmation', async () => {
  const p = s.page
  const { localPath, workspaceDir } = s.project
  const updated = await s.invoke<Campaign>('campaigns:add-tests', localPath, campaign.id, [approved.id], {}, workspaceDir)
  const entry = updated.runs.find(r => r.testCaseId === approved.id)!
  await navigate(p, s.projectUrl(`/campaign/${campaign.id}/execute/${entry.entryId}`, { repoPath: localPath }))
  await expect(p.getByRole('button', { name: 'Soumettre le résultat' })).toBeVisible()
  await expect(p.getByText(/Ce test n'est pas approuvé/)).toHaveCount(0)
  await p.getByRole('button', { name: 'Soumettre le résultat' }).click()
  await expect(p.getByText('Exécuter un test non approuvé ?')).toHaveCount(0)
  await p.waitForURL(new RegExp(`/campaign/${campaign.id}(\\?|$)`))
})
