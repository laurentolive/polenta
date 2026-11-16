import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import { E2E } from './support/env'
import { setupSession } from './support/session'
import { E2E_ORG } from './support/fake-forgejo-api'

/**
 * GH354 — « Créer le repo sur le serveur » et membres : un compte inconnu est refusé avant toute
 * création ; un refus après création (droits) laisse continuer, l'écran dit que le repo est créé.
 * Forge locale des e2e et son API Forgejo simulée (logins `inconnu…` et `refuse…`).
 */
const s = setupSession({ project: null })
const RUN = Date.now().toString(36)
const HOME_CREATE = /Créer un nouveau projet|Create a new project/

test.beforeAll(() => {
  // Compte de la session déclaré Forgejo, API sur la forge locale (comme gh107-create).
  const file = path.join(E2E.dataDir, 'users', E2E.user.login, 'userData', 'auth.json')
  const store = JSON.parse(fs.readFileSync(file, 'utf-8')) as { accounts: Array<Record<string, unknown>> }
  for (const a of store.accounts) {
    if (a['remoteHost'] === '127.0.0.1') Object.assign(a, { provider: 'forgejo', baseUrl: E2E.gitBaseUrl })
  }
  fs.writeFileSync(file, JSON.stringify(store, null, 2))
})

const wizard = () => s.page.getByRole('form', { name: /Ajouter un repo|Add a repository/ })

async function fillWizard(name: string, member: string) {
  // Sans cela, `/` rouvrirait le projet créé par le test précédent au lieu de l'accueil.
  await s.invoke('workspace:clear-last-opened')
  await s.page.goto('/')
  await s.page.getByRole('button', { name: HOME_CREATE }).click()
  await s.page.getByLabel(/Nom du projet|Project name/).fill(name)
  await s.page.getByRole('button', { name: /^(Continuer|Continue)$/ }).click()
  const w = wizard()
  await w.getByRole('combobox', { name: /Propriétaire|Owner/ }).selectOption(E2E_ORG)
  await w.getByLabel(/^Description$/).fill('GH354')
  await w.getByLabel(/Compte à ajouter|Account to add/).fill(member)
  await w.getByRole('button', { name: /^(Ajouter|Add)$/ }).click()
  await expect(w.getByText(/Nom disponible|Name available/)).toBeVisible()
  await w.getByRole('button', { name: /^(Créer|Create)$/ }).click()
}

test('compte inconnu : refusé dans l’assistant, aucun repo créé sur le serveur', async () => {
  const name = `gh354-a-${RUN}`
  await fillWizard(name, 'inconnu-354')
  await expect(wizard().getByText(/inconnu-354 : Aucun compte « inconnu-354 » sur le serveur/)).toBeVisible({ timeout: 30_000 })
  await expect(wizard().getByText(/rien n'a été créé/)).toBeVisible()
  expect(fs.existsSync(path.join(E2E.remotesDir, E2E_ORG, `${name}.git`))).toBe(false)
  // L'utilisateur corrige la liste : retrait du membre, la création passe.
  await wizard().getByRole('list', { name: /Membres ajoutés|Added members/ }).getByRole('button').first().click()
  await wizard().getByRole('button', { name: /^(Créer|Create)$/ }).click()
  await expect(s.page).toHaveURL(/projectId=/, { timeout: 60_000 })
  expect(fs.existsSync(path.join(E2E.remotesDir, E2E_ORG, `${name}.git`))).toBe(true)
})

test('ajout refusé après création : « Repo créé », Continuer ouvre le projet, compte non révoqué', async () => {
  const name = `gh354-b-${RUN}`
  await fillWizard(name, 'refuse-354')
  const result = s.page.getByRole('dialog', { name: /Repo créé, points à traiter|Repository created, with points to handle/ })
  await expect(result).toBeVisible({ timeout: 60_000 })
  await expect(result.getByText(/refuse-354 : .*HTTP 403/)).toBeVisible()
  await expect(result.getByText(/paramètres du repo|repository settings/)).toBeVisible()
  await result.getByRole('button', { name: /^(Continuer|Continue)$/ }).click()
  await expect(s.page).toHaveURL(/projectId=/, { timeout: 60_000 })
  // Le compte reste utilisable : la liste des propriétaires se recharge sans demande de reconnexion.
  const [account] = await s.invoke<Array<{ key: string }>>('forge:repo-accounts')
  const owners = await s.invoke<{ owners: Array<{ name: string }> }>('forge:owners', account.key)
  expect(owners.owners.map(o => o.name)).toContain(E2E_ORG)
})
