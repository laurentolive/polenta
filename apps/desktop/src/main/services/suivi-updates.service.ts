import type { SuiviUpdate, SuiviUpdatesList } from '@polenta/types'
import { findQueryTemplate, findWidgetTemplate } from '@polenta/types'
import type { GitService } from './git.service'
import type { DashboardLibraryService } from './dashboard-library.service'
import type { DashboardSeedService } from './dashboard-seed.service'
import type { SavedQueriesService } from './saved-queries.service'
import type { DashboardsService } from './dashboards.service'
import { isReadonlyBranch } from './readonly-branch.util'
import { readPref, writePref } from './pref-store.util'

/** Clé du `.{user}.pref` : propositions masquées par « Ignorer » (`<id>@<version>`). */
const IGNORED_PREF_KEY = 'suiviIgnoredUpdates'

const SEED_WIDGET_SUMMARY = {
  timeline: {
    fr: 'Nouveau widget du dashboard « Campagnes » : aire empilée des étapes d\'avancement (préparation, prêt, résultats), jour par jour, des campagnes en cours.',
    en: 'New widget of the "Campaigns" dashboard: stacked area of progress steps (preparation, ready, results), day by day, for campaigns in progress.',
  },
} as const

const ignoreKey = (u: Pick<SuiviUpdate, 'id' | 'toVersion'>) => `${u.id}@${u.toVersion}`

/**
 * GH74 §6.3 — bandeau des mises à jour de la vue Suivi : fichiers de la bibliothèque de départ,
 * widgets ajoutés au seed « Campagnes », nouvelles versions de modèle des objets des seeds. Rien n'est
 * appliqué sans action ; « Ignorer » masque une version pour l'utilisateur.
 */
export class SuiviUpdatesService {
  constructor(
    private readonly git: GitService,
    private readonly library: DashboardLibraryService,
    private readonly seed: DashboardSeedService,
    private readonly savedQueries: SavedQueriesService,
    private readonly dashboards: DashboardsService,
  ) {}

  async list(repoPath: string, username: string, locale?: string): Promise<SuiviUpdatesList> {
    const all = await this.collect(repoPath, username, locale)
    const ignored = new Set(this.ignored(repoPath, username))
    const branch = await this.git.currentBranch(repoPath).catch(() => '')
    return { updates: all.map((a) => a.update).filter((u) => !ignored.has(ignoreKey(u))), readOnly: isReadonlyBranch(branch) }
  }

  /** Applique les propositions demandées (identifiants de `list`), dans l'ordre reçu. */
  async apply(repoPath: string, username: string, ids: readonly string[], locale?: string): Promise<void> {
    const branch = await this.git.currentBranch(repoPath).catch(() => '')
    if (isReadonlyBranch(branch)) throw new Error('[SUIVI_READ_ONLY] Branche en lecture seule : mises à jour non applicables.')
    const available = new Map((await this.collect(repoPath, username, locale)).map((a) => [a.update.id, a]))
    // Toutes vérifiées avant la première écriture : une liste périmée n'applique rien à moitié.
    const unknown = ids.filter((id) => !available.has(id))
    if (unknown.length) throw new Error(`Mise à jour inconnue ou déjà appliquée : ${unknown.join(', ')} — liste rafraîchie, rien n'a été appliqué.`)
    for (const id of ids) {
      const item = available.get(id)!
      await item.apply()
      // Noté tout de suite : un échec plus loin ne doit pas faire reproposer un fichier copié.
      if (item.libraryFile) await this.seed.recordLibraryFiles(repoPath, [item.libraryFile])
    }
  }

  ignore(repoPath: string, username: string, id: string, toVersion: number): void {
    const pref = readPref(repoPath, username)
    const ignored = new Set(this.ignored(repoPath, username))
    ignored.add(ignoreKey({ id, toVersion }))
    writePref(repoPath, username, { ...pref, [IGNORED_PREF_KEY]: [...ignored].sort() })
  }

  private ignored(repoPath: string, username: string): string[] {
    const v = readPref(repoPath, username)[IGNORED_PREF_KEY]
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  }

  private async collect(repoPath: string, username: string, locale?: string): Promise<{ update: SuiviUpdate; apply: () => Promise<void>; libraryFile?: string }[]> {
    const out: { update: SuiviUpdate; apply: () => Promise<void>; libraryFile?: string }[] = []
    const status = await this.seed.readStatusMarker(repoPath)

    for (const u of await this.library.listLibraryUpdates(repoPath, status?.library ?? [])) {
      out.push({
        update: {
          id: `library:${u.file.repoPath}`, kind: 'library', title: u.file.repoPath,
          ...(u.fromVersion !== undefined ? { fromVersion: u.fromVersion } : {}),
          toVersion: u.toVersion, summary: u.summary, shared: true,
        },
        apply: () => this.library.writeShipped(repoPath, u.file.repoPath),
        libraryFile: u.file.repoPath,
      })
    }

    for (const p of await this.seed.proposedSeedWidgets(repoPath, username)) {
      out.push({
        update: {
          id: `seed-widget:${p.key}`, kind: 'seed-widget', title: p.dashboardTitle,
          toVersion: 1, summary: SEED_WIDGET_SUMMARY[p.key as keyof typeof SEED_WIDGET_SUMMARY] ?? { fr: p.key, en: p.key }, shared: false,
        },
        apply: () => this.seed.addProposedSeedWidget(repoPath, username, p.key, locale),
      })
    }

    // Objets des seeds (Status partagé, Campagnes de l'utilisateur) restés au code de leur modèle.
    const campaigns = this.seed.campaignsSeedMarker(repoPath, username)
    const queryIds = [...(status?.queries ?? []), ...Object.values(campaigns?.queries ?? {})]
    for (const id of queryIds) {
      const q = id ? await this.savedQueries.findOne(repoPath, username, id) : null
      if (!q?.template || !q.state.templateUpdate || q.state.customized || q.state.readOnly) continue
      const template = q.template
      out.push({
        update: {
          id: `template:query:${q.id}`, kind: 'template', title: q.title, fromVersion: template.version,
          toVersion: q.state.templateUpdate, summary: templateSummary(findQueryTemplate(template.id)?.label), shared: q.scope === 'shared',
        },
        apply: async () => { await this.savedQueries.update(repoPath, username, q.id, { template: { id: template.id, params: template.params } }) },
      })
    }
    for (const dashboardId of [status?.dashboardId, campaigns?.dashboardId]) {
      const d = dashboardId ? await this.dashboards.get(repoPath, username, dashboardId) : null
      if (!d || d.state.readOnly) continue
      for (const w of d.widgets) {
        if (!w.template || !w.state.templateUpdate || w.state.customized) continue
        const template = w.template
        out.push({
          update: {
            id: `template:widget:${d.id}/${w.id}`, kind: 'template', title: `${d.title} — ${w.title}`, fromVersion: template.version,
            toVersion: w.state.templateUpdate, summary: templateSummary(findWidgetTemplate(template.id)?.label), shared: d.scope === 'shared',
          },
          apply: async () => { await this.dashboards.updateWidget(repoPath, username, d.id, w.id, { template: { id: template.id, params: template.params } }) },
        })
      }
    }
    return out
  }
}

function templateSummary(label: { fr: string; en: string } | undefined): { fr: string; en: string } {
  return {
    fr: `Nouvelle version du modèle « ${label?.fr ?? '?'} » : code régénéré depuis ses paramètres.`,
    en: `New version of the "${label?.en ?? '?'}" template: code regenerated from its parameters.`,
  }
}
