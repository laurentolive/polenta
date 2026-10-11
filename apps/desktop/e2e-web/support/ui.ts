import { expect, type Page } from '@playwright/test'

/** Libellés de l'application dans les deux langues (la configuration d'équipe peut imposer l'anglais). */
export const LABELS = {
  publish: /^(Publier|Publish)$/,
  changeTitle: /Titre de la modification|Title of the change/,
  staleState: /L'état a changé|State has changed/,
}

/**
 * Publier depuis la barre de titre, comme un utilisateur : ouvre le popover, saisit le titre,
 * confirme. Si le popover signale que l'état a changé entre son ouverture et la confirmation (une
 * écriture asynchrone vient de se terminer), il le referme et recommence, comme l'interface le
 * demande (« fermez et réessayez »). Ne vérifie pas l'issue : à chaque test de l'attendre (forge,
 * popup de conflit, bannière…).
 */
export async function publish(page: Page, title: string, { attempts = 3 } = {}): Promise<void> {
  for (let i = 1; ; i++) {
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: LABELS.publish }).first().click()
    await page.getByPlaceholder(LABELS.changeTitle).fill(title)
    const stale = page.getByText(LABELS.staleState)
    // Le popover relit l'état des repos à l'ouverture : laisser ce contrôle aboutir.
    await page.waitForTimeout(500)
    if (await stale.isVisible()) {
      if (i >= attempts) await expect(stale, 'état du repo instable').toHaveCount(0)
      await page.waitForTimeout(1000)
      continue
    }
    await page.getByRole('button', { name: LABELS.publish }).last().click()
    return
  }
}
