import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import { setupSession } from './support/session'

/**
 * GH455 — le diff d'un fichier modifié suit le disque. Le fichier est réécrit hors de l'application
 * (sans passer par un service, donc sans invalidation) pendant que le diff est ouvert : la nouvelle
 * version doit apparaître en quelques secondes, pas après le cache de 60 s.
 */
const s = setupSession()

const FILE = 'gh455-fixture/doc.yaml'

test.beforeAll(async () => {
  const { localPath } = s.project
  fs.mkdirSync(path.dirname(path.join(localPath, FILE)), { recursive: true })
  fs.writeFileSync(path.join(localPath, FILE), 'marker: v1\n')
  await s.invoke('sync:stage-all', localPath)
  await s.invoke('sync:commit', localPath, 'GH455 base')
  // Modification non commitée : le diff du répertoire de travail compare le disque au commit.
  fs.writeFileSync(path.join(localPath, FILE), 'marker: v2\n')
})

test('le diff ouvert affiche une écriture faite hors application sans attendre le cache', async () => {
  const { localPath } = s.project
  await s.page.evaluate(u => {
    history.pushState({}, '', u)
    dispatchEvent(new PopStateEvent('popstate'))
  }, s.projectUrl('/diff', { repoPath: localPath, filepath: FILE }))
  // Mode Raw : le texte du fichier est lisible d'un seul tenant (le mode Rendu découpe le YAML en cellules).
  await s.page.getByTestId('diff-mode-toggle').getByRole('button', { name: 'Raw' }).click()
  await expect(s.page.locator('body')).toContainText('marker: v2')

  fs.writeFileSync(path.join(localPath, FILE), 'marker: v3\n')

  await expect(s.page.locator('body')).toContainText('marker: v3', { timeout: 10_000 })
})
