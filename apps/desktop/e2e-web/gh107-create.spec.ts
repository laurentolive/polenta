import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import { E2E } from './support/env'
import { setupSession } from './support/session'
import { E2E_ORG, E2E_READONLY_ORG } from './support/fake-forgejo-api'

/**
 * GH107 sprint 2 — assistant « Ajouter un repo », mode Nouveau repo (specs/GH107-tests.md C-09 à
 * C-13), contre la forge locale des e2e et son API Forgejo simulée (support/fake-forgejo-api.ts).
 * Le compte de la session est déclaré comme compte Forgejo de cette forge.
 */
const s = setupSession({ project: null })
const RUN = Date.now().toString(36)
const HOME_CREATE = /Créer un nouveau projet|Create a new project/

const bareGit = (owner: string, repo: string, ...args: string[]) =>
  execFileSync('git', ['-C', path.join(E2E.remotesDir, owner, `${repo}.git`), ...args], { encoding: 'utf-8' }).trim()

test.beforeAll(async () => {
  // Compte de la session (mode dev, sans type de forge) déclaré Forgejo, API sur la forge locale.
  const file = path.join(E2E.dataDir, 'users', E2E.user.login, 'userData', 'auth.json')
  const store = JSON.parse(fs.readFileSync(file, 'utf-8')) as { accounts: Array<Record<string, unknown>> }
  for (const a of store.accounts) {
    if (a['remoteHost'] === '127.0.0.1') Object.assign(a, { provider: 'forgejo', baseUrl: E2E.gitBaseUrl })
  }
  fs.writeFileSync(file, JSON.stringify(store, null, 2))
  // Repo déjà pris dans l'organisation (C-09).
  await fetch(`${E2E.gitBaseUrl}/api/v1/orgs/${E2E_ORG}/repos`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `pris-${RUN}`, description: 'déjà là', private: true, auto_init: false, default_branch: 'main' }),
  })
})

const wizard = () => s.page.getByRole('form', { name: /Ajouter un repo|Add a repository/ })

async function openWizard(name: string) {
  await s.page.goto('/')
  await s.page.getByRole('button', { name: HOME_CREATE }).click()
  await s.page.getByLabel(/Nom du projet|Project name/).fill(name)
  await expect(s.page.getByRole('radio', { name: /Sur le serveur|On the server/ })).toBeChecked()
  await s.page.getByRole('button', { name: /^(Continuer|Continue)$/ }).click()
  await expect(wizard()).toBeVisible()
}

test('C-11 — propriétaires : le compte et l’organisation où il peut créer, pas celle en lecture', async () => {
  await openWizard(`gh107-proj-${RUN}`)
  const owner = wizard().getByRole('combobox', { name: /Propriétaire|Owner/ })
  await expect(owner.locator('option')).toHaveText([/e2e \(votre compte\)|e2e \(your account\)/, new RegExp(E2E_ORG)])
  await expect(owner.locator('option', { hasText: E2E_READONLY_ORG })).toHaveCount(0)
  await s.page.keyboard.press('Escape')
})

