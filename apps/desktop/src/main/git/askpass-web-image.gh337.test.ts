import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, describe, expect, it } from 'vitest'

import { askpassDir } from './askpass'

/**
 * GH337 P1 — image du serveur web (Docker) : les shims d'askpass doivent être dans l'image, à un chemin que
 * `askpassDir()` connaît (`POLENTA_WEB_RESOURCES_DIR/git/askpass`). Vérifié sans construire l'image : la
 * configuration de build (apps/desktop/Dockerfile.web) donne le chemin de copie, puis le dossier est
 * reproduit dans un répertoire temporaire et `askpassDir()` doit le trouver avec la seule variable d'env.
 */

const APP_ROOT = path.resolve(__dirname, '../../..')
const SHIM_SOURCE = path.join(APP_ROOT, 'src/main/git/askpass')
const dockerfile = fs.readFileSync(path.join(APP_ROOT, 'Dockerfile.web'), 'utf8')

const cpLine = /cp -r (src\/main\/git\/askpass) (\/out\/app\/[^\s]*)/.exec(dockerfile)
const runtimeResources = /POLENTA_WEB_RESOURCES_DIR=(\S+)/.exec(dockerfile)?.[1]

/** Destination de la copie des shims dans la phase de build (`/out/app/...`). */
const buildCopyDest = cpLine?.[2] ?? ''
/** Même chemin dans l'image d'exécution (`COPY --from=build /out/app /app`). */
const imageShimDir = '/app/' + buildCopyDest.slice('/out/app/'.length).replace(/\/$/, '') + '/askpass'

let previousEnv: string | undefined
let previousResourcesPath: unknown
afterEach(() => {
  if (previousEnv === undefined) delete process.env.POLENTA_WEB_RESOURCES_DIR
  else process.env.POLENTA_WEB_RESOURCES_DIR = previousEnv
  Object.defineProperty(process, 'resourcesPath', { value: previousResourcesPath, configurable: true, writable: true })
})

describe('GH337 P1 — shims askpass dans l’image du serveur web', () => {
  it('Dockerfile.web copie le dossier des shims vers resources/git/askpass de l’image', () => {
    expect(cpLine, 'aucune copie de src/main/git/askpass dans Dockerfile.web').not.toBeNull()
    expect(path.resolve(APP_ROOT, cpLine![1])).toBe(SHIM_SOURCE)
    expect(dockerfile).toContain('COPY --from=build /out/app /app')
    expect(imageShimDir).toBe('/app/resources/git/askpass')
  })

  it('POLENTA_WEB_RESOURCES_DIR de l’image désigne le dossier où se trouvent les shims copiés', () => {
    expect(runtimeResources).toBe('/app/resources')
    expect(imageShimDir).toBe(`${runtimeResources}/git/askpass`)
  })

  it('askpassDir() trouve les shims avec POLENTA_WEB_RESOURCES_DIR seul (pas de process.resourcesPath)', () => {
    expect(fs.existsSync(path.join(SHIM_SOURCE, 'askpass.sh'))).toBe(true)
    expect(fs.existsSync(path.join(SHIM_SOURCE, 'askpass.js'))).toBe(true)

    // Reproduit la copie du Dockerfile dans un dossier temporaire (même arborescence relative à /out/app).
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gh337-askpass-web-'))
    try {
      const resources = path.join(appRoot, 'resources')
      const target = path.join(resources, 'git', 'askpass')
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.cpSync(SHIM_SOURCE, target, { recursive: true })

      previousEnv = process.env.POLENTA_WEB_RESOURCES_DIR
      previousResourcesPath = process.resourcesPath
      Object.defineProperty(process, 'resourcesPath', { value: undefined, configurable: true, writable: true })
      process.env.POLENTA_WEB_RESOURCES_DIR = resources

      expect(askpassDir()).toBe(target)
    } finally {
      fs.rmSync(appRoot, { recursive: true, force: true })
    }
  })
})
