import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { test, expect } from '@playwright/test'
import { E2E } from './support/env'
import { setupSession } from './support/session'
import { E2E_ORG } from './support/fake-forgejo-api'

/**
 * GH368 — complétion du login des membres (specs/GH368-tests.md E-01 à E-06), contre la forge
 * locale et son API Forgejo simulée : `e2e-org` (ann, bob) et `lecture` (carol, « Carol Martín »).
 */
const s = setupSession({ project: null })
const RUN = Date.now().toString(36)
// GH387 — fonction : `E2E.dataDir` (pile du worker) n'est connu qu'après le global setup.
const authFile = () => path.join(E2E.dataDir, 'users', E2E.user.login, 'userData', 'auth.json')
const LOGIN = /Compte à ajouter|Account to add/

test.beforeAll(() => {
  // Compte de la session déclaré Forgejo, API sur la forge locale.
  const store = JSON.parse(fs.readFileSync(authFile(), 'utf-8')) as { accounts: Array<Record<string, unknown>> }
  for (const a of store.accounts) {
    if (a['remoteHost'] === '127.0.0.1') Object.assign(a, { provider: 'forgejo', baseUrl: E2E.gitBaseUrl })
  }
  fs.writeFileSync(authFile(), JSON.stringify(store, null, 2))
})

const wizard = () => s.page.getByRole('form', { name: /Ajouter un repo|Add a repository/ })
const options = (scope: ReturnType<typeof wizard>) => scope.getByRole('listbox', { name: 'Suggestions' }).getByRole('option')

async function openWizard() {
  await s.page.goto('/')
  await s.page.getByRole('button', { name: /Créer un nouveau projet|Create a new project/ }).click()
  await s.page.getByLabel(/Nom du projet|Project name/).fill(`gh368-${RUN}`)
  await s.page.getByRole('button', { name: /^(Continuer|Continue)$/ }).click()
  await expect(wizard()).toBeVisible()
}

test('E-01 à E-05 — assistant : suggestions classées, clavier, Échap, saisie libre', async () => {
  await openWizard()
  const w = wizard()
  const input = w.getByLabel(LOGIN)
  const added = w.getByRole('list', { name: /Membres ajoutés|Added members/ })

  // E-02 — propriétaire = le compte : toutes les organisations, recherche dans le nom affiché.
  await input.fill('martin')
  await expect(options(w)).toHaveCount(1)
  await expect(options(w).first()).toContainText('Carol Martín')
  await expect(options(w).first()).toContainText('lecture')

  // E-01 — propriétaire e2e-org : ses membres d'abord.
  await w.getByRole('combobox', { name: /Propriétaire|Owner/ }).selectOption(E2E_ORG)
  await input.fill('a')
  await expect(options(w)).toHaveText([/^ann/, /^carol/])

  // E-04 — Échap ferme la liste, pas l'assistant.
  await input.press('Escape')
  await expect(w.getByRole('listbox')).toHaveCount(0)
  await expect(w).toBeVisible()

  // Liste ouverte : ↓ ↓ ↑ revient sur la première suggestion.
  await input.fill('')
  await input.fill('a')
  await input.press('ArrowDown')
  await input.press('ArrowDown')
  await expect(options(w).nth(1)).toHaveAttribute('aria-selected', 'true')
  await input.press('ArrowUp')
  await input.press('Escape')

  // E-03 — après Échap, ↓ rouvre la liste sur la première suggestion ; Entrée : ann ajoutée, champ vidé, plus proposée.
  await input.press('ArrowDown')
  await expect(options(w).first()).toHaveAttribute('aria-selected', 'true')
  await input.press('Enter')
  await expect(added.getByRole('listitem').filter({ hasText: 'ann' })).toBeVisible()
  await expect(input).toHaveValue('')
  await input.fill('a')
  await expect(options(w)).toHaveText([/^carol/])

  // Clic sur une suggestion.
  await options(w).first().click()
  await expect(added.getByRole('listitem').filter({ hasText: 'carol' })).toBeVisible()

  // E-05 — saisie libre, Entrée sans sélection.
  await input.fill('externe42')
  await expect(w.getByRole('listbox')).toHaveCount(0)
  await input.press('Enter')
  await expect(added.getByRole('listitem')).toHaveCount(3)
  await expect(added.getByRole('listitem').filter({ hasText: 'externe42' })).toBeVisible()
  await s.page.keyboard.press('Escape')
})

test('E-06 — Paramètres d’un repo personnel : suggestions présentes, clic → ajout sur la forge', async () => {
  const owner = E2E.user.login
  const name = `perso-${RUN}`
  const branch = `int-${name}`
  const bare = path.join(E2E.remotesDir, owner, `${name}.git`)
  fs.mkdirSync(path.dirname(bare), { recursive: true })
  execFileSync('git', ['init', '-q', '--bare', `--initial-branch=${branch}`, bare])
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gh368-seed-'))
  execFileSync('git', ['init', '-q', `--initial-branch=${branch}`, work])
  fs.mkdirSync(path.join(work, '.polenta'))
  fs.mkdirSync(path.join(work, 'config'))
  fs.writeFileSync(path.join(work, '.polenta/schema.yaml'), 'version: 1\nnodes: []\nlinkTypes: []\n')
  fs.writeFileSync(path.join(work, 'config/project.yaml'), `integrationBranch: ${branch}\n`)
  execFileSync('git', ['-C', work, 'add', '-A'])
  execFileSync('git', ['-C', work, '-c', 'user.name=S', '-c', 'user.email=s@x', 'commit', '-qm', 'seed'])
  execFileSync('git', ['-C', work, 'push', '-q', bare, branch])
  fs.rmSync(work, { recursive: true, force: true })

  await s.cloneAndOpen(`${owner}/${name}`, name)
  await s.openView('Projet')
  const settings = /Paramètres du repo|Repository settings/
  await s.page.getByTitle(settings).first().click()
  const m = s.page.getByRole('dialog', { name: settings })
  await expect(m).toBeVisible()

  await m.getByLabel(LOGIN).fill('b')
  await expect(options(m)).toHaveText([/^bob/])
  await options(m).first().click()
  await expect(m.getByRole('list', { name: /Collaborateurs|Collaborators/ }).getByRole('listitem').filter({ hasText: 'bob' })).toBeVisible({ timeout: 15_000 })
  const members = await (await fetch(`${E2E.gitBaseUrl}/api/v1/_e2e/members/${owner}/${name}`)).json()
  expect(members).toEqual([{ kind: 'user', name: 'bob', level: 'write' }])
})