test('C-09 / C-10 — nom pris signalé pendant la saisie ; bouton désactivé sans description ou avec une branche invalide', async () => {
  const name = `gh107-proj-${RUN}`
  await openWizard(name)
  const w = wizard()
  await w.getByRole('combobox', { name: /Propriétaire|Owner/ }).selectOption(E2E_ORG)
  const create = w.getByRole('button', { name: /^(Créer|Create)$/ })
  // Branche pré-remplie avec le nom.
  await expect(w.getByLabel(/Branche d'intégration|Integration branch/)).toHaveValue(name)
  await expect(w.getByText(/Nom disponible|Name available/)).toBeVisible()
  await expect(create).toBeDisabled()
  await w.getByLabel(/^Description$/).fill('Projet créé par l’assistant')
  await expect(create).toBeEnabled()
  await w.getByLabel(/Branche d'intégration|Integration branch/).fill('a b')
  await expect(w.getByText(/Après « int- »|After “int-”/)).toBeVisible()
  await expect(create).toBeDisabled()
  await w.getByLabel(/Branche d'intégration|Integration branch/).fill(name)
  await w.getByLabel(/Nom du repo|Repository name/).fill(`pris-${RUN}`)
  await expect(w.getByText(new RegExp(`${E2E_ORG}/pris-${RUN} existe déjà|${E2E_ORG}/pris-${RUN} already exists`))).toBeVisible()
  await expect(create).toBeDisabled()
  await s.page.keyboard.press('Escape')
})

test('C-12 — création : repo distant sur int-x seulement, branche par défaut, membres, projet ouvert', async () => {
  const name = `gh107-proj-${RUN}`
  await openWizard(name)
  const w = wizard()
  await w.getByRole('combobox', { name: /Propriétaire|Owner/ }).selectOption(E2E_ORG)
  await w.getByLabel(/^Description$/).fill('Projet créé par l’assistant')
  await w.getByLabel(/Compte à ajouter|Account to add/).fill('ann')
  await w.getByRole('button', { name: /^(Ajouter|Add)$/ }).click()
  await w.getByRole('combobox', { name: /Équipe à ajouter|Team to add/ }).selectOption('devs')
  await w.getByRole('button', { name: /Ajouter l'équipe|Add team/ }).click()
  await expect(w.getByRole('list', { name: /Membres ajoutés|Added members/ }).getByRole('listitem')).toHaveCount(2)
  await expect(w.getByText(/Nom disponible|Name available/)).toBeVisible()
  await w.getByRole('button', { name: /^(Créer|Create)$/ }).click()
  await expect(s.page).toHaveURL(/projectId=/, { timeout: 60_000 })

  expect(bareGit(E2E_ORG, name, 'for-each-ref', '--format=%(refname:short)', 'refs/heads')).toBe(`int-${name}`)
  expect(bareGit(E2E_ORG, name, 'symbolic-ref', '--short', 'HEAD')).toBe(`int-${name}`)
  expect(bareGit(E2E_ORG, name, 'rev-list', '--count', `int-${name}`)).toBe('1')
  expect(bareGit(E2E_ORG, name, 'show', `int-${name}:README.md`)).toBe(`# ${name}\n\nProjet créé par l’assistant`)
  expect(bareGit(E2E_ORG, name, 'show', `int-${name}:config/project.yaml`)).toBe(`integrationBranch: int-${name}`)
  const members = await (await fetch(`${E2E.gitBaseUrl}/api/v1/_e2e/members/${E2E_ORG}/${name}`)).json()
  expect(members).toEqual([{ kind: 'user', name: 'ann', level: 'write' }, { kind: 'team', name: 'devs' }])
})

test('C-13 — composant depuis Structure : repo créé, URL et pin int-x dans polenta-repo.yaml', async () => {
  const comp = `gh107-comp-${RUN}`
  await s.page.locator('button[title="Projet"], button[title="Project"]').first().click()
  // Racine d'un projet neuf : libellé « Produit ».
  await s.page.locator('main').getByText('Produit', { exact: true }).first().hover({ timeout: 30_000 })
  await s.page.locator(`button[title*="gh107-proj-${RUN}"]`).first().click()
  await s.page.getByText(/^\+ (Composant|Component)$/).click()
  const dialog = s.page.locator('div.fixed').filter({ hasText: /Ajouter un composant|Add a component/ }).first()
  await dialog.getByPlaceholder('comp-motor-control').fill(comp)
  await dialog.getByRole('button', { name: /Créer le repo sur le serveur|Create the repo on the server/ }).click()
  const w = wizard()
  await expect(w.getByLabel(/Nom du repo|Repository name/)).toHaveValue(comp)
  await w.getByRole('combobox', { name: /Propriétaire|Owner/ }).selectOption(E2E_ORG)
  await w.getByLabel(/^Description$/).fill('Composant créé par l’assistant')
  await expect(w.getByText(/Nom disponible|Name available/)).toBeVisible()
  await w.getByRole('button', { name: /^(Créer|Create)$/ }).click()
  await expect(w).toHaveCount(0, { timeout: 60_000 })
  await expect(dialog.getByPlaceholder('git@github.com:org/repo.git')).toHaveValue(`${E2E.gitBaseUrl}/${E2E_ORG}/${comp}.git`)
  await expect(dialog.getByPlaceholder('main')).toHaveValue(`int-${comp}`)
  expect(bareGit(E2E_ORG, comp, 'for-each-ref', '--format=%(refname:short)', 'refs/heads')).toBe(`int-${comp}`)
  await dialog.getByRole('button', { name: /^(Ajouter|Add)$/ }).last().click()
  const workspaceDir = Buffer.from(new URL(s.page.url()).searchParams.get('projectId')!, 'base64url').toString('utf-8')
  const project = await s.invoke<{ localPath: string }>('workspace:resolve', workspaceDir)
  await expect.poll(() => {
    try { return fs.readFileSync(path.join(project.localPath, 'polenta-repo.yaml'), 'utf-8') } catch { return '' }
  }, { timeout: 30_000 }).toMatch(new RegExp(`url: ${E2E.gitBaseUrl.replace(/[.:/]/g, '\\$&')}/${E2E_ORG}/${comp}\\.git[\\s\\S]*pin: int-${comp}|pin: int-${comp}[\\s\\S]*${comp}\\.git`))
})
