import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, Check } from 'lucide-react'
import type { SavedView, SavedViewRef, SavedViewScope } from '@polenta/types'
import { api } from '../../api'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'
import { backdropDismiss } from '../../lib/backdropDismiss'

export interface SavedViewsMenuProps {
  repoPath: string
  username: string
  typeKey: string
  workspaceDir?: string
  /** Réglages courants de l'écran, enregistrés tels quels. */
  settings: Record<string, unknown>
  active: SavedViewRef | null
  /** Les réglages courants diffèrent-ils de ceux de cette vue ? */
  isModified: (settings: Record<string, unknown>) => boolean
  onApply: (view: SavedView & { ref: SavedViewRef }) => void
  /** Attendu avant de relire la liste : voir `busy`. */
  onActiveChange: (ref: SavedViewRef | null) => Promise<void>
  onDefaults: () => void
}

type Dialog = { kind: 'save-as' } | { kind: 'rename' } | { kind: 'delete' } | null

function errorKey(message: string): string {
  if (message.includes('VIEW_NAME_TAKEN')) return 'errorTaken'
  if (message.includes('VIEW_NAME_INVALID')) return 'errorInvalid'
  if (message.includes('VIEW_NOT_FOUND')) return 'errorNotFound'
  if (message.includes('VIEWS_UNREADABLE')) return 'errorUnreadable'
  if (message.includes('READONLY_REPO')) return 'errorReadonly'
  return ''
}

/**
 * GH203 — liste des vues enregistrées près du ⚙️. Ne connaît pas le contenu de `settings` : l'écran
 * qui l'utilise le fournit et l'applique, ce qui permet de la réutiliser ailleurs (#204).
 */
