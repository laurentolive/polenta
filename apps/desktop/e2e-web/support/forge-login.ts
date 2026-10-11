import { expect, type Page, type Response } from '@playwright/test'

/**
 * GH44 — suite d'une redirection vers la forge Forgejo (connexion OIDC du client web) : formulaire
 * de connexion si la forge le demande (pas de session forge), consentement si l'application n'est
 * pas encore autorisée (pages de la forge en anglais ou en français), puis retour à
 * l'application `appBaseUrl`, chargée (bridge prêt).
 * Partagé par `s3-oidc.spec.ts` (serveur local en mode oidc) et `s4-deployed.spec.ts` (instance
 * déployée par le kit).
 *
 * GH57 — `consentShown` : vrai si la forge a servi sa page de consentement d'origine (marqueur
 * `oauth2-authorize-application-box`, absent de la page de transition du kit), relevé sur les
 * réponses HTTP et pas seulement sur un clic. Le client web déployé par le kit ne doit jamais la
 * présenter.
 */
export async function completeForgeLogin(page: Page, appBaseUrl: string, login: string, password: string): Promise<{ consentShown: boolean }> {
  let consentShown = false
  const reads: Promise<void>[] = []
  const onResponse = (response: Response) => {
    if (!new URL(response.url()).pathname.endsWith('/login/oauth/authorize') || response.status() !== 200) return
    reads.push(response.text().then(html => { if (html.includes('oauth2-authorize-application-box')) consentShown = true }, () => {}))
  }
  page.on('response', onResponse)
  const inApp = (u: URL) => u.toString().startsWith(appBaseUrl)
  const loginForm = page.getByRole('textbox', { name: /Username or email address|Nom d.utilisateur ou adresse courriel/ })
  const authorize = page.getByRole('button', { name: /^(Authorize Application|Autoriser l.application)$/ })
  for (let step = 0; step < 4; step++) {
    if (inApp(new URL(page.url())) && !page.url().includes('/auth/')) break
    await Promise.race([
      loginForm.waitFor({ timeout: 20_000 }),
      authorize.waitFor({ timeout: 20_000 }),
      page.waitForURL(u => inApp(u) && !u.pathname.startsWith('/auth/'), { timeout: 20_000 }),
    ]).catch(() => {})
    if (await loginForm.isVisible()) {
      await loginForm.fill(login)
      await page.getByRole('textbox', { name: /Password|Mot de passe/ }).fill(password)
      await page.getByRole('main').getByRole('button', { name: /^(Sign in|Connexion)$/ }).click()
    } else if (await authorize.isVisible()) {
      consentShown = true
      await authorize.click()
    }
  }
  await page.waitForURL(u => inApp(u) && !u.pathname.startsWith('/auth/'), { timeout: 30_000 })
  await expect(page.getByRole('button', { name: /^(Compte|Account)$/ }).first()).toBeVisible({ timeout: 30_000 })
  page.off('response', onResponse)
  await Promise.all(reads)
  return { consentShown }
}
