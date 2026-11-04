import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import * as yaml from 'js-yaml'
import { setupSession } from './support/session'
import { publish, LABELS } from './support/ui'

/**
 * GH276 — écarts restants de GH106 : une `int-*` créée depuis le graphe est désignée ; création
 * depuis le panneau Version (T-15) ; « Désigner » dans le popover de la publication multi-repo (T-33).
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

interface IntegrationState { currentBranch: string; configured: string }
interface TreeNode { name: string; label?: string; repoPath: string; url: string }

const state = (repoPath = s.project.localPath) => s.invoke<IntegrationState>('integration:state', repoPath)

async function write(rel: string, content: string, dir = s.project.localPath) {
  const full = path.join(dir, rel)
  await fs.promises.mkdir(path.dirname(full), { recursive: true })
  await fs.promises.writeFile(full, content)
}

async function openGraph() {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/graph', { repoPath: s.project.localPath }))
  await s.page.waitForLoadState('networkidle')
}

/** Menu « Créer branche depuis commit… » sur le commit `message`, nom saisi et validé. */
async function createFromCommit(message: string, name: string) {
  await s.page.getByText(message, { exact: true }).first().click({ button: 'right' })
  await s.page.getByRole('button', { name: 'Créer branche depuis commit…' }).click()
  await s.page.getByPlaceholder('feature/ma-branche').fill(name)
  await s.page.getByPlaceholder('feature/ma-branche').press('Enter')
}

test('GH276-1 — graphe, modifications en attente : int-* refusée avec une explication', async () => {
  const { localPath } = s.project
  await write('gh276/a.txt', 'départ\n')
  await s.invoke('sync:stage-all', localPath)
  await s.invoke('sync:commit', localPath, 'GH276 départ')
  await write('gh276/a.txt', 'modifié\n')

  await openGraph()
  await createFromCommit('GH276 départ', 'int-gh276-sale')
  await expect(s.page.getByText(/publiez ou annulez d'abord les modifications en attente/)).toBeVisible()
  const branches = await s.invoke<Array<{ name: string }>>('sync:branches', localPath)
  expect(branches.map(b => b.name)).not.toContain('int-gh276-sale')
  await s.page.keyboard.press('Escape')
})

test('GH276-2 — graphe : une int-* créée depuis un commit est désignée', async () => {
  const { localPath } = s.project
  await s.invoke('sync:stage-all', localPath)
  await s.invoke('sync:commit', localPath, 'GH276 propre')
  // Commit par IPC : l'application n'en est pas prévenue, son état « modifié » est relu au rechargement.
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')

  await openGraph()
  await createFromCommit('GH276 départ', 'int-gh276')
  await expect.poll(async () => (await state()).configured, { timeout: 15_000 }).toBe('int-gh276')
  expect((await state()).currentBranch).toBe('int-gh276')
  // Départ = le commit choisi : le commit suivant n'est pas sur la nouvelle branche.
  expect(fs.existsSync(path.join(localPath, 'gh276', 'a.txt'))).toBe(true)
  expect(await fs.promises.readFile(path.join(localPath, 'gh276', 'a.txt'), 'utf8')).toBe('départ\n')
})

test('GH276-3 — panneau Version : une int-* créée par « Nouvelle branche… » est désignée (T-15)', async () => {
  await s.openView('Version')
  await s.page.getByPlaceholder('branche…').first().click()
  await s.page.getByRole('button', { name: 'Nouvelle branche…' }).first().click()
  await s.page.getByPlaceholder('nom-de-branche').fill('int-gh276v')
  await s.page.getByPlaceholder('nom-de-branche').press('Enter')
  await expect.poll(async () => (await state()).configured, { timeout: 15_000 }).toBe('int-gh276v')
})

test('GH276-4 — publication multi-repo : « Désigner » par repo bloqué, puis plus de blocage (T-33)', async () => {
  const opened = await s.invoke<{ tree: { nodes: TreeNode[] } }>('workspace:open', s.project.workspaceDir)
  const comp = opened.tree.nodes.find(n => n.repoPath !== s.project.localPath && n.url)!
  // Branche brute : le project.yaml hérité désigne une autre branche (cas PH2).
  test.setTimeout(240_000)
  await s.invoke('sync:create-branch', comp.repoPath, 'int-e2e33')
  expect((await state(comp.repoPath)).currentBranch).toBe('int-e2e33')
  // Le composant est épinglé : sans pin sur la nouvelle branche, la relecture de l'arbre le remettrait
  // sur son ancien pin (l'application fait suivre le pin de la même façon après un checkout).
  const manifestPath = path.join(s.project.localPath, 'polenta-repo.yaml')
  const manifest = yaml.load(await fs.promises.readFile(manifestPath, 'utf8')) as { dependencies: Array<{ name: string; pin?: string }> }
  manifest.dependencies.find(d => d.name === comp.name)!.pin = 'int-e2e33'
  await fs.promises.writeFile(manifestPath, yaml.dump(manifest))
  await write('gh276/t33.txt', 'modification\n', comp.repoPath)
  // Écritures sur disque : l'état des repos est relu au rechargement, pas pendant la saisie du titre.
  await s.page.reload()
  await s.page.waitForLoadState('networkidle')

  await s.openView('Exigences')
  await publish(s.page, 'GH276 T-33')
  await expect(s.page.getByText("Rien n'a été publié : ces repos ne sont pas sur leur branche d'intégration configurée.")).toBeVisible({ timeout: 15_000 })
  const designate = s.page.getByRole('button', { name: /Désigner int-e2e33$/ })
  await expect(designate).toBeVisible()
  await designate.click()
  await expect(designate).toHaveCount(0, { timeout: 30_000 })
  await expect.poll(async () => (await state(comp.repoPath)).configured, { timeout: 15_000 }).toBe('int-e2e33')

  // La publication suivante n'est plus bloquée pour ce repo.
  await publish(s.page, 'GH276 T-33 bis')
  await expect(s.page.getByText("Rien n'a été publié : ces repos ne sont pas sur leur branche d'intégration configurée.")).toHaveCount(0)
  await expect(s.page.getByRole('button', { name: LABELS.publish }).first()).toBeVisible()
})
