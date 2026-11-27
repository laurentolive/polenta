import * as fs from 'fs'
import * as path from 'path'
import { describe, expect, it } from 'vitest'

/**
 * GH470 — image du serveur web : git natif (GH337) en HTTPS a besoin des autorités de certification du
 * système. `ca-certificates` n'est qu'un « recommends » de git : avec `--no-install-recommends`, il doit
 * être demandé explicitement, sinon /etc/ssl/certs est absent et tout `git fetch` HTTPS échoue
 * (« server certificate verification failed. CAfile: none »). Vérifié sans construire l'image.
 */

const APP_ROOT = path.resolve(__dirname, '../../..')
const dockerfile = fs.readFileSync(path.join(APP_ROOT, 'Dockerfile.web'), 'utf8')

/** Étape d'exécution = tout ce qui suit le dernier FROM. */
const runtimeStage = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '))

describe('GH470 — autorités de certification dans l’image du serveur web', () => {
  it('l’étape d’exécution installe ca-certificates avec git', () => {
    const gitInstall = runtimeStage
      .split('\n')
      .find((line) => /apt-get install\b/.test(line) && /\bgit\b/.test(line))
    expect(gitInstall, 'aucune installation de git dans l’étape d’exécution de Dockerfile.web').toBeDefined()
    expect(gitInstall).toMatch(/\bca-certificates\b/)
  })
})
