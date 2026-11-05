import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import { E2E } from './support/env'
import { setupSession } from './support/session'
import { E2E_ORG, E2E_READONLY_ORG } from './support/fake-forgejo-api'

/**
 * GH107 sprint 3 — assistant « Ajouter un repo », repo existant (specs/GH107-tests.md A-11, A-12) :
 * seules les questions manquantes, « Ouvrir tel quel » pour un projet Polenta (décision de l'humain
 * du 2026-11-05), lecture seule. Forge locale et API Forgejo simulée (support/fake-forgejo-api.ts).
 */
const s = setupSession({ project: null })
const RUN = Date.now().toString(36)
const OPEN_FROM_REPO = /Ouvrir un projet depuis un repo|Open a project from an existing repo/

const barePath = (owner: string, name: string) => path.join(E2E.remotesDir, owner, `${name}.git`)
const bareGit = (owner: string, name: string, ...args: string[]) => execFileSync('git', ['-C', barePath(owner, name), ...args], { encoding: 'utf-8' }).trim()
const branches = (owner: string, name: string) => bareGit(owner, name, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').filter(Boolean).sort()

/** Repo nu `owner/name`, branche `branch` avec `files` (aucun fichier : repo vide). */
function seedRepo(owner: string, name: string, branch: string, files: Record<string, string>, description = '') {
  const bare = barePath(owner, name)
  fs.mkdirSync(path.dirname(bare), { recursive: true })
  execFileSync('git', ['init', '-q', '--bare', `--initial-branch=${branch}`, bare])
  fs.writeFileSync(path.join(bare, 'polenta-description'), description)
  if (Object.keys(files).length === 0) return
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gh107-seed-'))
  execFileSync('git', ['init', '-q', `--initial-branch=${branch}`, work])
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true })
    fs.writeFileSync(path.join(work, file), content)
  }
  execFileSync('git', ['-C', work, 'add', '-A'])
  execFileSync('git', ['-C', work, '-c', 'user.name=S', '-c', 'user.email=s@x', 'commit', '-qm', 'seed'])
  execFileSync('git', ['-C', work, 'push', '-q', bare, branch])
  fs.rmSync(work, { recursive: true, force: true })
}

test.beforeAll(() => {
  const file = path.join(E2E.dataDir, 'users', E2E.user.login, 'userData', 'auth.json')
  const store = JSON.parse(fs.readFileSync(file, 'utf-8')) as { accounts: Array<Record<string, unknown>> }
  for (const a of store.accounts) {
    if (a['remoteHost'] === '127.0.0.1') Object.assign(a, { provider: 'forgejo', baseUrl: E2E.gitBaseUrl })
  }
  fs.writeFileSync(file, JSON.stringify(store, null, 2))
})

const dialog = () => s.page.getByRole('form', { name: /^(Repo existant|Existing repository)$/ })

async function pickRepo(owner: string, name: string) {
  await s.invoke('workspace:clear-last-opened')
  await s.page.goto('/')
  await s.page.getByRole('button', { name: OPEN_FROM_REPO }).click()
  await s.page.getByPlaceholder(/Rechercher un projet|Search a project/).fill(`${owner}/${name}`)
  await s.page.getByRole('listbox', { name: /Projets accessibles|Accessible projects/ }).getByRole('option', { name: new RegExp(`${owner}/${name}`) }).click()
}

const POLENTA = { '.polenta/schema.yaml': 'version: 1\nnodes: []\nlinkTypes: []\n', 'requirements/R1.yaml': 'title: r\n' }