export function SavedViewsMenu({ repoPath, username, typeKey, workspaceDir, settings, active, isModified, onApply, onActiveChange, onDefaults }: SavedViewsMenuProps) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [error, setError] = useState<string | null>(null)
  // Écriture en cours : le watcher peut relire la liste avant que `activeView` soit à jour, et
  // l'oubli de la vue active ci-dessous ne doit pas se déclencher sur cet état intermédiaire.
  const [busy, setBusy] = useState(false)

  const queryKey = ['saved-views', repoPath, username, typeKey, workspaceDir ?? '']
  const { data: list, isError: listFailed } = useQuery({
    queryKey,
    queryFn: () => api.views.list(repoPath, username, typeKey, workspaceDir),
  })

  const views = (scope: SavedViewScope) => (scope === 'personal' ? list?.personal : list?.team) ?? []
  const activeView = active ? views(active.scope).find(v => v.name === active.name) : undefined
  const modified = !!activeView && isModified(activeView.settings)
  const teamWritable = !!list && !list.teamReadonly && !list.teamError
  const activeWritable = !!active && (active.scope === 'personal' || teamWritable)
  const teamBlockedTitle = list?.teamReadonly ? t('system.savedViews.teamReadonly') : list?.teamError ? t('system.savedViews.errorUnreadable') : undefined

  // Vue supprimée, renommée par un collègue ou absente de la branche : oubliée sans message. Fichier
  // d'équipe cassé (conflit en cours) : on ne peut pas conclure, la sélection est gardée.
  // Une seule fois par vue : `active` ne change qu'après l'écriture, et cet effet peut être rejoué
  // entre-temps (l'écriture elle-même provoque des rendus) : sans garde, boucle de mises à jour.
  const forgotten = useRef<string | null>(null)
  useEffect(() => {
    if (!active || activeView) {
      forgotten.current = null
      return
    }
    if (!list || busy) return
    if (active.scope === 'team' && list.teamError) return
    const key = `${active.scope}:${active.name}`
    if (forgotten.current === key) return
    forgotten.current = key
    void onActiveChange(null).catch(() => { /* la vue sera de nouveau évaluée au prochain chargement */ })
  }, [list, active, activeView, busy, onActiveChange])

  const run = async (action: () => Promise<SavedViewRef | null | void>): Promise<string | null> => {
    setBusy(true)
    setError(null)
    try {
      const ref = await action()
      // La vue est écrite : un échec ici ne doit pas la faire passer pour non enregistrée.
      if (ref !== undefined) await onActiveChange(ref).catch(() => {})
      return null
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const key = errorKey(message)
      return key ? t(`system.savedViews.${key}`) : message
    } finally {
      // Même en échec : une vue absente ou un doublon viennent d'une liste périmée.
      await qc.invalidateQueries({ queryKey }).catch(() => {})
      setBusy(false)
    }
  }

  const handleSave = async () => {
    if (!active) return
    const message = await run(() => api.views.update(repoPath, username, typeKey, active, settings, workspaceDir))
    if (message) setError(message)
  }

  const groups: Array<{ scope: SavedViewScope; label: string }> = [
    { scope: 'personal', label: t('system.savedViews.groupPersonal') },
    { scope: 'team', label: t('system.savedViews.groupTeam') },
  ]
  const actionClass = 'w-full text-left px-3 py-1.5 text-xs text-ink hover:bg-hover disabled:text-ink-3 disabled:hover:bg-transparent'

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title={t('system.savedViews.menuTitle')}
        data-testid="saved-views-button"
        className={['flex items-center gap-1 text-xs text-ink-3 hover:text-ink p-1 rounded hover:bg-hover max-w-48', open ? 'bg-hover text-ink' : ''].join(' ')}
      >
        <Bookmark size={14} className="shrink-0" />
        <span className="truncate" data-testid="saved-views-label">{activeView ? activeView.name : t('system.savedViews.menu')}</span>
        {modified && <span className="shrink-0 italic" data-testid="saved-views-modified">{t('system.savedViews.modified')}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" {...backdropDismiss(() => setOpen(false))} />
          <div data-testid="saved-views-menu" className="absolute right-0 top-full mt-2 z-50 w-64 max-h-96 overflow-y-auto bg-surface border border-edge rounded-lg shadow-xl py-1">
            {listFailed && <p className="px-3 py-1 text-xs text-status-error" data-testid="saved-views-list-error">{t('system.savedViews.errorList')}</p>}
            {!listFailed && groups.map(({ scope, label }) => (
              <div key={scope}>
                <div className="px-3 pt-2 pb-1 text-xs font-semibold text-ink-2">{label}</div>
                {scope === 'team' && list?.teamError && (
                  <p className="px-3 pb-1 text-xs text-status-warning" data-testid="saved-views-team-error">
                    {t(list.teamError === 'newer-format' ? 'system.savedViews.teamNewerFormat' : 'system.savedViews.teamUnreadable')}
                  </p>
                )}
                {views(scope).length === 0 && !(scope === 'team' && list?.teamError) && (
                  <p className="px-3 pb-1 text-xs text-ink-3">{t('system.savedViews.empty')}</p>
                )}
                {[...views(scope)].sort((a, b) => a.name.localeCompare(b.name)).map(view => {
                  const isActive = active?.scope === scope && active.name === view.name
                  return (
                    <button
                      key={view.name}
                      type="button"
                      data-testid={`saved-view-${scope}-${view.name}`}
                      className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-xs text-ink hover:bg-hover"
                      onClick={() => {
                        onApply({ ...view, ref: { scope, name: view.name } })
                        setOpen(false)
                      }}
                    >
                      <Check size={12} className={isActive ? 'shrink-0' : 'shrink-0 invisible'} />
                      <span className="truncate">{view.name}</span>
                    </button>
                  )
                })}
              </div>
            ))}
            <div className="border-t border-edge my-1" />
            {error && <p className="px-3 py-1 text-xs text-status-error" data-testid="saved-views-error">{error}</p>}
            {modified && (
              <button type="button" className={actionClass} disabled={!activeWritable} title={activeWritable ? undefined : teamBlockedTitle} onClick={() => void handleSave()} data-testid="saved-views-save">
                {t('system.savedViews.save')}
              </button>
            )}
            <button type="button" className={actionClass} onClick={() => { setOpen(false); setDialog({ kind: 'save-as' }) }} data-testid="saved-views-save-as">
              {t('system.savedViews.saveAs')}
            </button>
            {activeView && (
              <>
                <button type="button" className={actionClass} disabled={!activeWritable} title={activeWritable ? undefined : teamBlockedTitle} onClick={() => { setOpen(false); setDialog({ kind: 'rename' }) }} data-testid="saved-views-rename">
                  {t('system.savedViews.rename')}
                </button>
                <button type="button" className={actionClass} disabled={!activeWritable} title={activeWritable ? undefined : teamBlockedTitle} onClick={() => { setOpen(false); setDialog({ kind: 'delete' }) }} data-testid="saved-views-delete">
                  {t('system.savedViews.delete')}
                </button>
              </>
            )}
            <button type="button" className={actionClass} onClick={() => { onDefaults(); setOpen(false) }} data-testid="saved-views-defaults">
              {t('system.savedViews.defaults')}
            </button>
          </div>
        </>
      )}
      {dialog?.kind === 'save-as' && (
        <ViewNameDialog
          title={t('system.savedViews.saveAs')}
          initialName=""
          confirmLabel={t('system.savedViews.save')}
          teamAllowed={teamWritable}
          teamBlockedTitle={teamBlockedTitle}
          withScope
          onCancel={() => setDialog(null)}
          onConfirm={async (name, scope) => {
            const message = await run(() => api.views.create(repoPath, username, typeKey, scope, name, settings, workspaceDir))
            if (!message) setDialog(null)
            return message
          }}
        />
      )}
      {dialog?.kind === 'rename' && active && (
        <ViewNameDialog
          title={t('system.savedViews.rename')}
          initialName={active.name}
          confirmLabel={t('system.savedViews.rename')}
          onCancel={() => setDialog(null)}
          onConfirm={async name => {
            const message = await run(() => api.views.rename(repoPath, username, typeKey, active, name, workspaceDir))
            if (!message) setDialog(null)
            return message
          }}
        />
      )}
      {dialog?.kind === 'delete' && active && (
        <DeleteViewDialog
          name={active.name}
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            const message = await run(async () => {
              await api.views.delete(repoPath, username, typeKey, active, workspaceDir)
              return null
            })
            if (!message) setDialog(null)
            return message
          }}
        />
      )}
    </div>
  )
}

