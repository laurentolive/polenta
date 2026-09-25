import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CampaignTestRun, Parameter, RepoParameters } from '@polenta/types'
import { useTranslation } from 'react-i18next'
import { formatParamValue, substituteMarkdownParamRefs } from '@polenta/types'
import { api } from '../api'
import { ParameterEditDialog } from '../components/parameters/ParameterEditDialog'
import { ParamPicker, type ParamCandidate } from '../components/parameters/ParamPicker'

/** Résultat de la résolution d'une référence `{nom}` / `{<nœud>::nom}` (T171 §4-§5). */
export type ResolvedParamRef =
  | { status: 'ok'; key: string; display: string; parameter: Parameter; repoPath: string; readonly: boolean }
  | { status: 'unresolved'; key: string; reason: 'missing' | 'empty' | 'unknown_node'; local: boolean }

export interface ParamRefApi {
  /** Change quand les bases changent — à inclure dans les dépendances d'un cache de rendu. */
  version: number
  /** Résout une référence écrite dans un élément du repo `fromRepo` (défaut : repo du provider). */
  resolve(key: string, fromRepo?: string): ResolvedParamRef
  /** Double-clic sur une référence : édition du paramètre, ou création pour une référence
   *  locale non résolue (nom pré-rempli). */
  openParameter(key: string, fromRepo?: string): void
  /** Ouvre le sélecteur d'insertion ancré sur `anchor` ; `onPick` reçoit la clé à insérer. */
  openPicker(anchor: DOMRect, onPick: (key: string) => void): void
}

const Ctx = createContext<ParamRefApi | null>(null)

/** `null` hors d'un `ParamRefProvider` : les rendus retombent alors sur le texte brut. */
export function useParamRefs(): ParamRefApi | null {
  return useContext(Ctx)
}

interface RepoBase {
  repo: RepoParameters
  params: Map<string, Parameter>
}

type DialogState =
  | { repo: RepoParameters; parameter?: Parameter; initialName?: string; onCreated?: (name: string) => void }
  | null

export interface ParamResolver {
  version: number
  /** Bases chargées (routes d'impression : à attendre avant de signaler « prêt »). */
  ready: boolean
  bases: Map<string, RepoBase>
  resolve(key: string, fromRepo?: string): ResolvedParamRef
  /** Base visée par une clé écrite dans `fromRepo`, et nom du paramètre. */
  target(key: string, fromRepo?: string): { base: RepoBase | undefined; name: string; local: boolean }
  /** Texte avec chaque référence résolue remplacée par sa valeur (exports) ; les autres restent littérales. */
  substitute(text: string, fromRepo?: string): string
}

/**
 * T171 — résolution des références sans contexte React (vues qui construisent un export, routes
 * d'impression). Même clé de requête que la vue Paramètres, donc invalidée par ses écritures.
 */
export function useParamResolver(repoPath: string, workspaceDir: string): ParamResolver {
  const { data: repos = [], dataUpdatedAt, isSuccess, isError } = useQuery({
    queryKey: ['parameters', workspaceDir, repoPath],
    queryFn: () => api.parameters.list(repoPath, workspaceDir || undefined),
    enabled: !!repoPath,
  })
  // Une erreur de lecture des bases ne doit pas bloquer une impression : références littérales.
  const ready = isSuccess || isError

  const bases = useMemo(() => {
    const map = new Map<string, RepoBase>()
    for (const r of repos) map.set(r.repoPath, { repo: r, params: new Map(r.parameters.map(p => [p.name, p])) })
    return map
  }, [repos])

  const target = useCallback((key: string, fromRepo = repoPath) => {
    const i = key.indexOf('::')
    if (i === -1) return { base: bases.get(fromRepo), name: key, local: true }
    const mount = key.slice(0, i)
    const repo = bases.get(fromRepo)?.repo.components[mount]
    return { base: repo ? bases.get(repo) : undefined, name: key.slice(i + 2), local: false }
  }, [bases, repoPath])

  const resolve = useCallback((key: string, fromRepo = repoPath): ResolvedParamRef => {
    const { base, name, local } = target(key, fromRepo)
    if (!base) return { status: 'unresolved', key, reason: 'unknown_node', local }
    const parameter = base.params.get(name)
    if (!parameter) return { status: 'unresolved', key, reason: 'missing', local }
    const display = formatParamValue(parameter)
    if (display === null) return { status: 'unresolved', key, reason: 'empty', local }
    return { status: 'ok', key, display, parameter, repoPath: base.repo.repoPath, readonly: base.repo.readonly }
  }, [target, repoPath])

  const substitute = useCallback((text: string, fromRepo = repoPath) => substituteMarkdownParamRefs(text, key => {
    const r = resolve(key, fromRepo)
    return r.status === 'ok' ? r.display : null
  }), [resolve, repoPath])

  return useMemo(() => ({ version: dataUpdatedAt, ready, bases, resolve, target, substitute }),
    [dataUpdatedAt, ready, bases, resolve, target, substitute])
}

