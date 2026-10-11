import { spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { expect, test } from '@playwright/test'

import {
  chooseServer, electronEnv, launch, launchWithConfig, loginInput, MAIN, newProfile, openAccountPanel, otpInput,
  passwordInput, signIn, stubFolderPicker,
} from './support/app'
import { admin, resetAccounts, setTeamConfig, totp, uploadSetupScript, type Accounts } from './support/forge'

/**
 * GH45 — tests d'interface du desktop contre une vraie forge du kit (specs/GH45-tests.md : S2b et
 * validation UI du sprint 2). Chaque test démarre Polenta dans un profil neuf et isolé.
 */

// Configuration d'équipe de test, posée par le compte d'exploitation (propriétaire).
const TEAM_CONFIG = `version: 1
defaults:
  updates: auto
  projects: []
  preferences: {}
teams:
  testeurs:
    projects:
      - repo: __ORG__/itest
        label: Projet de test
    preferences:
      projectHome: campaigns
  lecteurs:
    updates: managed
  auteurs:
    preferences:
      language: en
`

let A: Accounts

test.beforeAll(() => {
  uploadSetupScript()
  A = resetAccounts()
  setTeamConfig(TEAM_CONFIG.replace(/__ORG__/g, A.org))
})

const HOME_ACTION = /Créer un nouveau projet|Create a new project/
const inviteLink = (login: string) => `polenta://connect?server=${encodeURIComponent(A.baseUrl)}&login=${login}`

test('S2-1 — sans compte de forge : écran de connexion GitHub inchangé', async () => {
  const { app, page } = await launch(newProfile())
  try {
    await expect(page.locator('select option[value="https://github.com"]')).toHaveCount(1)
    await expect(page.getByRole('button', { name: /Se connecter avec GitHub|Log in with GitHub/ })).toBeVisible()
  } finally {
    await app.close()
  }
})

test('S2-2 — politique DSI (config.json) : seul le serveur de l’entreprise est proposé', async () => {
  const profile = newProfile()
  const configFile = path.join(profile, 'dsi-config.json')
  fs.writeFileSync(configFile, JSON.stringify({ defaultServer: A.baseUrl, hideGithub: true, autoUpdate: false }))
  const { app, page } = await launchWithConfig(profile, configFile)
  try {
    await expect(page.getByText(A.baseUrl, { exact: true })).toBeVisible()
    await expect(page.locator('select')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Se connecter avec GitHub|Log in with GitHub/ })).toHaveCount(0)
    await expect(loginInput(page)).toBeVisible()            // forge détectée : identifiant + mot de passe
  } finally {
    await app.close()
  }
})

