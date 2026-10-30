import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import type { SchemaDeletePlan, SchemaDeleteTarget } from '@polenta/types'
import { useModalHotkeys } from '../../hooks/useModalHotkeys'

interface Props {
  target: SchemaDeleteTarget
  /** Libellé affiché du composant / type supprimé. */
  label: string
  plan: SchemaDeletePlan
  /** Libellé affiché d'un repo du workspace. */
  repoLabel: (repoPath: string) => string
  isDeleting: boolean
  onConfirm: () => void
  onCancel: () => void
}

const SHOWN = 5

/**
 * GH104 — confirmation de la suppression en cascade d'un composant local ou d'un type, à partir
 * de l'aperçu calculé sans écriture (`schema:preview-delete`) : objets par catégorie, liens par
 * repo, types de lien modifiés (et ceux qui deviennent invalides). Lignes vides masquées ; une
 * erreur de pré-contrôle désactive la suppression. Annuler ne modifie rien.
 */
export function SchemaDeleteConfirmModal({ target, label, plan, repoLabel, isDeleting, onConfirm, onCancel }: Props) {
  const { t } = useTranslation()
  const blocked = plan.errors.length > 0
  // Suppression en cours : ni Échap ni clic extérieur (elle irait au bout, la modale fermée).
  useModalHotkeys(onCancel, () => { if (!blocked) onConfirm() }, isDeleting)
  const subCount = Math.max(0, plan.nodes.length - 1)

  const title = t(target.kind === 'node' ? 'schema.deleteCascade.titleNode' : 'schema.deleteCascade.titleType', { name: label })
  const categories = (['requirement', 'test', 'campaign', 'changeset'] as const).filter(c => plan.objects[c].length > 0)
  const linkCount = plan.links.reduce((n, l) => n + l.count, 0)
  const emptied = plan.linkTypes.filter(l => l.emptied)
  const changed = plan.linkTypes.filter(l => !l.emptied)
  const linkTypeLabel = (l: SchemaDeletePlan['linkTypes'][number]) => `${l.name} (${repoLabel(l.repoPath)})`

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay/40" onClick={() => { if (!isDeleting) onCancel() }}>
      <div
        role="dialog"
        aria-label={title}
        className="bg-surface border border-edge rounded-lg shadow-xl p-6 max-w-lg w-full mx-4"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-ink mb-3">{title}</h2>

        {blocked ? (
          <div className="flex items-start gap-2 text-xs text-status-danger mb-5">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            <ul className="space-y-0.5">{plan.errors.map((e, i) => <li key={i}>{e.detail}</li>)}</ul>
          </div>
        ) : (
          <>
            <div className="space-y-2 text-xs mb-3">
              {subCount > 0 && <p className="text-ink">{t('schema.structureTab.deleteComponentCascadeBody', { count: subCount })}</p>}
              {categories.map(c => (
                <div key={c}>
                  <p className="text-ink">{t(`schema.deleteCascade.objects.${c}`, { count: plan.objects[c].length })}</p>
                  <p className="text-ink-3 font-mono ml-3">
                    {plan.objects[c].slice(0, SHOWN).join(', ')}
                    {plan.objects[c].length > SHOWN && ` ${t('schema.deleteCascade.more', { count: plan.objects[c].length - SHOWN })}`}
                  </p>
                </div>
              ))}
              {linkCount > 0 && (
                <div>
                  <p className="text-ink">{t('schema.deleteCascade.links', { count: linkCount })}</p>
                  <ul className="text-ink-3 ml-3">
                    {plan.links.map(l => <li key={l.repoPath}>{repoLabel(l.repoPath)} : {l.count}</li>)}
                  </ul>
                </div>
              )}
              {changed.length > 0 && (
                <p className="text-ink">{t('schema.deleteCascade.linkTypes', { names: changed.map(linkTypeLabel).join(', ') })}</p>
              )}
              {emptied.length > 0 && (
                <p className="flex items-start gap-1 text-status-warning">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  {t('schema.deleteCascade.linkTypesEmptied', { names: emptied.map(linkTypeLabel).join(', ') })}
                </p>
              )}
            </div>
            <div className="space-y-1 text-xs text-ink-3 mb-5">
              {categories.length > 0 && <p>{t('schema.deleteCascade.tombstones')}</p>}
              <p>{t('schema.deleteCascade.gitNote')}</p>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={isDeleting} className="btn-secondary">{t('common.cancel')}</button>
          <button type="button" onClick={onConfirm} disabled={blocked || isDeleting} autoFocus={!blocked} className="btn-danger disabled:opacity-50">
            {t('common.delete')}
          </button>
        </div>
      </div>
    </div>
  )
}
