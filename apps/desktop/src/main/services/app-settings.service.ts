import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import type { AppSettings } from '@polenta/types'

const DEFAULTS: AppSettings = { autoCheckUpdates: true }

/**
 * GH26 — préférences de l'application (pas du projet) : `userData/app-settings.json`.
 * Lecture synchrone car le main en a besoin au démarrage, avant que le renderer soit monté
 * (d'où pas de localStorage, cf. le thème). Fichier absent ou illisible → valeurs par défaut.
 */
export class AppSettingsService {
  private get filePath(): string {
    return path.join(app.getPath('userData'), 'app-settings.json')
  }

  get(): AppSettings {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Partial<AppSettings>
      return {
        autoCheckUpdates: typeof raw.autoCheckUpdates === 'boolean' ? raw.autoCheckUpdates : DEFAULTS.autoCheckUpdates,
      }
    } catch {
      return { ...DEFAULTS }
    }
  }

  set(patch: Partial<AppSettings>): AppSettings {
    const next = { ...this.get(), ...patch }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify(next, null, 2), 'utf-8')
    return next
  }
}
