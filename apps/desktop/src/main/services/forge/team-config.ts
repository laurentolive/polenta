import yaml from 'js-yaml'
import type { ProjectHome, TeamConfigPreferences, TeamProject, EffectiveTeamConfig } from '@polenta/types'

/**
 * GH45 S2b — configuration Polenta par équipe, lue dans `<org>/polenta-config/config.yaml`
 * (spec §3bis). Fonctions pures : validation tolérante (une clé invalide est ignorée et signalée,
 * jamais d'exception) et résolution pour les équipes d'un utilisateur.
 */

export interface TeamConfigSection {
  updates?: 'auto' | 'managed'
  projects?: TeamProject[]
  preferences?: TeamConfigPreferences
}

export interface TeamConfig {
  defaults: TeamConfigSection
  /** Ordre du fichier conservé : il départage les préférences (première équipe qui définit la clé). */
  teams: Array<{ name: string; section: TeamConfigSection }>
}

const PROJECT_HOMES: ProjectHome[] = ['dashboard', 'requirements', 'tests', 'campaigns']

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseSection(raw: unknown, where: string, warnings: string[]): TeamConfigSection {
  const section: TeamConfigSection = {}
  if (raw === null || raw === undefined) return section
  if (!isRecord(raw)) {
    warnings.push(`${where} : objet attendu`)
    return section
  }
  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      case 'updates':
        if (value === 'auto' || value === 'managed') section.updates = value
        else warnings.push(`${where}.updates : « auto » ou « managed » attendu`)
        break
      case 'projects': {
        if (!Array.isArray(value)) { warnings.push(`${where}.projects : liste attendue`); break }
        const projects: TeamProject[] = []
        for (const item of value) {
          const repo = isRecord(item) ? item['repo'] : item
          if (typeof repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repo.trim())) {
            const label = isRecord(item) && typeof item['label'] === 'string' ? item['label'] : undefined
            projects.push({ repo: repo.trim(), ...(label ? { label } : {}) })
          } else {
            warnings.push(`${where}.projects : entrée ignorée (« organisation/projet » attendu)`)
          }
        }
        section.projects = projects
        break
      }
      case 'preferences':
        section.preferences = parsePreferences(value, `${where}.preferences`, warnings)
        break
      default:
        warnings.push(`${where} : clé inconnue « ${key} » ignorée`)
    }
  }
  return section
}

function parsePreferences(raw: unknown, where: string, warnings: string[]): TeamConfigPreferences {
  const prefs: TeamConfigPreferences = {}
  if (raw === null || raw === undefined) return prefs
  if (!isRecord(raw)) { warnings.push(`${where} : objet attendu`); return prefs }
  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      case 'language':
        if (value === 'fr' || value === 'en') prefs.language = value
        else warnings.push(`${where}.language : « fr » ou « en » attendu`)
        break
      case 'theme':
        if (value === 'light' || value === 'dark') prefs.theme = value
        else warnings.push(`${where}.theme : « light » ou « dark » attendu`)
        break
      case 'projectHome':
        if (typeof value === 'string' && (PROJECT_HOMES as string[]).includes(value)) prefs.projectHome = value as ProjectHome
        else warnings.push(`${where}.projectHome : ${PROJECT_HOMES.join(' | ')} attendu`)
        break
      // GH139 — les champs visibles par défaut sont déclarés dans schema.yaml (`defaultVisible`).
      case 'fieldVisibility':
        warnings.push(`${where}.fieldVisibility : n'est plus lu — déclarer \`defaultVisible: true\` sur les champs et types de lien de schema.yaml`)
        break
      default:
        warnings.push(`${where} : préférence inconnue « ${key} » ignorée`)
    }
  }
  return prefs
}

/** Lecture tolérante ; lève une erreur seulement si le fichier n'est pas du YAML exploitable. */
export function parseTeamConfig(text: string): { config: TeamConfig; warnings: string[] } {
  const raw = yaml.load(text)
  if (!isRecord(raw)) throw new Error('config.yaml : un objet YAML est attendu')
  const warnings: string[] = []
  if (raw['version'] !== undefined && raw['version'] !== 1) warnings.push(`version ${String(raw['version'])} inconnue (1 attendue)`)
  const config: TeamConfig = { defaults: parseSection(raw['defaults'], 'defaults', warnings), teams: [] }
  const teams = raw['teams']
  if (teams !== undefined && teams !== null) {
    if (!isRecord(teams)) warnings.push('teams : objet attendu')
    else for (const [name, section] of Object.entries(teams)) {
      config.teams.push({ name, section: parseSection(section, `teams.${name}`, warnings) })
    }
  }
  for (const key of Object.keys(raw)) {
    if (!['version', 'defaults', 'teams'].includes(key)) warnings.push(`clé inconnue « ${key} » ignorée`)
  }
  return { config, warnings }
}

/**
 * Configuration effective d'un utilisateur selon ses équipes (spec §3bis-4) :
 * projets = union (defaults puis équipes, ordre du fichier, sans doublon) ; mises à jour =
 * `managed` dès qu'une source le demande ; préférences = defaults, surchargées clé par clé par la
 * première équipe (ordre du fichier) qui les définit.
 */
export function resolveTeamConfig(config: TeamConfig, userTeams: string[]): Omit<EffectiveTeamConfig, 'teams'> {
  const member = new Set(userTeams.map(t => t.toLowerCase()))
  const sections = [config.defaults, ...config.teams.filter(t => member.has(t.name.toLowerCase())).map(t => t.section)]
  const teamSections = sections.slice(1)

  const projects: TeamProject[] = []
  const seen = new Set<string>()
  for (const s of sections) {
    for (const p of s.projects ?? []) {
      const key = p.repo.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      projects.push(p)
    }
  }

  const updates = sections.some(s => s.updates === 'managed') ? 'managed' : 'auto'

  const preferences: TeamConfigPreferences = {}
  const keys = ['language', 'theme', 'projectHome'] as const
  for (const key of keys) {
    const fromTeam = teamSections.find(s => s.preferences?.[key] !== undefined)?.preferences?.[key]
    const value = fromTeam ?? config.defaults.preferences?.[key]
    if (value !== undefined) (preferences as Record<string, unknown>)[key] = value
  }
  return { projects, updates, preferences }
}
