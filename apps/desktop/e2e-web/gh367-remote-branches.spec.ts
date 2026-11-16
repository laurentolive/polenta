import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH367 — une `int-*` présente seulement sur le serveur (créée et poussée par un autre utilisateur,
 * rapatriée par fetch) apparaît dans la combo de branche de l'onglet Structure ; la choisir crée la
 * branche locale qui la suit et la checkoute.
 */
const s = setupSession()
// Images de la démo absentes (maquettes) : 404 sans rapport.
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

const BRANCH = 'int-e2e-serveur'
const combo = () => s.page.getByPlaceholder('branche…').first()

test('GH367-1 — int-* seulement sur origin : listée dans la combo, la choisir crée la branche locale et la checkoute', async () => {
  const { localPath } = s.project
  const { headOid } = await s.invoke<{ headOid: string }>('integration:state', localPath)
  // Ce que laisse un fetch d'une branche poussée par un autre : la ref distante seule.
  const ref = path.join(localPath, '.git', 'refs', 'remotes', 'origin', BRANCH)
  fs.mkdirSync(path.dirname(ref), { recursive: true })
  fs.writeFileSync(ref, `${headOid}\n`)

  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/schema', { repoPath: localPath }))
  await s.page.waitForLoadState('networkidle')
  await expect(combo()).toBeVisible({ timeout: 15_000 })

  await combo().click()
  const entry = s.page.getByRole('button', { name: new RegExp(`^${BRANCH}\\s*serveur`) })
  await expect(entry).toBeVisible({ timeout: 15_000 })
  await expect(entry).toHaveAttribute('title', /seulement sur le serveur/)
  await s.shot('gh367-combo-serveur')
  await entry.click()
  const status = await s.invoke<{ staged: unknown[]; unstaged: unknown[] }>('sync:status', localPath)
  if (status.staged.length + status.unstaged.length > 0) await s.page.getByRole('button', { name: 'Forcer le checkout' }).click()

  await expect(combo()).toHaveValue(BRANCH, { timeout: 15_000 })
  const branches = await s.invoke<{ name: string; isCurrent: boolean; remoteOnly?: boolean }[]>('sync:branches', localPath)
  expect(branches.find(b => b.name === BRANCH)).toEqual({ name: BRANCH, isCurrent: true, type: 'int' })
})