/**
 * T171 — résolution des références de paramètres pour les vues d'un repo (`repoPath` = repo
 * des éléments affichés). Charge les bases de tout le workspace (`parameters:list`, même clé
 * de requête que la vue Paramètres, donc invalidée par ses écritures) et monte le dialogue
 * d'édition et le sélecteur d'insertion partagés.
 */
export function ParamRefProvider({ repoPath, workspaceDir, projectId, children }: {
  repoPath: string
  workspaceDir: string
  projectId: string
  children: ReactNode
}) {
  const { version, bases, resolve, target } = useParamResolver(repoPath, workspaceDir)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [picker, setPicker] = useState<{ anchor: DOMRect; onPick: (key: string) => void } | null>(null)

  const openParameter = useCallback((key: string, fromRepo = repoPath) => {
    const { base, name, local } = target(key, fromRepo)
    if (!base) return
    const parameter = base.params.get(name)
    if (parameter) setDialog({ repo: base.repo, parameter })
    else if (local && !base.repo.readonly) setDialog({ repo: base.repo, initialName: name })
  }, [target, repoPath])

  const openPicker = useCallback((anchor: DOMRect, onPick: (key: string) => void) => {
    setPicker({ anchor, onPick })
  }, [])

  const candidates = useMemo((): ParamCandidate[] => {
    const own = bases.get(repoPath)
    if (!own) return []
    const out: ParamCandidate[] = own.repo.parameters.map(p => ({ key: p.name, parameter: p, repoLabel: own.repo.label ?? own.repo.repoName }))
    for (const [mount, repo] of Object.entries(own.repo.components)) {
      const base = bases.get(repo)
      if (!base) continue
      for (const p of base.repo.parameters) {
        out.push({ key: `${mount}::${p.name}`, parameter: p, repoLabel: base.repo.label ?? mount })
      }
    }
    return out
  }, [bases, repoPath])

  const value = useMemo<ParamRefApi>(
    () => ({ version, resolve, openParameter, openPicker }),
    [version, resolve, openParameter, openPicker],
  )

  const own = bases.get(repoPath)

  return (
    <Ctx.Provider value={value}>
      {children}
      {picker && (
        <ParamPicker
          anchor={picker.anchor}
          candidates={candidates}
          canCreate={!!own && !own.repo.readonly}
          onPick={key => { picker.onPick(key); setPicker(null) }}
          onCreate={() => {
            const onPick = picker.onPick
            setPicker(null)
            if (own) setDialog({ repo: own.repo, onCreated: name => onPick(name) })
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {dialog && (
        <ParameterEditDialog
          repoPath={dialog.repo.repoPath}
          workspaceDir={workspaceDir}
          projectId={projectId}
          parameter={dialog.parameter}
          initialName={dialog.initialName}
          readOnly={dialog.repo.readonly}
          onClose={() => setDialog(null)}
          onSaved={(_marked, name) => dialog.onCreated?.(name)}
        />
      )}
    </Ctx.Provider>
  )
}

/**
 * T171 §7 — références d'une instance de campagne : valeurs **figées** (`resolvedParams`, puis
 * saisie `paramValues`), sans accès à la base ni édition (double-clic sans effet). Le survol
 * indique l'origine de la valeur (base ou saisie à la main).
 */
export function FrozenParamRefProvider({ run, children }: {
  run: Pick<CampaignTestRun, 'resolvedParams' | 'paramValues' | 'unresolvedParams' | 'paramSourceRef'> | undefined
  children: ReactNode
}) {
  const { t } = useTranslation()
  const fromBase = t('campaignParams.fromBase')
  const manual = t('campaignParams.manual')
  const value = useMemo<ParamRefApi>(() => {
    const resolve = (key: string): ResolvedParamRef => {
      const fromRun = run?.resolvedParams?.[key]
      const typed = run?.paramValues?.[key]
      const display = fromRun ?? (typed && typed.trim() ? typed : undefined)
      if (display === undefined) {
        const reason = run?.unresolvedParams?.find(u => u.ref === key)?.reason
        return { status: 'unresolved', key, reason: reason === 'empty' || reason === 'unknown_node' ? reason : 'missing', local: !key.includes('::') }
      }
      return {
        status: 'ok', key, display,
        parameter: { name: key, value: display, description: fromRun !== undefined ? fromBase : manual },
        repoPath: '', readonly: true,
      }
    }
    return { version: 0, resolve, openParameter: () => {}, openPicker: () => {} }
  }, [run, fromBase, manual])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
