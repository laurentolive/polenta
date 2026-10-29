import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH231 — vue graphe, « Merger branche dans… » : après le choix de la branche de destination, le
 * menu quitte le choix de branche — fermé si le merge réussit, sinon le menu principal montre
 * l'erreur et « Résoudre les conflits » (avant : il restait sur le choix de branche jusqu'à
 * « Retour »).
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

let current = ''

async function write(rel: string, content: string) {
  const full = path.join(s.project.localPath, rel)
  await fs.promises.mkdir(path.dirname(full), { recursive: true })
  await fs.promises.writeFile(full, content)
}

async function commit(message: string) {
  const { localPath } = s.project
  await s.invoke('sync:stage-all', localPath)
  await s.invoke('sync:commit', localPath, message)
}

test.beforeAll(async () => {
  const { localPath } = s.project
  current = (await s.invoke<Array<{ name: string; isCurrent: boolean }>>('sync:branches', localPath)).find(b => b.isCurrent)!.name
  await write('gh231/notes.txt', 'ligne commune\n')
  await commit('GH231 base')
  await s.invoke('sync:create-branch', localPath, 'gh231-conflit')
  await write('gh231/notes.txt', 'ligne de la branche\n')
  await commit('GH231 branche')
  await s.invoke('sync:checkout-branch', localPath, current)
  await write('gh231/notes.txt', 'ligne de la destination\n')
  await commit('GH231 destination')
})

test('merge en conflit : le menu revient au menu principal avec l\'erreur et « Résoudre les conflits »', async () => {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/graph', { repoPath: s.project.localPath }))
  await s.page.waitForLoadState('networkidle')
  await s.page.getByText('gh231-conflit', { exact: true }).first().click({ button: 'right' })
  await s.page.getByRole('button', { name: 'Merger branche dans…' }).click()
  await expect(s.page.getByText('Merger « gh231-conflit » dans…')).toBeVisible()
  await s.page.getByRole('button', { name: current, exact: true }).click()

  await expect(s.page.getByText(/Conflits de merge/)).toBeVisible()
  await expect(s.page.getByRole('button', { name: 'Résoudre les conflits' })).toBeVisible()
  await expect(s.page.getByText('Merger « gh231-conflit » dans…')).toHaveCount(0)
})