function ViewNameDialog({ title, initialName, confirmLabel, withScope, teamAllowed, teamBlockedTitle, onCancel, onConfirm }: {
  title: string
  initialName: string
  confirmLabel: string
  withScope?: boolean
  teamAllowed?: boolean
  teamBlockedTitle?: string
  onCancel: () => void
  /** Message d'erreur à afficher, ou `null` si l'écriture a réussi. */
  onConfirm: (name: string, scope: SavedViewScope) => Promise<string | null>
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initialName)
  const [scope, setScope] = useState<SavedViewScope>('personal')
  const [error, setError] = useState<string | null>(null)
  useModalHotkeys(onCancel)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim()) setError(await onConfirm(name, scope))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" {...backdropDismiss(onCancel)}>
      <form onSubmit={e => void submit(e)} onClick={e => e.stopPropagation()} data-testid="saved-view-dialog"
        className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-md w-full mx-4 space-y-4">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-2">{t('system.savedViews.nameLabel')}</span>
          <input value={name} onChange={e => setName(e.target.value)} autoFocus className="input-field w-full" data-testid="saved-view-name" />
        </label>
        {withScope && (
          <fieldset className="space-y-1">
            <legend className="text-xs text-ink-2">{t('system.savedViews.scopeLabel')}</legend>
            <label className="flex items-center gap-2 text-xs text-ink">
              <input type="radio" checked={scope === 'personal'} onChange={() => setScope('personal')} data-testid="saved-view-scope-personal" />
              {t('system.savedViews.scopePersonal')}
            </label>
            <label className="flex items-center gap-2 text-xs text-ink" title={teamAllowed ? undefined : teamBlockedTitle}>
              <input type="radio" checked={scope === 'team'} disabled={!teamAllowed} onChange={() => setScope('team')} data-testid="saved-view-scope-team" />
              {t('system.savedViews.scopeTeam')}
            </label>
            {scope === 'team' && <p className="text-xs text-ink-3">{t('system.savedViews.teamHint')}</p>}
          </fieldset>
        )}
        {error && <p className="text-xs text-status-error" data-testid="saved-view-dialog-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary">{t('common.cancel')}</button>
          <button type="submit" disabled={!name.trim()} className="btn-primary" data-testid="saved-view-confirm">{confirmLabel}</button>
        </div>
      </form>
    </div>
  )
}

function DeleteViewDialog({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: () => Promise<string | null> }) {
  const { t } = useTranslation()
  const [error, setError] = useState<string | null>(null)
  useModalHotkeys(onCancel)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40" {...backdropDismiss(onCancel)}>
      <div className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()} data-testid="saved-view-delete-dialog">
        <h2 className="text-sm font-semibold text-ink mb-2">{t('system.savedViews.deleteTitle')}</h2>
        <p className="text-xs text-ink-2 mb-5">{t('system.savedViews.deleteMessage', { name })}</p>
        {error && <p className="text-xs text-status-error mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary">{t('common.cancel')}</button>
          <button type="button" autoFocus className="btn-danger" data-testid="saved-view-delete-confirm" onClick={() => void onConfirm().then(setError)}>
            {t('system.savedViews.delete')}
          </button>
        </div>
      </div>
    </div>
  )
}
