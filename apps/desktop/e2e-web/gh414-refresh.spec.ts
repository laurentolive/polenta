import * as fs from 'fs'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'
import { outsideClone } from './support/forge'

/**
 * GH414 — bouton « Rafraîchir » à côté de « Publier » : compteur de retard, merge de l'intégration
 * dans la branche de travail. Vérifié dans le navigateur, sur la démo clonée à neuf pour ce fichier.
 */
const s = setupSession()
test.beforeEach(() => s.allowConsoleErrors(/status of 404/))

const REFRESH = /^(Récupérer|Get updates)(\s\d+)?$/
const WORK = 'dev-gh414'

interface IntegrationState { currentBranch: string; configured: string }

const state = () => s.invoke<IntegrationState>('integration:state', s.project.localPath)

test('GH414-1 — sur l\'intégration : Rafraîchir récupère le commit de l\'équipe dans l\'arbre de travail', async () => {
  const { localPath } = s.project
  const { configured } = await state()
  expect(configured).toBeTruthy()

  // Le collègue pousse sur l'intégration configurée (clone à la bonne branche).
  const other = outsideClone('gh414-int')
  execFileSync('git', ['-C', other.dir, 'checkout', configured], { stdio: 'ignore' })
  other.write('gh414/equipe.txt', 'poussé par l\'équipe\n')
  other.commitAndPush('équipe : gh414/equipe.txt')

  const button = s.page.getByRole('button', { name: REFRESH }).first()
  await expect(button).toBeVisible()
  await button.click()

  // Le dépôt de démo n'ignore pas encore `*.pref` : les modifs de l'app passent par dev-auto (GH173),
  // et le commit de l'équipe doit arriver dans l'arbre de travail, pas seulement dans la ref.
  await expect(s.page.getByText(/commit\(s\) récupéré\(s\)\.|Intégration à jour\./)).toBeVisible({ timeout: 60_000 })
  await expect.poll(() => fs.existsSync(path.join(localPath, 'gh414', 'equipe.txt')), { timeout: 30_000 }).toBe(true)
  await s.shot('gh414-1-integration')
})

test('GH414-2 — branche de travail en retard : compteur, puis merge de l\'intégration', async () => {
  const { localPath } = s.project
  const { configured } = await state()

  // Ma branche de travail, créée depuis l'intégration, avec un commit et une modif en cours.
  await s.invoke('sync:create-branch', localPath, WORK)
  await s.invoke('sync:checkout-branch', localPath, WORK)
  fs.mkdirSync(path.join(localPath, 'gh414'), { recursive: true })
  fs.writeFileSync(path.join(localPath, 'gh414', 'moi.txt'), 'mon travail\n')
  await s.invoke('sync:stage-all', localPath)
  await s.invoke('sync:commit', localPath, 'GH414 mon travail')
  fs.writeFileSync(path.join(localPath, 'gh414', 'moi.txt'), 'mon travail en cours\n')

  // Le collègue pousse sur l'intégration : ma branche est en retard d'un commit.
  const other = outsideClone('gh414-retard')
  execFileSync('git', ['-C', other.dir, 'checkout', configured], { stdio: 'ignore' })
  other.write('gh414/retard.txt', 'poussé après mon travail\n')
  other.commitAndPush('équipe : gh414/retard.txt')
  // Un tick de l'auto-pull : il fetch (sans fetch à l'ouverture, le compteur attend ce tick).
  await s.invoke('sync:fetch', localPath, '')

  const button = s.page.getByRole('button', { name: REFRESH }).first()
  await expect(button).toHaveText(/1/, { timeout: 30_000 })
  await s.shot('gh414-2-compteur')

  await button.click()
  await expect(s.page.getByText(/1 commit\(s\) récupéré\(s\)\./)).toBeVisible({ timeout: 60_000 })
  // Mes modifs en cours sont toujours là, et le commit de l'équipe est arrivé.
  expect(fs.readFileSync(path.join(localPath, 'gh414', 'moi.txt'), 'utf-8')).toBe('mon travail en cours\n')
  expect(fs.existsSync(path.join(localPath, 'gh414', 'retard.txt'))).toBe(true)
  expect((await s.invoke<{ branch: string }>('sync:status', localPath)).branch).toBe(WORK)
  await s.shot('gh414-2-merge')
})