test('S2b-6 — politique DSI : une invitation vers un autre serveur est ignorée, avec un message', async () => {
  const profile = newProfile()
  const configFile = path.join(profile, 'dsi-config.json')
  fs.writeFileSync(configFile, JSON.stringify({ defaultServer: A.baseUrl, hideGithub: true }))
  const { app, page } = await launchWithConfig(profile, configFile, ['polenta://connect?server=https://autre.example.org&login=jdoe'])
  try {
    await expect(page.getByText(/Lien d’invitation ignoré|Invitation link ignored/)).toBeVisible()
    await expect(page.getByText(A.baseUrl, { exact: true })).toBeVisible()
    await expect(page.locator('input[value="https://autre.example.org"]')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('S2b-6 / S2b-10 — lien d’invitation pré-rempli, jamais de connexion automatique ; langue de l’équipe puis choix personnel', async () => {
  const profile = newProfile()
  let { app, page } = await launch(profile, [inviteLink('itest-auteur')])
  try {
    await expect(loginInput(page)).toHaveValue('itest-auteur')
    await expect(page.locator(`input[value="${A.baseUrl}"]`)).toHaveCount(1)
    await expect(passwordInput(page)).toHaveValue('')
    await page.waitForTimeout(1500)
    await expect(loginInput(page)).toBeVisible()          // toujours sur la connexion : pas d'auto-connexion
    await passwordInput(page).fill(A.auteur)
    await page.getByRole('button', { name: /^(Se connecter|Log in)$/ }).click()
    // Équipe auteurs : langue par défaut « en », aucun choix personnel → interface en anglais.
    await expect(page.getByText('Create a new project')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/Projets de votre équipe|Your team’s projects/)).toHaveCount(0)
    // Choix personnel : français — il l'emporte, y compris au démarrage suivant.
    await openAccountPanel(page)
    await page.getByRole('button', { name: 'Français' }).click()
    await expect(page.getByText('Créer un nouveau projet')).toBeVisible()
    await app.close()
    ;({ app, page } = await launch(profile))
    await expect(page.getByText('Créer un nouveau projet')).toBeVisible({ timeout: 30_000 })
  } finally {
    await app.close()
  }
})

test('S2b-7 — instance unique : un second lancement transmet le lien à la fenêtre ouverte', async () => {
  const profile = newProfile()
  const { app, page } = await launch(profile)
  try {
    await expect(page.locator('select')).toBeVisible()
    const electronBin = require('electron') as unknown as string
    const second = spawn(electronBin, [MAIN, inviteLink('itest-testeur')], { env: electronEnv(profile), stdio: 'ignore' })
    await expect(loginInput(page)).toHaveValue('itest-testeur', { timeout: 30_000 })
    // La seconde instance peut s'être déjà arrêtée pendant l'attente ci-dessus : exitCode d'abord.
    const exited = second.exitCode !== null ? second.exitCode : await new Promise<number | null>(resolve => {
      const timer = setTimeout(() => resolve(-1), 20_000)
      second.on('exit', code => { clearTimeout(timer); resolve(code) })
    })
    expect(exited).not.toBe(-1)                            // la seconde instance s'est arrêtée
    expect(app.windows()).toHaveLength(1)
  } finally {
    await app.close()
  }
})

test('S2-15 — mauvais mot de passe ; compte neuf : changement de mot de passe proposé', async () => {
  const { app, page } = await launch(newProfile())
  try {
    await chooseServer(page, A.baseUrl)
    await signIn(page, 'itest-auteur', 'mauvais-mot-de-passe')
    await expect(page.getByText(/Identifiant ou mot de passe incorrect|Incorrect username or password/)).toBeVisible()
    await loginInput(page).fill('itest-neuf')
    await passwordInput(page).fill(A.neuf)
    await page.getByRole('button', { name: /^(Se connecter|Log in)$/ }).click()
    await expect(page.getByText(/Votre mot de passe est temporaire|Your password is temporary/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Changer mon mot de passe sur le serveur|Change my password on the server/ })).toBeVisible()
  } finally {
    await app.close()
  }
})

test('S2-5 — double authentification : le champ code apparaît, connexion avec le code', async () => {
  const { app, page } = await launch(newProfile())
  try {
    await chooseServer(page, A.baseUrl)
    await signIn(page, 'itest-2fa', A.twofa.password)
    await expect(otpInput(page)).toBeVisible()
    await otpInput(page).fill(totp(A.twofa.secret))
    await page.getByRole('button', { name: /^(Se connecter|Log in)$/ }).click()
    await expect(page.getByText(HOME_ACTION)).toBeVisible({ timeout: 30_000 })
  } finally {
    await app.close()
  }
})

test('S2b-8 — testeur : projets de l’équipe, ouverture sur les campagnes', async () => {
  const { app, page } = await launch(newProfile())
  try {
    await chooseServer(page, A.baseUrl)
    await signIn(page, 'itest-testeur', A.testeur)
    await expect(page.getByText('Projets de votre équipe')).toBeVisible({ timeout: 30_000 })
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-e2e-proj-'))
    await stubFolderPicker(app, folder)
    await page.getByRole('button', { name: /Projet de test/ }).click()
    await expect(page).toHaveURL(/category=campaign/, { timeout: 60_000 })
    expect(fs.existsSync(path.join(folder, 'itest', '.gitignore'))).toBe(true)
  } finally {
    await app.close()
  }
})

test('S2b-9 — lecteur : mises à jour verrouillées par la configuration de l’équipe', async () => {
  const { app, page } = await launch(newProfile())
  try {
    await chooseServer(page, A.baseUrl)
    await signIn(page, 'itest-lecteur', A.lecteur)
    await expect(page.getByText(HOME_ACTION)).toBeVisible({ timeout: 30_000 })
    await openAccountPanel(page)
    const box = page.locator('label', { hasText: /Mises à jour auto|Auto updates/ }).locator('input[type="checkbox"]')
    await expect(box).toBeDisabled()
    await expect(box).not.toBeChecked()
    await expect(page.getByText(/Configuration du serveur appliquée \(équipes : lecteurs\)/)).toBeVisible()
  } finally {
    await app.close()
  }
})

test('S2-9 / S2-11 — accès révoqué : bannière unique, « Se reconnecter » pré-rempli, bannière levée après reconnexion', async () => {
  const { app, page } = await launch(newProfile())
  try {
    await chooseServer(page, A.baseUrl)
    await signIn(page, 'itest-testeur', A.testeur)
    await expect(page.getByText('Projets de votre équipe')).toBeVisible({ timeout: 30_000 })
    admin('user disable itest-testeur')
    await stubFolderPicker(app, fs.mkdtempSync(path.join(os.tmpdir(), 'polenta-e2e-rev-')))
    await page.getByRole('button', { name: /Projet de test/ }).click()
    const banner = page.getByRole('alert').filter({ hasText: /révoqué|revoked/ })
    await expect(banner).toHaveCount(1, { timeout: 60_000 })
    await banner.getByRole('button', { name: /Se reconnecter|Sign in again/ }).click()
    await expect(page.locator(`input[value="${A.baseUrl}"]`)).toHaveCount(1)
    admin('user enable itest-testeur')
    await signIn(page, 'itest-testeur', A.testeur)
    await expect(page.getByText(HOME_ACTION)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('alert').filter({ hasText: /révoqué|revoked/ })).toHaveCount(0)
  } finally {
    admin('user enable itest-testeur')
    await app.close()
  }
})

test('S2-6 — déconnexion : retour à la connexion, y compris au démarrage suivant', async () => {
  const profile = newProfile()
  let { app, page } = await launch(profile)
  try {
    await chooseServer(page, A.baseUrl)
    await signIn(page, 'itest-lecteur', A.lecteur)
    await expect(page.getByText(HOME_ACTION)).toBeVisible({ timeout: 30_000 })
    await openAccountPanel(page)
    await expect(page.getByText(/reste visible dans vos paramètres du serveur|remains listed in your server settings/)).toBeVisible()
    await page.getByRole('button', { name: /^(Se déconnecter|Log out)$/ }).click()
    await expect(page.locator('select')).toBeVisible()
    await app.close()
    ;({ app, page } = await launch(profile))
    await expect(page.locator('select')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(HOME_ACTION)).toHaveCount(0)
  } finally {
    await app.close()
  }
})