test('A-11 — repo non Polenta : seules les questions manquantes, confirmation exigée, pas d’« Ouvrir tel quel »', async () => {
  const name = `brut-${RUN}`
  seedRepo(E2E_ORG, name, 'main', { 'src/a.txt': 'a\n', 'README.md': '# brut\n' }, 'Déjà décrit')
  await pickRepo(E2E_ORG, name)
  const d = dialog()
  await expect(d.getByText(/pas encore un projet Polenta|not a Polenta project yet/)).toBeVisible({ timeout: 30_000 })
  await expect(d.getByLabel(/Branche d'intégration|Integration branch/)).toHaveValue(name)
  // Description et README présents : pas de question.
  await expect(d.getByLabel(/^Description$/)).toHaveCount(0)
  await expect(d.getByRole('button', { name: /Ouvrir tel quel|Open as is/ })).toHaveCount(0)
  const complete = d.getByRole('button', { name: /Compléter et ouvrir|Complete and open/ })
  await expect(complete).toBeDisabled()
  await d.getByRole('checkbox').check()
  await complete.click()
  await expect(s.page).toHaveURL(/projectId=/, { timeout: 60_000 })
  expect(branches(E2E_ORG, name)).toEqual([`int-${name}`, 'main'])
  expect(bareGit(E2E_ORG, name, 'symbolic-ref', '--short', 'HEAD')).toBe(`int-${name}`)
  expect(bareGit(E2E_ORG, name, 'show', `int-${name}:config/project.yaml`)).toBe(`integrationBranch: int-${name}`)
  expect(bareGit(E2E_ORG, name, 'show', `int-${name}:.gitignore`)).toContain('.polenta/tree.cache.yaml')
})

test('décision du 2026-11-05 — projet Polenta incomplet : « Ouvrir tel quel » n’écrit rien sur le serveur', async () => {
  const name = `incomplet-${RUN}`
  seedRepo(E2E_ORG, name, 'main', POLENTA)
  await pickRepo(E2E_ORG, name)
  const d = dialog()
  await expect(d.getByText(/n'est pas complet|is not complete/)).toBeVisible({ timeout: 30_000 })
  await expect(d.getByRole('checkbox')).toHaveCount(0)
  await d.getByRole('button', { name: /Ouvrir tel quel|Open as is/ }).click()
  await expect(s.page).toHaveURL(/projectId=/, { timeout: 60_000 })
  expect(branches(E2E_ORG, name)).toEqual(['main'])
  expect(bareGit(E2E_ORG, name, 'rev-list', '--count', 'main')).toBe('1')
})

test('même projet, « Compléter » : int-* créée, README commité, description sur le serveur', async () => {
  const name = `complete-moi-${RUN}`
  seedRepo(E2E_ORG, name, 'main', POLENTA)
  await pickRepo(E2E_ORG, name)
  const d = dialog()
  await d.getByLabel(/^Description$/).fill('Décrit depuis l’assistant', { timeout: 30_000 })
  await d.getByRole('button', { name: /Compléter et ouvrir|Complete and open/ }).click()
  await expect(s.page).toHaveURL(/projectId=/, { timeout: 60_000 })
  expect(bareGit(E2E_ORG, name, 'show', `int-${name}:README.md`)).toBe(`# ${name}\n\nDécrit depuis l’assistant`)
  expect(bareGit(E2E_ORG, name, 'show', `int-${name}:requirements/R1.yaml`)).toBe('title: r')
  expect(fs.readFileSync(path.join(barePath(E2E_ORG, name), 'polenta-description'), 'utf-8')).toBe('Décrit depuis l’assistant')
})

test('A-02 — repo complet : ouvert sans aucune question', async () => {
  const name = `complet-${RUN}`
  seedRepo(E2E_ORG, name, `int-${name}`, { ...POLENTA, 'README.md': '# c\n', 'config/project.yaml': `integrationBranch: int-${name}\n` }, 'Décrit')
  const before = bareGit(E2E_ORG, name, 'rev-parse', `int-${name}`)
  await pickRepo(E2E_ORG, name)
  await expect(s.page).toHaveURL(/projectId=/, { timeout: 60_000 })
  expect(bareGit(E2E_ORG, name, 'rev-parse', `int-${name}`)).toBe(before)
})

test('lecture seule : projet Polenta incomplet ouvert sans question, repo quelconque refusé avec la liste', async () => {
  const polenta = `ro-polenta-${RUN}`
  seedRepo(E2E_READONLY_ORG, polenta, 'main', POLENTA)
  await pickRepo(E2E_READONLY_ORG, polenta)
  await expect(s.page).toHaveURL(/projectId=/, { timeout: 60_000 })
  expect(branches(E2E_READONLY_ORG, polenta)).toEqual(['main'])

  const brut = `ro-brut-${RUN}`
  seedRepo(E2E_READONLY_ORG, brut, 'main', { 'src/a.txt': 'a\n' })
  await pickRepo(E2E_READONLY_ORG, brut)
  await expect(dialog().getByText(/pas le droit d'écriture|no write access/)).toBeVisible({ timeout: 30_000 })
  await expect(dialog().getByText(/l'initialisation Polenta|the Polenta initialization/)).toBeVisible()
  await expect(dialog().getByRole('button', { name: /Compléter et ouvrir|Complete and open|Ouvrir tel quel|Open as is/ })).toHaveCount(0)
  await s.page.keyboard.press('Escape')
})

test('A-01 — repo vide : formulaire complet pré-rempli, même état final qu’un repo neuf', async () => {
  const name = `vide-${RUN}`
  seedRepo(E2E_ORG, name, 'main', {}, 'Déjà décrit')
  await pickRepo(E2E_ORG, name)
  const w = s.page.getByRole('form', { name: /Ajouter un repo|Add a repository/ })
  await expect(w.getByLabel(/^Description$/)).toHaveValue('Déjà décrit', { timeout: 30_000 })
  await expect(w.getByRole('combobox', { name: /Propriétaire|Owner/ })).toHaveCount(0)
  await w.getByRole('button', { name: /Initialiser le repo|Initialize the repository/ }).click()
  await expect(s.page).toHaveURL(/projectId=/, { timeout: 60_000 })
  expect(branches(E2E_ORG, name)).toEqual([`int-${name}`])
  expect(bareGit(E2E_ORG, name, 'rev-list', '--count', `int-${name}`)).toBe('1')
})

test('A-12 — URL : sur l’hôte du compte, inspection ; sur un autre hôte, flux direct sans inspection', async () => {
  const name = `par-url-${RUN}`
  seedRepo(E2E_ORG, name, 'main', POLENTA)
  await s.invoke('workspace:clear-last-opened')
  await s.page.goto('/')
  await s.page.getByRole('button', { name: OPEN_FROM_REPO }).click()
  await s.page.getByRole('button', { name: /Saisir une URL|Enter a URL/ }).click()
  await s.page.getByPlaceholder(/org\/projet\.git/).fill(`${E2E.gitBaseUrl}/${E2E_ORG}/${name}.git`)
  await s.page.getByRole('button', { name: /^(Continuer|Continue)$/ }).click()
  await expect(dialog().getByText(/n'est pas complet|is not complete/)).toBeVisible({ timeout: 30_000 })
  await s.page.keyboard.press('Escape')
  await expect(dialog()).toHaveCount(0)

  // Autre hôte : aucun compte, donc pas d'inspection. Le garde d'URL du serveur web refuse ce clone.
  s.allowConsoleErrors(/.*/)
  const requests: string[] = []
  s.page.on('request', r => { if (r.postData()?.includes('forge:inspect-repo') || r.url().includes('forge:inspect-repo')) requests.push(r.url()) })
  await s.page.getByRole('button', { name: OPEN_FROM_REPO }).click()
  await s.page.getByRole('button', { name: /Saisir une URL|Enter a URL/ }).click()
  await s.page.getByPlaceholder(/org\/projet\.git/).fill('http://autre-hote.invalid/org/repo.git')
  await s.page.getByRole('button', { name: /^(Continuer|Continue)$/ }).click()
  await expect(s.page.locator('.text-status-danger').first()).toBeVisible({ timeout: 30_000 })
  await expect(dialog()).toHaveCount(0)
  expect(requests).toEqual([])
})
