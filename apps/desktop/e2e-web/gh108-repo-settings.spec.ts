import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import { E2E } from './support/env'
import { setupSession } from './support/session'
import { E2E_ORG, E2E_READONLY_ORG } from './support/fake-forgejo-api'

/**
 * GH108 — fenêtre « Paramètres du repo » (specs/GH108-design.md §5, S-10 à S-14), contre la forge
 * locale et son API Forgejo simulée (support/fake-forgejo-api.ts).
 */
const s = setupSession({ project: null })
const RUN = Date.now().toString(36)
const AUTH_FILE = path.join(E2E.dataDir, 'users', E2E.user.login, 'userData', 'auth.json')
const SETTINGS = /Paramètres du repo|Repository settings/

const barePath = (owner: string, name: string) => path.join(E2E.remotesDir, owner, `${name}.git`)

function setAccount(fields: Record<string, unknown>) {
  const store = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8')) as { accounts: Array<Record<string, unknown>> }
  for (const a of store.accounts) if (a['remoteHost'] === '127.0.0.1') Object.assign(a, fields)
  fs.writeFileSync(AUTH_FILE, JSON.stringify(store, null, 2))
}

function seedRepo(owner: string, name: string) {
  const branch = `int-${name}`
  const bare = barePath(owner, name)
  fs.mkdirSync(path.dirname(bare), { recursive: true })
  execFileSync('git', ['init', '-q', '--bare', `--initial-branch=${branch}`, bare])
  fs.writeFileSync(path.join(bare, 'polenta-description'), 'Ancienne')
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gh108-seed-'))
  execFileSync('git', ['init', '-q', `--initial-branch=${branch}`, work])
  const files: Record<string, string> = {
    '.polenta/schema.yaml': 'version: 1\nnodes: []\nlinkTypes: []\n',
    'config/project.yaml': `integrationBranch: ${branch}\n`,
    'README.md': `# ${name}\n\nAncienne\n`,
  }
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true })
    fs.writeFileSync(path.join(work, file), content)
  }
  execFileSync('git', ['-C', work, 'add', '-A'])
  execFileSync('git', ['-C', work, '-c', 'user.name=S', '-c', 'user.email=s@x', 'commit', '-qm', 'seed'])
  execFileSync('git', ['-C', work, 'push', '-q', bare, branch])
  fs.rmSync(work, { recursive: true, force: true })
}

async function openProject(owner: string, name: string) {
  await s.cloneAndOpen(`${owner}/${name}`, name)
  await s.openView('Projet')
}

const modal = () => s.page.getByRole('dialog', { name: SETTINGS })

/** Ligne du repo affichée : son bouton d'ajout, présent sur toute ligne de repo. */
const repoRowReady = () => expect(s.page.locator('main button[title^="Ajouter à"], main button[title^="Add to"]').first()).toBeAttached({ timeout: 30_000 })

async function openSettings() {
  await repoRowReady()
  await s.page.getByTitle(SETTINGS).first().click()
  await expect(modal()).toBeVisible()
}

const NAME = `reglages-${RUN}`

test('S-13 — compte sans forge connue : pas d’icône', async () => {
  // Compte de la session, sans type de forge : generic.
  const name = `sans-icone-${RUN}`
  seedRepo(E2E_ORG, name)
  await openProject(E2E_ORG, name)
  await repoRowReady()
  await s.page.waitForLoadState('networkidle')
  await expect(s.page.getByTitle(SETTINGS)).toHaveCount(0)
  setAccount({ provider: 'forgejo', baseUrl: E2E.gitBaseUrl })
})

test('S-10 — passage en public : confirmation exigée, annulation sans effet, puis retour au privé', async () => {
  seedRepo(E2E_ORG, NAME)
  await openProject(E2E_ORG, NAME)
  await openSettings()
  const m = modal()
  const flag = path.join(barePath(E2E_ORG, NAME), 'polenta-public')
  await m.getByRole('radio', { name: /^(Public)$/ }).click()
  await expect(m.getByRole('alertdialog')).toContainText(/historique compris|history included/)
  await m.getByRole('alertdialog').getByRole('button', { name: /Annuler|Cancel/ }).click()
  expect(fs.existsSync(flag)).toBe(false)
  await expect(m.getByRole('radio', { name: /Privé|Private/ })).toBeChecked()

  await m.getByRole('radio', { name: /^(Public)$/ }).click()
  await m.getByRole('alertdialog').getByRole('button', { name: /Rendre public|Make public/ }).click()
  await expect(m.getByRole('radio', { name: /^(Public)$/ })).toBeChecked({ timeout: 15_000 })
  expect(fs.existsSync(flag)).toBe(true)

  await m.getByRole('radio', { name: /Privé|Private/ }).click()
  await expect(m.getByRole('radio', { name: /Privé|Private/ })).toBeChecked({ timeout: 15_000 })
  expect(fs.existsSync(flag)).toBe(false)
})

