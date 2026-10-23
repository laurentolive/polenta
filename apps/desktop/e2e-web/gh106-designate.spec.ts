import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'
import { remoteLog } from './support/forge'

/**
 * GH106 — « Désigner » depuis le bandeau de « Publier » (specs/GH106-tests.md T-09 ; T-24 est couvert en unitaire) : une
 * `int-*` créée sans passer par la désignation hérite du `config/project.yaml` de sa branche
 * d'origine (cas PH2). Le bandeau propose alors « Désigner », qui commite ce seul fichier et le
 * pousse sur la forge locale.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

const BRANCH = 'int-e2e106'

interface IntegrationState { currentBranch: string; configured: string; status: string }

test('GH106-1 — int-* héritée : bandeau « Désigner », commit poussé, Publier débloqué (T-09)', async () => {
  const { localPath } = s.project
  const before = await s.invoke<IntegrationState>('integration:state', localPath)
  const pendingBefore = await pendingFiles(localPath)
  // Création brute (sync:create-branch) : branche à HEAD, project.yaml hérité — comme une branche
  // créée hors de Polenta ou avant GH106.
  await s.invoke('sync:create-branch', localPath, BRANCH)
  const inherited = await s.invoke<IntegrationState>('integration:state', localPath)
  expect(inherited).toMatchObject({ currentBranch: BRANCH, configured: before.configured, status: 'incoherent' })

  await s.openView('Exigences')
  const designate = s.page.getByRole('button', { name: `Désigner ${BRANCH}` })
  await expect(designate).toBeVisible({ timeout: 15_000 })
  await expect(s.page.getByText("n'est pas désignée comme branche d'intégration")).toBeVisible()
  await s.shot('gh106-bandeau')

  await designate.click()
  await expect(designate).toHaveCount(0, { timeout: 15_000 })
  await expect(s.page.getByText("n'est pas désignée comme branche d'intégration")).toHaveCount(0)

  expect(await s.invoke<IntegrationState>('integration:state', localPath)).toMatchObject({ configured: BRANCH, status: 'ok' })
  // Poussée sur la forge : le dernier commit de la branche distante est la désignation.
  expect(remoteLog('%s', undefined, BRANCH).trim().split('\n')[0]).toBe(`Branche d'intégration : ${BRANCH}`)
  // La désignation ne laisse rien en attente et ne touche pas aux modifications déjà présentes.
  const pendingAfter = await pendingFiles(localPath)
  expect(pendingAfter).not.toContain('config/project.yaml')
  expect(pendingAfter).toEqual(pendingBefore)
  await s.shot('gh106-designee')
})

async function pendingFiles(repoPath: string): Promise<string[]> {
  const st = await s.invoke<{ staged: { path: string }[]; unstaged: { path: string }[] }>('sync:status', repoPath)
  return [...st.staged, ...st.unstaged].map(f => f.path).sort()
}
