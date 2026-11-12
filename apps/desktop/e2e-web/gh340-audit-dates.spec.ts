import * as fs from 'fs'
import * as path from 'path'
import yaml from 'js-yaml'
import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH340 — dates de création / modification stockées dans le YAML (scénarios W1, W2, R2, C1, C6 de
 * specs/GH340-tests.md). La démo n'a pas encore de dates : la mise en conformité les propose. La
 * validation (écriture, commit, push) n'est pas faite ici : tous les fichiers e2e partagent le même
 * repo nu et une publication changerait leur point de départ — elle est couverte par
 * `repo-conformity.gh340.test.ts` (C4/C5) sur un vrai dépôt.
 */
const s = setupSession()

interface ReqLike { id: string; objectTypeRef: string; createdAt: string | null; createdBy: string | null; updatedAt: string | null; updatedBy: string | null }
const onDisk = (id: string) =>
  yaml.load(fs.readFileSync(path.join(s.project.localPath, 'requirements', `${id}.yaml`), 'utf8')) as Record<string, unknown>

test("C1 / C6 — la démo sans dates : proposition dans le panneau Version, « Plus tard » n'écrit rien", async () => {
  const before = await s.invoke<Array<{ id: string; files: string[] }>>('conformity:check', s.project.localPath, true)
  const item = before.find(i => i.id === 'audit-dates')
  expect(item?.files.length ?? 0).toBeGreaterThan(0)

  // Panneau Version hors de la vue « Version produit » (/versions) : l'arbre des dépôts s'affiche.
  await s.openView('Version')
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/local-impact'))
  const notice = s.page.getByTestId('conformity-notice').first()
  await expect(notice).toContainText(`dates de création / modification de ${item!.files.length} objets`)
  const sample = item!.files[0]
  const text = fs.readFileSync(path.join(s.project.localPath, sample), 'utf8')
  // Une ligne par dépôt du workspace (composants compris) : « Plus tard » masque celle du produit.
  const notices = await s.page.getByTestId('conformity-notice').count()
  await notice.getByRole('button', { name: 'Plus tard' }).click()
  await expect(s.page.getByTestId('conformity-notice')).toHaveCount(notices - 1)
  expect(fs.readFileSync(path.join(s.project.localPath, sample), 'utf8')).toBe(text)
})

test('W1 / W2 / R2 — création et modification : dates dans le fichier ; objet non repris : null', async () => {
  const { localPath } = s.project
  const list = await s.invoke<ReqLike[]>('requirements:list', localPath)
  // R2 — une exigence de la démo, sans dates dans son fichier, est lue avec des dates nulles.
  const old = list.find(r => !('createdAt' in onDisk(r.id)))!
  expect(old).toMatchObject({ createdAt: null, createdBy: null, updatedAt: null, updatedBy: null })

  const created = await s.invoke<ReqLike>('requirements:create', localPath, { objectTypeRef: old.objectTypeRef, title: 'GH340 dates' })
  const file = onDisk(created.id)
  expect(file.createdAt).toEqual(expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/))
  expect(file.updatedAt).toBe(file.createdAt)
  expect(file.createdBy).toBeTruthy()
  expect(file.updatedBy).toBe(file.createdBy)

  await new Promise(r => setTimeout(r, 1100)) // une seconde d'écart : la date de modification avance
  await s.invoke('requirements:update', localPath, created.id, { title: 'GH340 dates modifiées' })
  const updated = onDisk(created.id)
  expect(updated).toMatchObject({ createdAt: file.createdAt, createdBy: file.createdBy, updatedBy: file.createdBy })
  expect(Date.parse(String(updated.updatedAt))).toBeGreaterThan(Date.parse(String(file.createdAt)))
  expect(fs.readFileSync(path.join(localPath, 'requirements', `${created.id}.yaml`), 'utf8')).not.toMatch(/null/)
})