test('description : enregistrée sur la forge, README mis à jour après confirmation', async () => {
  const m = modal()
  await m.getByLabel(/^Description$/).fill('Nouvelle description')
  await m.getByRole('button', { name: /^(Enregistrer|Save)$/ }).click()
  await expect(m.getByRole('alertdialog')).toContainText(/README/, { timeout: 15_000 })
  expect(fs.readFileSync(path.join(barePath(E2E_ORG, NAME), 'polenta-description'), 'utf-8')).toBe('Nouvelle description')
  await m.getByRole('button', { name: /Mettre à jour le README|Update the README/ }).click()
  await expect(m.getByText(/README.md mis à jour et publié|README.md updated and published/)).toBeVisible({ timeout: 15_000 })
  const readme = execFileSync('git', ['-C', barePath(E2E_ORG, NAME), 'show', `int-${NAME}:README.md`], { encoding: 'utf-8' })
  expect(readme).toBe(`# ${NAME}\n\nNouvelle description\n`)
})

test('membres : ajouter (autocomplétion), changer le niveau, retirer ; dernier admin protégé ; équipe attribuée puis retirée', async () => {
  const m = modal()
  await expect(m.locator('#repo-settings-members option')).toHaveCount(2)
  await m.getByLabel(/Compte à ajouter|Account to add/).fill('ann')
  await m.getByRole('button', { name: /^(Ajouter|Add)$/ }).click()
  const list = m.getByRole('list', { name: /Collaborateurs|Collaborators/ })
  await expect(list.getByRole('listitem').filter({ hasText: 'ann' })).toBeVisible({ timeout: 15_000 })
  const ann = m.getByRole('combobox', { name: /Niveau de ann|Level of ann/ })
  await expect(ann).toHaveValue('write')
  await ann.selectOption('admin')
  await expect(ann).toHaveValue('admin', { timeout: 15_000 })

  // Dernier admin direct, aucune équipe admin : refus affiché sur sa ligne, rien n'a changé.
  await m.getByRole('button', { name: /Retirer ann|Remove ann/ }).click()
  await expect(list.getByText(/dernier administrateur direct/)).toBeVisible({ timeout: 15_000 })
  await expect(list.getByRole('listitem').filter({ hasText: 'ann' })).toBeVisible()

  await ann.selectOption('admin')
  await m.getByLabel(/Compte à ajouter|Account to add/).fill('bob')
  await m.getByRole('button', { name: /^(Ajouter|Add)$/ }).click()
  await expect(list.getByRole('listitem').filter({ hasText: 'bob' })).toBeVisible({ timeout: 15_000 })
  await m.getByRole('button', { name: /Retirer bob|Remove bob/ }).click()
  await expect(list.getByRole('listitem').filter({ hasText: 'bob' })).toHaveCount(0, { timeout: 15_000 })

  // Équipe : niveau en lecture sur Forgejo.
  await m.getByRole('combobox', { name: /Équipe à ajouter|Team to add/ }).selectOption('devs')
  await m.getByRole('button', { name: /Ajouter l'équipe|Add team/ }).click()
  const teams = m.getByRole('list', { name: /^(Équipes|Teams)$/ })
  await expect(teams.getByRole('listitem').filter({ hasText: 'devs' })).toBeVisible({ timeout: 15_000 })
  await expect(m.getByRole('combobox', { name: /Niveau de devs|Level of devs/ })).toHaveCount(0)
  await m.getByRole('button', { name: /Retirer devs|Remove devs/ }).click()
  await expect(teams.getByRole('listitem')).toHaveCount(0, { timeout: 15_000 })
})

test('S-14 — retrait de son propre accès admin : confirmation', async () => {
  const m = modal()
  await m.getByLabel(/Compte à ajouter|Account to add/).fill(E2E.user.login)
  await m.getByRole('combobox', { name: /^(Niveau|Level)$/ }).selectOption('admin')
  await m.getByRole('button', { name: /^(Ajouter|Add)$/ }).click()
  const list = m.getByRole('list', { name: /Collaborateurs|Collaborators/ })
  await expect(list.getByRole('listitem').filter({ hasText: E2E.user.login })).toBeVisible({ timeout: 15_000 })
  await m.getByRole('button', { name: new RegExp(`(Retirer|Remove) ${E2E.user.login}`) }).click()
  const confirm = m.getByRole('alertdialog')
  await expect(confirm).toContainText(/votre propre accès|your own administrator access/)
  await confirm.getByRole('button', { name: /Annuler|Cancel/ }).click()
  await expect(list.getByRole('listitem').filter({ hasText: E2E.user.login })).toBeVisible()
  await m.getByRole('button', { name: new RegExp(`(Retirer|Remove) ${E2E.user.login}`) }).click()
  await m.getByRole('alertdialog').getByRole('button', { name: /Retirer mon accès|Remove my access/ }).click()
  await expect(list.getByRole('listitem').filter({ hasText: E2E.user.login })).toHaveCount(0, { timeout: 15_000 })
  await s.page.keyboard.press('Escape')
  await expect(modal()).toHaveCount(0)
})

test('S-12 — forge injoignable : la fenêtre s’ouvre et l’indique', async () => {
  setAccount({ baseUrl: 'http://127.0.0.1:1' })
  await openSettings()
  await expect(modal().getByText(/Indisponible hors ligne|Unavailable offline/)).toBeVisible({ timeout: 30_000 })
  await s.page.keyboard.press('Escape')
  setAccount({ baseUrl: E2E.gitBaseUrl })
})

test('S-11 — compte non admin : lecture seule, sans erreur', async () => {
  const name = `lecteur-${RUN}`
  seedRepo(E2E_READONLY_ORG, name)
  await openProject(E2E_READONLY_ORG, name)
  await openSettings()
  const m = modal()
  await expect(m.getByText(/Réservé aux administrateurs du repo|Reserved for repository administrators/)).toBeVisible({ timeout: 15_000 })
  await expect(m.getByText('Ancienne')).toBeVisible()
  await expect(m.getByLabel(/^Description$/)).toHaveCount(0)
  await expect(m.getByRole('radio', { name: /Privé|Private/ })).toBeDisabled()
  await expect(m.getByLabel(/Compte à ajouter|Account to add/)).toHaveCount(0)
  await s.page.keyboard.press('Escape')
})

test('GH356 — repo personnel GitHub : pas de choix de niveau, ajout en écriture', async () => {
  // Repo personnel GitHub simulé : la réponse de `forge:repo-settings` porte le niveau imposé.
  const SETTINGS_RPC = /\/rpc\/forge(?:%3A|:)repo-settings$/
  const SET_RPC = /\/rpc\/forge(?:%3A|:)set-collaborator$/
  const sent: unknown[][] = []
  await s.page.route(SETTINGS_RPC, async route => {
    const res = await route.fetch()
    const body = await res.json() as { ok: boolean; value: Record<string, unknown> }
    await route.fulfill({ response: res, json: { ...body, value: { ...body.value, fixedCollaboratorLevel: 'write' } } })
  })
  await s.page.route(SET_RPC, async route => {
    sent.push((route.request().postDataJSON() as { args: unknown[] }).args)
    await route.continue()
  })
  try {
    const name = `perso-${RUN}`
    seedRepo(E2E_ORG, name)
    await openProject(E2E_ORG, name)
    await openSettings()
    const m = modal()
    await expect(m.getByText(/seul niveau possible sur un repo personnel GitHub|only level on a personal GitHub repository/)).toBeVisible({ timeout: 15_000 })
    await expect(m.getByRole('combobox', { name: /^(Niveau|Level)$/ })).toHaveCount(0)
    await m.getByLabel(/Compte à ajouter|Account to add/).fill('ann')
    await m.getByRole('button', { name: /^(Ajouter|Add)$/ }).click()
    const list = m.getByRole('list', { name: /Collaborateurs|Collaborators/ })
    await expect(list.getByRole('listitem').filter({ hasText: 'ann' })).toBeVisible({ timeout: 15_000 })
    expect(sent.at(-1)?.slice(1)).toEqual(['ann', 'write'])
    await expect(m.getByRole('combobox', { name: /Niveau de ann|Level of ann/ })).toHaveCount(0)
    await expect(list.getByRole('listitem').filter({ hasText: 'ann' })).toContainText(/Écriture|Write/)
    await s.page.keyboard.press('Escape')
  } finally {
    await s.page.unroute(SETTINGS_RPC)
    await s.page.unroute(SET_RPC)
  }
})
