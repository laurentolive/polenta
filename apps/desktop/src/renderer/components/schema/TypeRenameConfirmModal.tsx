import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import type { TypeRenameDto, TypeRenamePlan } from '@polenta/types'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'

interface Props {
  dto: TypeRenameDto
  plan: TypeRenamePlan
  /** Libellé affiché d'un repo du workspace. */
  repoLabel: (repoPath: string) => string
  onConfirm: () => void
  onCancel: () => void
}

const SHOWN = 5

/**
 * GH100 — confirmation du renommage d'un type (nom / préfixe) **avant** l'écriture du schéma :
 * objets renommés, objets qui changent de type, fichiers réécrits par repo, avertissements (date de
 * création git, scripts Suivi). Annuler n'enregistre rien.
 */
export function TypeRenameConfirmModal({ dto, plan, repoLabel, onConfirm, onCancel }: Props) {
  const { t } = useTranslation()
  useModalHotkeys(onCancel, onConfirm)

  const filesByRepo = new Map<string, number>()
  for (const f of plan.files) filesByRepo.set(f.repoPath, (filesByRepo.get(f.repoPath) ?? 0) + 1)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/40" onClick={onCancel}>
      <div
        role="dialog"
        aria-label={t('schema.typeRename.title')}
        className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-lg w-full mx-4"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-ink mb-3">{t('schema.typeRename.title')}</h2>
        <ul className="space-y-1 text-xs text-ink-2 mb-3">
          {dto.oldName !== dto.newName && (
            <li>{t('schema.typeRename.name')} : <code className="font-mono">{dto.oldName}</code> → <code className="font-mono">{dto.newName}</code></li>
          )}
          {dto.oldPrefix !== dto.newPrefix && (
            <li>{t('schema.typeRename.prefix')} : <code className="font-mono">{dto.oldPrefix}</code> → <code className="font-mono">{dto.newPrefix}</code></li>
          )}
        </ul>

        <div className="space-y-2 text-xs mb-3">
          {plan.objects.length > 0 && (
            <div>
              <p className="text-ink">{t('schema.typeRename.objects', { count: plan.objects.length })}</p>
              <ul className="text-ink-3 font-mono ml-3">
                {plan.objects.slice(0, SHOWN).map(o => <li key={o.oldId}>{o.oldId} → {o.newId}</li>)}
                {plan.objects.length > SHOWN && <li>{t('schema.typeRename.more', { count: plan.objects.length - SHOWN })}</li>}
              </ul>
            </div>
          )}
          {plan.retargeted > 0 && <p className="text-ink">{t('schema.typeRename.retargeted', { count: plan.retargeted })}</p>}
          {filesByRepo.size > 0 && (
            <div>
              <p className="text-ink">{t('schema.typeRename.files', { count: plan.files.length })}</p>
              <ul className="text-ink-3 ml-3">
                {[...filesByRepo].map(([repo, n]) => <li key={repo}>{repoLabel(repo)} : {n}</li>)}
              </ul>
            </div>
          )}
          {plan.linkTypeRepos.length > 0 && (
            <p className="text-ink">{t('schema.typeRename.linkTypes', { repos: plan.linkTypeRepos.map(repoLabel).join(', ') })}</p>
          )}
        </div>

        <div className="space-y-1 text-xs text-ink-3 mb-5">
          {plan.objects.length > 0 && (
            <p className="flex items-start gap-1 text-status-warning">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              {t('schema.typeRename.gitDate')}
            </p>
          )}
          <p>{t('schema.typeRename.suiviNote')}</p>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn-secondary">{t('common.cancel')}</button>
          <button type="button" onClick={onConfirm} autoFocus className="btn-primary">{t('schema.typeRename.confirm')}</button>
        </div>
      </div>
    </div>
  )
}
