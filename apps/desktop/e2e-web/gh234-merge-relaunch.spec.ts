import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH234 — relancer un merge dont la résolution a été abandonnée (mêmes commits, donc même id de
 * session) rouvre la résolution : avant, l'onglet affichait « Cette résolution n'existe plus » et
 * le panneau latéral restait sur « Chargement… ».
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
  await write('gh234/notes.txt', 'ligne commune\n')
  await commit('GH234 base')
  await s.invoke('sync:create-branch', localPath, 'gh234-conflit')
  await write('gh234/notes.txt', 'ligne de la branche\n')
  await commit('GH234 branche')
  await s.invoke('sync:checkout-branch', localPath, current)
  await write('gh234/notes.txt', 'ligne de la destination\n')
  await commit('GH234 destination')
})

/** From the graph: merge the branch into the current one, then « Résoudre les conflits ». */
async function mergeAndResolve() {
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/graph', { repoPath: s.project.localPath }))
  await s.page.waitForLoadState('networkidle')
  await s.page.getByText('gh234-conflit', { exact: true }).first().click({ button: 'right' })
  await s.page.getByRole('button', { name: 'Merger branche dans…' }).click()
  await s.page.getByRole('button', { name: current, exact: true }).click()
  await s.page.getByRole('button', { name: 'Résoudre les conflits' }).click()
}

test('abandonner puis relancer le même merge rouvre la résolution', async () => {
  const panel = () => s.page.getByTestId('merge-files-panel')
  await mergeAndResolve()
  await expect(panel()).toContainText('notes.txt')
  await s.page.getByRole('button', { name: 'Abandonner', exact: true }).click()
  await expect(panel()).toHaveCount(0)

  await mergeAndResolve()
  await expect(panel()).toContainText('notes.txt')
  await expect(s.page.getByText("Cette résolution n'existe plus", { exact: false })).toHaveCount(0)
})
