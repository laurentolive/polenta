import { test, expect, type Page } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH278 — les exemples des tutoriels 3, 4, 9 et 10 se trouvent dans la démo, à l'endroit indiqué
 * (specs/GH278-tests.md E1 à E3). Lecture seule, sauf l'exécution refusée faute de version testée.
 * Les composants viennent des dépôts publics : rien ici ne dépend de leurs versions.
 */
const s = setupSession()

const repo = () => s.project.localPath

async function navigate(p: Page, url: string) {
  await p.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
  await p.waitForLoadState('networkidle')
}

test('E1 — tutoriel 9 : versions du produit, backlog, page de la 2.0', async () => {
  const p = s.page
  await s.openView('Version')
  // Le panneau s'ouvre sur la version produit (GH289) ; le bouton du même nom est l'en-tête.
  await p.getByRole('button', { name: 'Version produit', exact: true }).first().click()
  const panel = p.getByTestId('product-versions-panel')
  for (const id of ['LLV-0001', 'LLV-0002']) await expect(panel.getByTestId(`version-row-${id}`)).toBeVisible()
  // L'abandonnée n'apparaît qu'à la demande, comme le dit le tutoriel 9.
  await expect(panel.getByTestId('version-row-LLV-0003')).toHaveCount(0)
  await panel.getByRole('checkbox', { name: 'Afficher les versions abandonnées' }).check()
  await expect(panel.getByTestId('version-row-LLV-0003')).toBeVisible()
  // Backlog : un seul élément, PRD-0006 modifiée après la 1.0.
  await expect(p.getByTestId('version-backlog')).toContainText('1')
  await p.getByTestId('version-backlog').click()
  await expect(p.getByTestId('backlog-table')).toContainText('PRD-0006')

  await panel.getByTestId('version-row-LLV-0002').click()
  const page = p.getByTestId('version-page')
  await expect(page).toBeVisible()
  await expect(page.getByTestId('version-changes')).toContainText('ISS-0003')
  // Analyse en cours : arbre des racines, PRD-0002 amenée par l'issue ISS-0003.
  const roots = page.getByTestId('version-impact-roots')
  await expect(roots).toContainText('via ISS-0003')
  await expect(roots).toContainText('SYS-0002')
  await expect(page.getByTestId('version-tests-list')).toContainText('TSYS-0005')
  await expect(page.getByTestId('version-tests-uncovered')).toContainText('PRD-0013')
  await s.shot('gh278-version')
})

test('E2 — tutoriel 10 : validation signée figée, validation en cours et ses cas', async () => {
  const p = s.page
  await navigate(p, s.projectUrl('/validation/VAL-0001', { repoPath: repo() }))
  await expect(p.getByTestId('validation-state')).toHaveText('Signée')
  await expect(p.getByTestId('validation-frozen')).toBeVisible()
  await expect(p.getByTestId('validation-decision-SYS-0004')).toHaveText('Dérogation')

  await navigate(p, s.projectUrl('/validation/VAL-0002', { repoPath: repo() }))
  await expect(p.getByTestId('validation-state')).toHaveText('En cours')
  await expect(p.getByTestId('validation-proposed-SYS-0013')).toBeVisible()
  await expect(p.getByTestId('validation-row-PRD-0006')).toContainText('à revoir : contenu modifié')
  // Signer : la fenêtre liste les motifs de refus (version en cours, décisions restantes…).
  await p.getByTestId('validation-sign').click()
  await expect(p.getByTestId('validation-problems')).toBeVisible()
  await p.getByTestId('validation-dialog-close').click()
  await s.shot('gh278-validation')

  const issues = await s.invoke<Array<{ id: string; origin?: { runs?: string[]; decisions?: string[] } }>>('issues:list', repo())
  expect(issues.map(i => i.id)).toEqual(['ISS-0001', 'ISS-0002', 'ISS-0003'])
  expect(issues[1].origin?.decisions).toEqual(['VAL-0001/SYS-0004'])
})

test('E3 — tutoriel 4 : une exécution de la PVT demande la version testée', async () => {
  const p = s.page
  const campaign = await s.invoke<{ runs: Array<{ entryId: string; testCaseId: string }> }>('campaigns:get', repo(), 'CAMP-0005')
  const entry = campaign.runs.find(r => r.testCaseId === 'TSYS-0001')!
  await navigate(p, s.projectUrl(`/campaign/CAMP-0005/execute/${entry.entryId}`, { repoPath: repo() }))
  const select = p.getByTestId('tested-version-select')
  await expect(select).toBeVisible()
  await expect(select.locator('option')).toContainText(['2.0 (LLV-0002) · en cours'])
  await p.getByRole('button', { name: 'Soumettre le résultat' }).click()
  await expect(p.getByTestId('tested-version-missing')).toBeVisible()
})

test('E4 — tutoriel 3 : vue d\'équipe « Suivi de conformité » avec les reflets', async () => {
  const p = s.page
  await s.openView('Exigences')
  await p.getByTitle('Vue tableau').click()
  await p.waitForLoadState('networkidle')
  await p.getByTestId('saved-views-button').click()
  await p.getByTestId('saved-view-team-Suivi de conformité').click()
  await expect(p.getByTestId('saved-views-label')).toHaveText('Suivi de conformité')
  const row = p.locator('tr').filter({ hasText: 'PRD-0001' }).first()
  await expect(row.getByTestId('reflection-validationStatus')).toHaveText('Conforme (1.0)')
  await s.shot('gh278-views')
})
