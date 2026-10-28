import { app } from 'electron'

/** Version calculée au build (scripts/app-version.ts), injectée par electron.vite.config.ts. */
declare const __POLENTA_VERSION__: string | undefined

/**
 * GH158 — version affichée et comparée par l'updater. Build packagé : celle du package.json de
 * l'asar, que scripts/package.ts réécrit avec la version du tag (extraMetadata) — la même que
 * celle de l'installeur et de latest.yml. En dev, app.getVersion() lirait le `0.0.0-dev` de
 * apps/desktop/package.json : on prend la version calculée au build.
 */
export function appVersion(): string {
  if (!app.isPackaged && typeof __POLENTA_VERSION__ !== 'undefined') return __POLENTA_VERSION__
  return app.getVersion()
}
